from fastapi import APIRouter, HTTPException, Header
from models import get_request_logs, get_usage_summary
from routers.auth import verify_token
from services.upstream import get_recent_failures, clear_failures

router = APIRouter()


def _auth(authorization):
    return (authorization or "").replace("Bearer ", "")


@router.get("/api/logs")
async def list_logs(channel_id: int = None, source: str = "all",
                    limit: int = 50, offset: int = 0,
                    authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    return await get_request_logs(
        channel_id=channel_id, source=source, limit=limit, offset=offset
    )


@router.get("/api/usage")
async def usage_summary(channel_id: int = None, authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    return await get_usage_summary(channel_id=channel_id)


@router.get("/api/failures")
async def list_failures(authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    return get_recent_failures()


@router.delete("/api/failures")
async def wipe_failures(authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    clear_failures()
    return {"ok": True}
