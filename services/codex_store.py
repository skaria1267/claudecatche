import json
import time

import aiosqlite

from database import get_db
from services.secret_store import open_secret, seal


PUBLIC_FIELDS = (
    "id", "name", "account_uid", "email", "subscription_type", "proxy_url",
    "models", "is_active", "disable_reason", "last_usage_json",
    "usage_refreshed_at", "created_at",
)


def _public(row: dict) -> dict:
    result = {key: row.get(key) for key in PUBLIC_FIELDS}
    result["authenticated"] = bool(row.get("access_secret") or row.get("refresh_secret"))
    try:
        result["usage"] = json.loads(row.get("last_usage_json") or "{}")
    except ValueError:
        result["usage"] = {}
    result.pop("last_usage_json", None)
    return result


async def add_account(name: str, proxy_url: str = "") -> int:
    async with get_db() as db:
        cursor = await db.execute(
            "INSERT INTO codex_accounts (name, proxy_url) VALUES (?, ?)",
            (name, proxy_url),
        )
        await db.commit()
        return cursor.lastrowid


async def list_accounts(public: bool = True) -> list[dict]:
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM codex_accounts ORDER BY id") as cursor:
            rows = [dict(row) for row in await cursor.fetchall()]
    return [_public(row) for row in rows] if public else rows


async def get_account(account_id: int, decrypt: bool = False) -> dict | None:
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM codex_accounts WHERE id = ?", (account_id,)) as cursor:
            row = await cursor.fetchone()
    if not row:
        return None
    result = dict(row)
    if decrypt:
        result["access_token"] = open_secret(result.pop("access_secret", ""))
        result["refresh_token"] = open_secret(result.pop("refresh_secret", ""))
        result["id_token"] = open_secret(result.pop("id_secret", ""))
    return result


async def update_account(account_id: int, **updates) -> None:
    allowed = {
        "name", "account_uid", "email", "subscription_type", "proxy_url", "models",
        "is_active", "disable_reason", "token_expires_at", "last_usage_json",
        "usage_refreshed_at",
    }
    updates = {key: value for key, value in updates.items() if key in allowed}
    if not updates:
        return
    fields = ", ".join(f"{key} = ?" for key in updates)
    async with get_db() as db:
        await db.execute(
            f"UPDATE codex_accounts SET {fields} WHERE id = ?",
            [*updates.values(), account_id],
        )
        await db.commit()


async def save_tokens(account_id: int, access_token: str, refresh_token: str,
                      id_token: str, expires_at: int, account_uid: str,
                      email: str) -> None:
    async with get_db() as db:
        await db.execute(
            """UPDATE codex_accounts SET access_secret = ?, refresh_secret = ?,
                   id_secret = ?, token_expires_at = ?, account_uid = ?, email = ?,
                   disable_reason = '' WHERE id = ?""",
            (
                seal(access_token), seal(refresh_token), seal(id_token), expires_at,
                account_uid, email, account_id,
            ),
        )
        await db.commit()


async def set_usage(account_id: int, usage: dict) -> None:
    await update_account(
        account_id,
        subscription_type=str(usage.get("plan_type") or ""),
        last_usage_json=json.dumps(usage, ensure_ascii=False),
        usage_refreshed_at=int(time.time()),
    )


async def delete_account(account_id: int) -> None:
    async with get_db() as db:
        await db.execute("DELETE FROM codex_accounts WHERE id = ?", (account_id,))
        await db.commit()


async def add_request(account_id: int, requested_model: str, model: str, effort: str,
                      usage: dict, duration_ms: int, status: int) -> None:
    input_details = usage.get("input_tokens_details") or usage.get("prompt_tokens_details") or {}
    output_details = usage.get("output_tokens_details") or usage.get("completion_tokens_details") or {}
    async with get_db() as db:
        await db.execute(
            """INSERT INTO codex_requests (
                   account_id, requested_model, model, thinking_effort,
                   prompt_tokens, completion_tokens, cached_tokens, cache_write_tokens,
                   reasoning_tokens, duration_ms, status
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                account_id, requested_model, model, effort,
                usage.get("input_tokens", usage.get("prompt_tokens", 0)) or 0,
                usage.get("output_tokens", usage.get("completion_tokens", 0)) or 0,
                input_details.get("cached_tokens", 0) or 0,
                input_details.get("cache_write_tokens", input_details.get("cache_creation_tokens", 0)) or 0,
                output_details.get("reasoning_tokens", 0) or 0,
                duration_ms, status,
            ),
        )
        await db.commit()


async def list_requests(account_id: int | None = None, limit: int = 100,
                        offset: int = 0) -> list[dict]:
    query = """SELECT r.*, a.name AS account_name
               FROM codex_requests r LEFT JOIN codex_accounts a ON a.id = r.account_id"""
    params: list = []
    if account_id:
        query += " WHERE r.account_id = ?"
        params.append(account_id)
    query += " ORDER BY r.request_at DESC LIMIT ? OFFSET ?"
    params.extend([min(max(limit, 1), 500), max(offset, 0)])
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cursor:
            return [dict(row) for row in await cursor.fetchall()]
