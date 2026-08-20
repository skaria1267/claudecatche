import json
import time

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from models import get_openai_config, get_openai_usage, get_setting, update_openai_config
from routers.auth import verify_token
from services.openai_request_builder import build_client_models, prepare_openai_request
from services.openai_upstream import (
    build_openai_headers,
    fetch_openai_models,
    forward_openai_normal,
    forward_openai_stream,
    models_url,
    normalize_base_url,
)


router = APIRouter()
_PROXY_SCHEMES = ("http://", "https://", "socks5://", "socks5h://", "socks4://")
_CACHE_MODES = ("off", "implicit", "explicit")


def _admin_token(authorization: str | None) -> str:
    return (authorization or "").replace("Bearer ", "", 1).strip()


async def _require_admin(authorization: str | None) -> None:
    if not await verify_token(_admin_token(authorization)):
        raise HTTPException(status_code=401)


def _validate_proxy(proxy_url: str) -> str:
    value = (proxy_url or "").strip()
    if value and not value.startswith(_PROXY_SCHEMES):
        raise HTTPException(
            status_code=400,
            detail="代理地址需以 http:// / https:// / socks5:// / socks5h:// / socks4:// 开头",
        )
    return value


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return value[:4] + "****" + value[-4:]


def _public_config(config: dict) -> dict:
    result = {key: value for key, value in config.items() if key != "api_key"}
    result["api_key_configured"] = bool(config.get("api_key"))
    result["api_key_mask"] = _mask_secret(config.get("api_key") or "")
    return result


def _client_key(authorization: str | None, x_api_key: str | None) -> str:
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer":
            return value.strip()
    return (x_api_key or "").strip()


async def _require_client_access(authorization: str | None,
                                 x_api_key: str | None) -> None:
    expected = await get_setting("access_key")
    if expected and _client_key(authorization, x_api_key) != expected:
        raise HTTPException(status_code=401, detail="Invalid access key")


async def _active_config() -> dict:
    config = await get_openai_config()
    if not config or int(config.get("is_active", 0) or 0) != 1:
        raise HTTPException(status_code=503, detail="OpenAI 转发未启用")
    if not config.get("api_key"):
        raise HTTPException(status_code=503, detail="OpenAI API Key 未配置")
    return config


class OpenAIConfigUpdate(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    models: str | None = None
    is_active: int | None = None
    proxy_url: str | None = None
    thinking_alias: int | None = None
    cache_mode: str | None = None
    cache_key: str | None = None
    cache_rules: str | None = None


class OpenAIConnectionRequest(BaseModel):
    base_url: str | None = None
    api_key: str = ""
    proxy_url: str | None = None


@router.get("/api/openai/config")
async def read_openai_config(authorization: str = Header(None)):
    await _require_admin(authorization)
    return _public_config(await get_openai_config())


@router.patch("/api/openai/config")
async def patch_openai_config(req: OpenAIConfigUpdate,
                              authorization: str = Header(None)):
    await _require_admin(authorization)
    updates = req.model_dump(exclude_none=True, exclude={"clear_api_key"})
    if "base_url" in updates:
        updates["base_url"] = normalize_base_url(updates["base_url"])
        if not updates["base_url"].startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Base URL 必须以 http:// 或 https:// 开头")
    if "proxy_url" in updates:
        updates["proxy_url"] = _validate_proxy(updates["proxy_url"])
    if "cache_mode" in updates and updates["cache_mode"] not in _CACHE_MODES:
        raise HTTPException(status_code=400, detail="cache_mode 必须是 off / implicit / explicit")
    if "cache_key" in updates:
        updates["cache_key"] = updates["cache_key"].strip()
        if len(updates["cache_key"]) > 64:
            raise HTTPException(status_code=400, detail="缓存 Key 最多 64 个字符")
    if "cache_rules" in updates:
        try:
            rules = json.loads(updates["cache_rules"] or "[]")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="缓存规则不是合法 JSON") from exc
        if not isinstance(rules, list) or len(rules) > 4:
            raise HTTPException(status_code=400, detail="缓存规则最多 4 条")
    if req.clear_api_key:
        updates["api_key"] = ""
    elif not (updates.get("api_key") or "").strip():
        updates.pop("api_key", None)
    if "api_key" in updates:
        updates["api_key"] = updates["api_key"].strip()
    await update_openai_config(**updates)
    return {"ok": True}


async def _connection_values(req: OpenAIConnectionRequest) -> tuple[dict, str, str, str | None]:
    config = await get_openai_config()
    base_url = normalize_base_url(req.base_url or config["base_url"])
    api_key = (req.api_key or "").strip() or config.get("api_key", "")
    proxy_url = _validate_proxy(
        config.get("proxy_url", "") if req.proxy_url is None else req.proxy_url
    )
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 OpenAI API Key")
    return config, base_url, api_key, proxy_url or None


@router.post("/api/openai/fetch-models")
async def fetch_models(req: OpenAIConnectionRequest,
                       authorization: str = Header(None)):
    await _require_admin(authorization)
    _, base_url, api_key, proxy = await _connection_values(req)
    try:
        models = await fetch_openai_models(base_url, api_key, proxy)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"拉取失败：{exc}") from exc
    return {"models": models}


@router.post("/api/openai/test")
async def test_openai_connection(req: OpenAIConnectionRequest,
                                 authorization: str = Header(None)):
    await _require_admin(authorization)
    _, base_url, api_key, proxy = await _connection_values(req)
    started_at = time.time()
    try:
        async with httpx.AsyncClient(timeout=20, proxy=proxy) as client:
            response = await client.get(
                models_url(base_url), headers=build_openai_headers(api_key)
            )
        if response.status_code >= 400:
            return {
                "ok": False,
                "status": response.status_code,
                "latency_ms": int((time.time() - started_at) * 1000),
                "error": response.text[:300],
            }
        return {
            "ok": True,
            "status": response.status_code,
            "latency_ms": int((time.time() - started_at) * 1000),
        }
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


@router.get("/api/openai/usage")
async def openai_usage(authorization: str = Header(None)):
    await _require_admin(authorization)
    return await get_openai_usage()


@router.get("/gpt/v1/models")
async def public_openai_models(authorization: str = Header(None),
                               x_api_key: str = Header(None)):
    await _require_client_access(authorization, x_api_key)
    config = await _active_config()
    return {
        "object": "list",
        "data": [
            {"id": model, "object": "model", "owned_by": "openai"}
            for model in build_client_models(config)
        ],
    }


@router.post("/gpt/v1/chat/completions")
async def public_chat_completions(request: Request,
                                  authorization: str = Header(None),
                                  x_api_key: str = Header(None)):
    await _require_client_access(authorization, x_api_key)
    config = await _active_config()
    try:
        raw_body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="请求体不是合法 JSON") from exc
    if not isinstance(raw_body, dict):
        raise HTTPException(status_code=400, detail="请求体必须是 JSON 对象")
    if not raw_body.get("model") or not isinstance(raw_body.get("messages"), list):
        raise HTTPException(status_code=400, detail="请求缺少 model 或 messages")
    body = prepare_openai_request(raw_body, config)
    started_at = time.time()
    if body.get("stream"):
        return await forward_openai_stream(body, config, started_at)
    return await forward_openai_normal(body, config, started_at)
