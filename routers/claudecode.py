import json
import time
from collections import defaultdict, deque

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from models import get_setting, set_setting
from routers.auth import verify_token
from services import claudecode_store, claudecode_client
from services.claudecode_auth import CLAUDE_BASE, account_info, account_usage, valid_token
from services.claudecode_request_builder import client_models, prepare
from services.claudecode_upstream import clear_failures, failures, forward, request_headers
from services.claudecode_upstream import _failure as record_failure
from services.proxy_config import normalize_proxy_url
from services.secret_store import is_configured as secret_store_configured


router = APIRouter()
SETTING_KEYS = {
    "enabled": "claudecode_enabled", "models": "claudecode_models",
    "thinking_alias": "claudecode_thinking_alias", "cache_mode": "claudecode_cache_mode",
    "cache_ttl": "claudecode_cache_ttl", "cache_rules": "claudecode_cache_rules",
    "rpm_limit": "claudecode_rpm_limit",
}
_account_index = 0
_request_times: dict[int, deque] = defaultdict(deque)


async def _admin(authorization: str | None) -> None:
    token = (authorization or "").replace("Bearer ", "", 1).strip()
    if not await verify_token(token):
        raise HTTPException(status_code=401)


async def _client(authorization: str | None, x_api_key: str | None) -> None:
    expected = await get_setting("access_key")
    token = x_api_key or (authorization or "").replace("Bearer ", "", 1).strip()
    if expected and token != expected:
        raise HTTPException(status_code=401, detail="Invalid access key")


def _proxy(value: str) -> str:
    try:
        return normalize_proxy_url(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class AccountCreate(BaseModel):
    name: str
    credential: str
    proxy_url: str = ""


class AccountUpdate(BaseModel):
    name: str | None = None
    credential: str | None = None
    proxy_url: str | None = None
    is_active: int | None = None
    disable_reason: str | None = None


class ConfigUpdate(BaseModel):
    enabled: int | None = None
    models: str | None = None
    thinking_alias: int | None = None
    cache_mode: str | None = None
    cache_ttl: str | None = None
    cache_rules: str | None = None
    rpm_limit: int | None = None


class VersionChange(BaseModel):
    version: str
    expected_version: str


class VersionProbe(VersionChange):
    account_id: int
    model: str


class ReleaseCheck(BaseModel):
    force: bool = False
    account_id: int | None = None


@router.get("/api/claudecode/client-version")
async def client_version(authorization: str = Header(None)):
    await _admin(authorization)
    return {"profile": await claudecode_client.profile(),
            "release": await claudecode_client.release_status()}


@router.post("/api/claudecode/client-version/check")
async def check_client_version(req: ReleaseCheck, authorization: str = Header(None)):
    await _admin(authorization)
    proxy = ""
    if req.account_id is not None:
        account = await claudecode_store.get_account(req.account_id)
        if not account:
            raise HTTPException(status_code=404, detail="账号不存在")
        proxy = account.get("proxy_url") or ""
    return await claudecode_client.check_release(req.force, proxy)


@router.post("/api/claudecode/client-version/apply")
async def apply_client_version(req: VersionChange, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        return await claudecode_client.save_version(req.version, req.expected_version)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/claudecode/client-version/restore")
async def restore_client_version(req: VersionChange, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        return await claudecode_client.save_version(req.version, req.expected_version, restore=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/claudecode/client-version/test")
async def test_client_version(req: VersionProbe, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        version = claudecode_client.validate_version(req.version)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if (await claudecode_client.profile())["version"] != req.expected_version:
        raise HTTPException(status_code=409, detail="生效版本已被修改，请刷新后重试")
    account = await claudecode_store.get_account(req.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")
    if not req.model.strip():
        raise HTTPException(status_code=400, detail="请填写测试模型")
    started = time.monotonic()
    body = {"model": req.model.strip(), "max_tokens": 32, "stream": False,
            "messages": [{"role": "user", "content": "Reply only OK."}]}
    effort = ""
    try:
        with claudecode_client.use_version(version):
            token = await valid_token(req.account_id)
            body, user_agent, effort = await prepare(body)
            async with httpx.AsyncClient(timeout=45, proxy=account.get("proxy_url") or None) as client:
                response = await client.post(f"{CLAUDE_BASE}/v1/messages",
                                             headers=request_headers(token, user_agent), json=body)
        try:
            data = response.json()
        except ValueError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        await claudecode_store.add_request(req.account_id, body["model"], effort,
                                          data.get("usage") or {},
                                          int((time.monotonic() - started) * 1000), response.status_code)
        if response.status_code != 200 or data.get("type") != "message":
            record_failure(req.account_id, body, False, response=response)
            error = data.get("error")
            message = error.get("message") if isinstance(error, dict) else None
            raise HTTPException(status_code=502, detail=f"测试失败 HTTP {response.status_code}: {str(message or '未收到有效模型响应')[:500]}")
    except HTTPException:
        raise
    except Exception as exc:
        record_failure(req.account_id, body, False, error=exc)
        await claudecode_store.add_request(req.account_id, body["model"], effort, {},
                                          int((time.monotonic() - started) * 1000), 502)
        raise HTTPException(status_code=502, detail=f"测试连接或鉴权失败（{type(exc).__name__}），当前版本未改变") from exc
    try:
        state = await claudecode_client.save_version(version, req.expected_version,
                                                     tested_model=body["model"])
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return state


@router.get("/api/claudecode/config")
async def config(authorization: str = Header(None)):
    await _admin(authorization)
    result = {key: await get_setting(setting) for key, setting in SETTING_KEYS.items()}
    result["secret_store_configured"] = secret_store_configured()
    return result


@router.patch("/api/claudecode/config")
async def update_config(req: ConfigUpdate, authorization: str = Header(None)):
    await _admin(authorization)
    updates = req.model_dump(exclude_none=True)
    if updates.get("cache_mode") not in (None, "off", "auto", "rules"):
        raise HTTPException(status_code=400, detail="缓存模式无效")
    if updates.get("cache_ttl") not in (None, "5m", "1h"):
        raise HTTPException(status_code=400, detail="缓存 TTL 无效")
    for key in ("models", "cache_rules"):
        if key in updates:
            try:
                value = json.loads(updates[key] or "[]")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"{key} 不是合法 JSON") from exc
            if not isinstance(value, list) or (key == "cache_rules" and len(value) > 4):
                raise HTTPException(status_code=400, detail=f"{key} 格式不正确")
    for key, value in updates.items():
        await set_setting(SETTING_KEYS[key], str(value))
    return {"ok": True}


@router.get("/api/claudecode/accounts")
async def accounts(authorization: str = Header(None)):
    await _admin(authorization)
    return await claudecode_store.list_accounts()


@router.post("/api/claudecode/accounts")
async def create_account(req: AccountCreate, authorization: str = Header(None)):
    await _admin(authorization)
    if not secret_store_configured():
        raise HTTPException(status_code=400, detail="请先配置 CATCH_MASTER_KEY")
    if not req.credential.strip():
        raise HTTPException(status_code=400, detail="请填写 Claude sessionKey")
    account_id = await claudecode_store.add_account(
        req.name.strip() or "Claude Code", req.credential.strip(), _proxy(req.proxy_url)
    )
    return {"ok": True, "id": account_id}


@router.patch("/api/claudecode/accounts/{account_id}")
async def patch_account(account_id: int, req: AccountUpdate,
                        authorization: str = Header(None)):
    await _admin(authorization)
    updates = req.model_dump(exclude_none=True)
    credential = updates.pop("credential", None)
    if credential is not None:
        if not credential.strip():
            raise HTTPException(status_code=400, detail="sessionKey 不能为空")
        await claudecode_store.replace_credential(account_id, credential.strip())
    if "proxy_url" in updates:
        updates["proxy_url"] = _proxy(updates["proxy_url"])
    await claudecode_store.update_account(account_id, **updates)
    return {"ok": True}


@router.delete("/api/claudecode/accounts/{account_id}")
async def delete_account(account_id: int, authorization: str = Header(None)):
    await _admin(authorization)
    await claudecode_store.delete_account(account_id)
    return {"ok": True}


@router.post("/api/claudecode/accounts/{account_id}/authenticate")
async def authenticate_account(account_id: int, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        info = await account_info(account_id)
        await valid_token(account_id)
        usage = await account_usage(account_id)
        return {"ok": True, "info": info, "usage": usage}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/claudecode/accounts/{account_id}/usage")
async def refresh_usage(account_id: int, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        return await account_usage(account_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/api/claudecode/logs")
async def request_logs(account_id: int = None, limit: int = 100, offset: int = 0,
                       authorization: str = Header(None)):
    await _admin(authorization)
    return await claudecode_store.list_requests(account_id, limit, offset)


@router.get("/api/claudecode/usage-summary")
async def usage_summary(account_id: int = None, authorization: str = Header(None)):
    await _admin(authorization)
    return await claudecode_store.usage_summary(account_id)


@router.get("/api/claudecode/failures")
async def failure_logs(authorization: str = Header(None)):
    await _admin(authorization)
    return failures()


@router.delete("/api/claudecode/failures")
async def wipe_failures(authorization: str = Header(None)):
    await _admin(authorization)
    clear_failures()
    return {"ok": True}


@router.get("/claudecode/v1/models")
async def public_models(authorization: str = Header(None), x_api_key: str = Header(None)):
    await _client(authorization, x_api_key)
    if (await get_setting("claudecode_enabled") or "0") != "1":
        raise HTTPException(status_code=503, detail="Claude Code 转发未启用")
    return {"object": "list", "data": [
        {"id": model, "object": "model", "owned_by": "anthropic"}
        for model in await client_models()
    ]}


def _rpm_allowed(account_id: int, limit: int) -> bool:
    if limit <= 0:
        return True
    now = time.time()
    queue = _request_times[account_id]
    while queue and queue[0] < now - 60:
        queue.popleft()
    if len(queue) >= limit:
        return False
    queue.append(now)
    return True


async def _ordered_accounts() -> list[dict]:
    global _account_index
    items = [item for item in await claudecode_store.list_accounts(public=False)
             if int(item.get("is_active", 0)) == 1]
    if not items:
        return []
    start = _account_index % len(items)
    _account_index += 1
    return items[start:] + items[:start]


@router.post("/claudecode/v1/messages")
async def public_messages(request: Request, authorization: str = Header(None),
                          x_api_key: str = Header(None)):
    await _client(authorization, x_api_key)
    if (await get_setting("claudecode_enabled") or "0") != "1":
        raise HTTPException(status_code=503, detail="Claude Code 转发未启用")
    try:
        raw_body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="请求体不是合法 JSON") from exc
    if not isinstance(raw_body, dict) or not raw_body.get("model"):
        raise HTTPException(status_code=400, detail="请求缺少 model")
    with claudecode_client.use_version(await claudecode_client.current_version()):
        return await _forward_messages(raw_body)


async def _forward_messages(raw_body: dict):
    body, user_agent, effort = await prepare(raw_body)
    rpm_limit = int(await get_setting("claudecode_rpm_limit") or 0)
    last_response = None
    for account in await _ordered_accounts():
        if not _rpm_allowed(account["id"], rpm_limit):
            continue
        try:
            token = await valid_token(account["id"])
        except Exception as exc:
            await claudecode_store.update_account(
                account["id"], is_active=0, disable_reason=f"Token 获取失败：{exc}"
            )
            continue
        response, retry = await forward(body, token, user_agent, account, effort, time.time())
        if not retry:
            return response
        last_response = response
    if last_response:
        return last_response
    raise HTTPException(status_code=503, detail="没有可用的 Claude Code 账号")
