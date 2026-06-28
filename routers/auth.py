import secrets
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from models import get_setting

router = APIRouter()

# 内存存 session token
_sessions: set = set()


class LoginRequest(BaseModel):
    password: str


@router.post("/api/login")
async def login(req: LoginRequest):
    admin_password = await get_setting("admin_password")
    if req.password != admin_password:
        raise HTTPException(status_code=401, detail="密码错误")
    token = secrets.token_hex(32)
    _sessions.add(token)
    return {"token": token}


async def verify_token(token: str) -> bool:
    return token in _sessions


def get_sessions():
    return _sessions
