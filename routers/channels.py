import re
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from models import (
    add_channel, get_channels, get_channel, get_channel_by_name,
    update_channel, delete_channel,
)
from routers.auth import verify_token

router = APIRouter()

_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _auth(authorization):
    token = (authorization or "").replace("Bearer ", "")
    return token


class ChannelCreate(BaseModel):
    name: str
    base_url: str
    api_key: str
    auth_mode: str = "both"
    models: str = ""
    cache_enabled: int = 1
    cache_mode: str = "auto"
    cache_ttl: str = "5m"
    cache_rules: str = "[]"


class ChannelUpdate(BaseModel):
    name: str = None
    base_url: str = None
    api_key: str = None
    auth_mode: str = None
    models: str = None
    cache_enabled: int = None
    cache_mode: str = None
    cache_ttl: str = None
    cache_rules: str = None
    is_active: int = None


def _sanitize(data: dict):
    if "auth_mode" in data and data["auth_mode"] not in ("x", "a", "both"):
        raise HTTPException(status_code=400, detail="auth_mode 必须是 x / a / both")
    if "name" in data and data["name"] is not None:
        if not _NAME_RE.match(data["name"]):
            raise HTTPException(status_code=400, detail="渠道名只能包含字母、数字、下划线、连字符")


@router.get("/api/channels")
async def list_channels(authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    channels = await get_channels()
    # 不向前端泄露完整 key，仅返回掩码
    for c in channels:
        k = c.get("api_key") or ""
        c["api_key_mask"] = (k[:4] + "****" + k[-4:]) if len(k) > 8 else "****"
    return channels


@router.post("/api/channels")
async def create_channel(req: ChannelCreate, authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    data = req.dict()
    _sanitize(data)
    if await get_channel_by_name(req.name):
        raise HTTPException(status_code=409, detail="渠道名已存在")
    await add_channel(**data)
    return {"ok": True}


@router.get("/api/channels/{channel_id}")
async def read_channel(channel_id: int, authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    c = await get_channel(channel_id)
    if not c:
        raise HTTPException(status_code=404)
    return c


@router.patch("/api/channels/{channel_id}")
async def patch_channel(channel_id: int, req: ChannelUpdate, authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    updates = {k: v for k, v in req.dict().items() if v is not None}
    _sanitize(updates)
    if "name" in updates:
        existing = await get_channel_by_name(updates["name"])
        if existing and existing["id"] != channel_id:
            raise HTTPException(status_code=409, detail="渠道名已存在")
    if not updates:
        return {"ok": True}
    await update_channel(channel_id, **updates)
    return {"ok": True}


@router.delete("/api/channels/{channel_id}")
async def remove_channel(channel_id: int, authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    await delete_channel(channel_id)
    return {"ok": True}
