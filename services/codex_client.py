import json
import re
import time

import httpx

from database import get_db
from models import get_setting, set_setting


DEFAULT_VERSION = "0.157.0"
PROFILE_KEY = "codex_client_profile"
RELEASE_KEY = "codex_client_release"
RELEASE_URL = "https://api.github.com/repos/openai/codex/releases/latest"


def validate_version(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,5}", value):
        raise ValueError("版本号格式应为 0.159.3")
    return value


def user_agent(version: str) -> str:
    return f"codex_exec/{version} (Debian 13.0.0; x86_64) xterm-256color (codex_exec; {version})"


def _profile(raw: str | None) -> dict:
    return {"version": DEFAULT_VERSION, "previous": None, **(json.loads(raw) if raw else {})}


async def profile() -> dict:
    return _profile(await get_setting(PROFILE_KEY))


async def current_version() -> str:
    return (await profile())["version"]


async def save_version(version: str, expected_version: str, *, restore: bool = False) -> dict:
    version = validate_version(version)
    async with get_db() as db:
        await db.execute("BEGIN IMMEDIATE")
        async with db.execute("SELECT value FROM settings WHERE key = ?", (PROFILE_KEY,)) as cur:
            row = await cur.fetchone()
        state = _profile(row[0] if row else None)
        if state["version"] != expected_version:
            raise ValueError("生效版本已被修改，请刷新后再操作")
        if restore and state["previous"] != version:
            raise ValueError("没有可恢复的上一版本")
        replacement = {"version": version, "previous": state["version"]} if version != state["version"] else state
        await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                         (PROFILE_KEY, json.dumps(replacement)))
        await db.commit()
    return replacement


async def release_status() -> dict:
    return json.loads(await get_setting(RELEASE_KEY) or "{}")


async def check_release(force: bool = False, proxy_url: str = "") -> dict:
    previous = await release_status()
    now = int(time.time())
    if not force and previous.get("version") and not previous.get("error") and now - previous.get("checked_at", 0) < 86400:
        return previous
    result = {**previous, "checked_at": now, "source": RELEASE_URL, "error": ""}
    try:
        async with httpx.AsyncClient(timeout=15, proxy=proxy_url or None, follow_redirects=True) as client:
            response = await client.get(RELEASE_URL, headers={
                "Accept": "application/vnd.github+json", "User-Agent": "Claude-Catche",
            })
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict) or data.get("draft") or data.get("prerelease"):
            raise ValueError("发布源未返回稳定版")
        tag = data.get("tag_name") or ""
        if not tag.startswith("rust-v"):
            raise ValueError("发布源返回了不匹配的版本标签")
        result.update(version=validate_version(tag.removeprefix("rust-v")),
                      published_at=data.get("published_at"), fetched_at=now)
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        result["error"] = f"获取最新版失败（{type(exc).__name__}），可以重试或手动填写版本"
    await set_setting(RELEASE_KEY, json.dumps(result, ensure_ascii=False))
    return result
