from fastapi import APIRouter, Depends, HTTPException, Header, Query
from models import get_request_logs, get_usage_summary
from routers.auth import verify_token
from services import usage_stats
from services.upstream import get_recent_failures, clear_failures
from services.codex_upstream import failures as codex_failures
from services.claudecode_upstream import failures as claudecode_failures
from services.usage_filters import usage_period

router = APIRouter()


def _auth(authorization):
    return (authorization or "").replace("Bearer ", "")


@router.get("/api/logs")
async def list_logs(channel_id: int = None, source: str = "all",
                    limit: int = 50, offset: int = 0,
                    status: str = None, q: str = None,
                    authorization: str = Header(None),
                    period: dict = Depends(usage_period)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    return await get_request_logs(
        channel_id=channel_id, source=source, limit=limit, offset=offset,
        status=status, q=q, **period
    )


@router.get("/api/usage")
async def usage_summary(channel_id: int = None, authorization: str = Header(None),
                        period: dict = Depends(usage_period)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    return await get_usage_summary(channel_id=channel_id, **period)


@router.get("/api/usage/daily")
async def usage_daily(source: str = "main", target_id: int = None,
                      tz_offset: int = Query(0, ge=-usage_stats.MAX_TZ_OFFSET, le=usage_stats.MAX_TZ_OFFSET),
                      authorization: str = Header(None),
                      period: dict = Depends(usage_period)):
    """按天汇总。target_id 对 claude / main 是渠道 ID，对 codex / claudecode 是账号 ID。"""
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    if source not in usage_stats.SOURCES:
        raise HTTPException(status_code=400, detail="未知的用量来源")
    return await usage_stats.daily_usage(source, target_id, tz_offset=tz_offset, **period)


@router.get("/api/overview")
async def overview(tz_offset: int = Query(0, ge=-usage_stats.MAX_TZ_OFFSET, le=usage_stats.MAX_TZ_OFFSET),
                   authorization: str = Header(None)):
    if not await verify_token(_auth(authorization)):
        raise HTTPException(status_code=401)
    result = await usage_stats.overview(tz_offset)
    result["failures"] = {
        "main": len(get_recent_failures()),
        "codex": len(codex_failures()),
        "claudecode": len(claudecode_failures()),
    }
    return result


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
