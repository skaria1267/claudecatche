import json
import time

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from models import get_setting, set_setting
from routers.auth import verify_token
from services import codex_store
from services.codex_auth import (
    authcode_complete, authcode_start, device_poll, device_start, valid_token,
)
from services.codex_request_builder import client_models, prepare_chat, prepare_responses
from services.codex_upstream import clear_failures, failures, fetch_models, fetch_usage, forward
from services.proxy_config import normalize_proxy_url
from services.secret_store import is_configured as secret_store_configured


router = APIRouter()
SETTING_KEYS = {
    "enabled": "codex_enabled", "models": "codex_models",
    "thinking_alias": "codex_thinking_alias", "cache_mode": "codex_cache_mode",
    "cache_key": "codex_cache_key", "cache_rules": "codex_cache_rules",
    "allow_unlisted_models": "codex_allow_unlisted_models",
}
_account_index = 0


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
    name: str = "Codex"
    proxy_url: str = ""


class AccountUpdate(BaseModel):
    name: str | None = None
    proxy_url: str | None = None
    is_active: int | None = None
    disable_reason: str | None = None


class DevicePollRequest(BaseModel):
    device_auth_id: str
    user_code: str


class AuthcodeCompleteRequest(BaseModel):
    login_session_id: str
    callback_url: str


class ConfigUpdate(BaseModel):
    enabled: int | None = None
    models: str | None = None
    thinking_alias: int | None = None
    cache_mode: str | None = None
    cache_key: str | None = None
    cache_rules: str | None = None
    allow_unlisted_models: int | None = None


@router.get("/api/codex/config")
async def config(authorization: str = Header(None)):
    await _admin(authorization)
    result = {key: await get_setting(setting) for key, setting in SETTING_KEYS.items()}
    result["secret_store_configured"] = secret_store_configured()
    return result


@router.patch("/api/codex/config")
async def update_config(req: ConfigUpdate, authorization: str = Header(None)):
    await _admin(authorization)
    updates = req.model_dump(exclude_none=True)
    if updates.get("cache_mode") not in (None, "off", "auto", "explicit"):
        raise HTTPException(status_code=400, detail="缓存模式无效")
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


@router.get("/api/codex/accounts")
async def accounts(authorization: str = Header(None)):
    await _admin(authorization)
    return await codex_store.list_accounts()


@router.post("/api/codex/accounts")
async def create_account(req: AccountCreate, authorization: str = Header(None)):
    await _admin(authorization)
    if not secret_store_configured():
        raise HTTPException(status_code=400, detail="请先配置 CATCH_MASTER_KEY")
    account_id = await codex_store.add_account(req.name.strip() or "Codex", _proxy(req.proxy_url))
    return {"ok": True, "id": account_id}


@router.patch("/api/codex/accounts/{account_id}")
async def patch_account(account_id: int, req: AccountUpdate, authorization: str = Header(None)):
    await _admin(authorization)
    updates = req.model_dump(exclude_none=True)
    if "proxy_url" in updates:
        updates["proxy_url"] = _proxy(updates["proxy_url"])
    await codex_store.update_account(account_id, **updates)
    return {"ok": True}


@router.delete("/api/codex/accounts/{account_id}")
async def delete_account(account_id: int, authorization: str = Header(None)):
    await _admin(authorization)
    await codex_store.delete_account(account_id)
    return {"ok": True}


@router.post("/api/codex/accounts/{account_id}/device/start")
async def start_device(account_id: int, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        return await device_start(account_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/codex/accounts/{account_id}/authcode/start")
async def start_authcode(account_id: int, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        return await authcode_start(account_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/codex/accounts/{account_id}/authcode/complete")
async def complete_authcode(
    account_id: int, req: AuthcodeCompleteRequest, authorization: str = Header(None),
):
    await _admin(authorization)
    try:
        return await authcode_complete(account_id, req.login_session_id, req.callback_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/codex/accounts/{account_id}/device/poll")
async def poll_device(account_id: int, req: DevicePollRequest, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        return await device_poll(account_id, req.device_auth_id, req.user_code)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/codex/accounts/{account_id}/models")
async def refresh_models(account_id: int, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        token, account = await valid_token(account_id)
        models = await fetch_models(token, account)
        await codex_store.update_account(account_id, models=json.dumps(models))
        return {"models": models}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/codex/accounts/{account_id}/usage")
async def refresh_usage(account_id: int, authorization: str = Header(None)):
    await _admin(authorization)
    try:
        token, account = await valid_token(account_id)
        usage = await fetch_usage(token, account)
        await codex_store.set_usage(account_id, usage)
        return usage
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/api/codex/logs")
async def logs(account_id: int = None, limit: int = 100, offset: int = 0,
               authorization: str = Header(None)):
    await _admin(authorization)
    return await codex_store.list_requests(account_id, limit, offset)


@router.get("/api/codex/failures")
async def failure_logs(authorization: str = Header(None)):
    await _admin(authorization)
    return failures()


@router.delete("/api/codex/failures")
async def wipe_failures(authorization: str = Header(None)):
    await _admin(authorization)
    clear_failures()
    return {"ok": True}


async def _available_accounts(model: str = "") -> list[dict]:
    global _account_index
    items = [item for item in await codex_store.list_accounts(public=False)
             if int(item.get("is_active") or 0) == 1]
    if model and (await get_setting("codex_allow_unlisted_models") or "1") != "1":
        eligible = []
        for item in items:
            try:
                account_models = json.loads(item.get("models") or "[]")
            except ValueError:
                account_models = []
            if model in account_models:
                eligible.append(item)
        items = eligible
    if not items:
        return []
    start = _account_index % len(items)
    _account_index += 1
    return items[start:] + items[:start]


async def _discovered_models() -> list[str]:
    result = []
    for account in await codex_store.list_accounts(public=False):
        try:
            models = json.loads(account.get("models") or "[]")
        except ValueError:
            models = []
        for model in models:
            if model not in result:
                result.append(model)
    return result


@router.get("/codex/v1/models")
async def public_models(authorization: str = Header(None), x_api_key: str = Header(None)):
    await _client(authorization, x_api_key)
    if (await get_setting("codex_enabled") or "0") != "1":
        raise HTTPException(status_code=503, detail="Codex 转发未启用")
    return {"object": "list", "data": [
        {"id": model, "object": "model", "owned_by": "openai"}
        for model in await client_models(await _discovered_models())
    ]}


async def _proxy_request(raw: dict, downstream_stream: bool, responses_mode: bool):
    prepared = await (prepare_responses(raw) if responses_mode else prepare_chat(raw))
    body, requested_model, model, effort = prepared
    last_response = None
    for listed in await _available_accounts(model):
        try:
            token, account = await valid_token(listed["id"])
        except Exception as exc:
            await codex_store.update_account(listed["id"], is_active=0, disable_reason=str(exc))
            continue
        response, retry = await forward(
            body, downstream_stream, token, account, requested_model, model,
            effort, time.time(), responses_mode,
        )
        if not retry:
            return response
        last_response = response
        if getattr(response, "status_code", 0) in (401, 403):
            await codex_store.update_account(
                listed["id"], is_active=0,
                disable_reason=f"上游认证失败 HTTP {response.status_code}",
            )
    if last_response:
        return last_response
    raise HTTPException(status_code=503, detail="没有可用的 Codex 账号")


@router.post("/codex/v1/chat/completions")
async def chat_completions(request: Request, authorization: str = Header(None),
                           x_api_key: str = Header(None)):
    await _client(authorization, x_api_key)
    if (await get_setting("codex_enabled") or "0") != "1":
        raise HTTPException(status_code=503, detail="Codex 转发未启用")
    raw = await request.json()
    if not isinstance(raw, dict) or not raw.get("model"):
        raise HTTPException(status_code=400, detail="请求缺少 model")
    return await _proxy_request(raw, bool(raw.get("stream")), False)


@router.post("/codex/v1/responses")
async def responses(request: Request, authorization: str = Header(None),
                    x_api_key: str = Header(None)):
    await _client(authorization, x_api_key)
    if (await get_setting("codex_enabled") or "0") != "1":
        raise HTTPException(status_code=503, detail="Codex 转发未启用")
    raw = await request.json()
    if not isinstance(raw, dict) or not raw.get("model"):
        raise HTTPException(status_code=400, detail="请求缺少 model")
    return await _proxy_request(raw, bool(raw.get("stream")), True)
