from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from models import get_setting, set_setting
from routers.auth import verify_token

router = APIRouter()


class SettingUpdate(BaseModel):
    value: str


@router.get("/api/settings/{key}")
async def read_setting(key: str, authorization: str = Header(None)):
    token = (authorization or "").replace("Bearer ", "")
    if not await verify_token(token):
        raise HTTPException(status_code=401)
    value = await get_setting(key)
    return {"key": key, "value": value}


@router.post("/api/settings/{key}")
async def write_setting(key: str, req: SettingUpdate, authorization: str = Header(None)):
    token = (authorization or "").replace("Bearer ", "")
    if not await verify_token(token):
        raise HTTPException(status_code=401)
    await set_setting(key, req.value)
    return {"ok": True}
