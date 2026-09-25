import json
import re
import time
from contextlib import contextmanager
from contextvars import ContextVar

import httpx

from database import get_db
from models import get_setting, set_setting


DEFAULT_VERSION = "2.1.280"
PROFILE_KEY = "claudecode_client_profile"
RELEASE_KEY = "claudecode_client_release"
RELEASE_URL = "https://registry.npmjs.org/@anthropic-ai/claude-code/latest"
_request_version = ContextVar("claudecode_client_version", default=None)


def validate_version(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,5}", value):
        raise ValueError("版本号格式应为 2.1.280")
    return value


def _profile(raw: str | None) -> dict:
    data = json.loads(raw) if raw else {}
    return {"version": DEFAULT_VERSION, "tested_at": None, "tested_model": "",
            "previous": None, **data}


async def profile() -> dict:
    return _profile(await get_setting(PROFILE_KEY))


async def current_version() -> str:
    return _request_version.get() or (await profile())["version"]


@contextmanager
def use_version(version: str):
    # Candidate probes and concurrent requests must not change each other's identity.
    token = _request_version.set(validate_version(version))
    try:
        yield
    finally:
        _request_version.reset(token)


async def save_version(version: str, expected_version: str, *, tested_model: str = "",
                       restore: bool = False) -> dict:
    version = validate_version(version)
    async with get_db() as db:
        await db.execute("BEGIN IMMEDIATE")
        async with db.execute("SELECT value FROM settings WHERE key = ?", (PROFILE_KEY,)) as cur:
            row = await cur.fetchone()
        state = _profile(row[0] if row else None)
        if state["version"] != expected_version:
            raise ValueError("生效版本已被修改，请刷新后再操作")
        if restore:
            if not state["previous"] or state["previous"]["version"] != version:
                raise ValueError("没有可恢复的上一版本")
            replacement = dict(state["previous"])
        else:
            replacement = {"version": version, "tested_at": int(time.time()) if tested_model else None,
                           "tested_model": tested_model}
        if version != state["version"]:
            replacement["previous"] = {k: state[k] for k in ("version", "tested_at", "tested_model")}
        else:
            replacement["previous"] = state["previous"]
            if not tested_model and not restore:
                replacement = state
        await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                         (PROFILE_KEY, json.dumps(replacement)))
        await db.commit()
    return replacement


async def release_status() -> dict:
    return json.loads(await get_setting(RELEASE_KEY) or "{}")


async def check_release(force: bool = False, proxy_url: str = "") -> dict:
    previous = await release_status()
    now = int(time.time())
    if not force and now - previous.get("checked_at", 0) < 86400:
        return previous
    result = {**previous, "checked_at": now, "source": RELEASE_URL, "error": ""}
    try:
        async with httpx.AsyncClient(timeout=15, proxy=proxy_url or None) as client:
            response = await client.get(RELEASE_URL)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict) or data.get("name") != "@anthropic-ai/claude-code":
            raise ValueError("发布源返回了不匹配的软件包")
        result.update(version=validate_version(data["version"]), fetched_at=now)
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        result["error"] = f"检查更新失败（{type(exc).__name__}），可以重试或手动填写版本"
    await set_setting(RELEASE_KEY, json.dumps(result, ensure_ascii=False))
    return result
