import json
import time

import aiosqlite

from database import get_db
from services.secret_store import open_secret, seal


PUBLIC_FIELDS = (
    "id", "name", "email", "subscription_type", "organization_id",
    "proxy_url", "is_active", "disable_reason", "last_usage_json",
    "usage_refreshed_at", "created_at",
)


def _public(row: dict) -> dict:
    result = {key: row.get(key) for key in PUBLIC_FIELDS}
    result["credential_configured"] = bool(
        row.get("credential_secret") or row.get("access_secret") or row.get("refresh_secret")
    )
    try:
        result["usage"] = json.loads(row.get("last_usage_json") or "{}")
    except ValueError:
        result["usage"] = {}
    result.pop("last_usage_json", None)
    return result


async def add_account(name: str, credential: str, proxy_url: str = "") -> int:
    async with get_db() as db:
        cursor = await db.execute(
            "INSERT INTO claudecode_accounts (name, credential_secret, proxy_url) VALUES (?, ?, ?)",
            (name, seal(credential), proxy_url),
        )
        await db.commit()
        return cursor.lastrowid


async def list_accounts(public: bool = True) -> list[dict]:
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM claudecode_accounts ORDER BY id") as cursor:
            rows = [dict(row) for row in await cursor.fetchall()]
    return [_public(row) for row in rows] if public else rows


async def get_account(account_id: int, decrypt: bool = False) -> dict | None:
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM claudecode_accounts WHERE id = ?", (account_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if not row:
        return None
    result = dict(row)
    if decrypt:
        result["credential"] = open_secret(result.pop("credential_secret", ""))
        result["access_token"] = open_secret(result.pop("access_secret", ""))
        result["refresh_token"] = open_secret(result.pop("refresh_secret", ""))
    return result


async def update_account(account_id: int, **updates) -> None:
    allowed = {
        "name", "email", "subscription_type", "organization_id", "proxy_url",
        "is_active", "disable_reason", "token_expires_at", "last_usage_json",
        "usage_refreshed_at",
    }
    updates = {key: value for key, value in updates.items() if key in allowed}
    if not updates:
        return
    fields = ", ".join(f"{key} = ?" for key in updates)
    async with get_db() as db:
        await db.execute(
            f"UPDATE claudecode_accounts SET {fields} WHERE id = ?",
            [*updates.values(), account_id],
        )
        await db.commit()


async def replace_credential(account_id: int, credential: str) -> None:
    async with get_db() as db:
        await db.execute(
            """UPDATE claudecode_accounts
               SET credential_secret = ?, access_secret = '', refresh_secret = '',
                   token_expires_at = 0, disable_reason = '' WHERE id = ?""",
            (seal(credential), account_id),
        )
        await db.commit()


async def save_token(account_id: int, access_token: str, refresh_token: str, expires_at: int,
                     organization_id: str = "") -> None:
    async with get_db() as db:
        await db.execute(
            """UPDATE claudecode_accounts
               SET access_secret = ?, refresh_secret = ?, token_expires_at = ?,
                   organization_id = COALESCE(NULLIF(?, ''), organization_id), disable_reason = ''
               WHERE id = ?""",
            (seal(access_token), seal(refresh_token), expires_at, organization_id, account_id),
        )
        await db.commit()


async def set_usage(account_id: int, usage: dict) -> None:
    await update_account(
        account_id,
        last_usage_json=json.dumps(usage, ensure_ascii=False),
        usage_refreshed_at=int(time.time()),
    )


async def delete_account(account_id: int) -> None:
    async with get_db() as db:
        await db.execute("DELETE FROM claudecode_accounts WHERE id = ?", (account_id,))
        await db.commit()


async def add_request(account_id: int, model: str, effort: str, usage: dict,
                      duration_ms: int, status: int) -> None:
    async with get_db() as db:
        await db.execute(
            """INSERT INTO claudecode_requests (
                   account_id, model, thinking_effort, input_tokens, output_tokens,
                   cache_creation_tokens, cache_read_tokens, duration_ms, status
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                account_id, model, effort,
                usage.get("input_tokens", 0) or 0,
                usage.get("output_tokens", 0) or 0,
                usage.get("cache_creation_input_tokens", 0) or 0,
                usage.get("cache_read_input_tokens", 0) or 0,
                duration_ms, status,
            ),
        )
        await db.commit()


async def list_requests(account_id: int | None = None, limit: int = 100,
                        offset: int = 0) -> list[dict]:
    query = """SELECT r.*, a.name AS account_name
               FROM claudecode_requests r
               LEFT JOIN claudecode_accounts a ON a.id = r.account_id"""
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


async def usage_summary(account_id: int | None = None) -> dict:
    where = " WHERE account_id = ?" if account_id else ""
    params = (account_id,) if account_id else ()
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"""SELECT COUNT(*) total_requests,
                       COALESCE(SUM(input_tokens), 0) total_input,
                       COALESCE(SUM(output_tokens), 0) total_output,
                       COALESCE(SUM(cache_creation_tokens), 0) total_cache_creation,
                       COALESCE(SUM(cache_read_tokens), 0) total_cache_read,
                       MIN(request_at) first_request, MAX(request_at) last_request
                FROM claudecode_requests{where}""",
            params,
        ) as cursor:
            return dict(await cursor.fetchone())
