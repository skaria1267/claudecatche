import time
from fastapi import APIRouter, HTTPException, Header, Request

from models import get_channel_by_name, get_setting
from services.request_builder import prepare_request_body
from services.upstream import build_headers, forward_normal, forward_stream

router = APIRouter()


def _extract_access_key(authorization: str, x_api_key: str) -> str:
    if x_api_key:
        return x_api_key
    if authorization:
        return authorization.replace("Bearer ", "").strip()
    return ""


async def _handle(channel_name: str, request: Request,
                  authorization: str, x_api_key: str):
    # 1. 校验访问密钥（在「账户设置」里配置，留空则不校验）。
    #    密钥从请求头读取：x-api-key 或 Authorization: Bearer（和标准 Claude 客户端一致）
    expected = await get_setting("access_key")
    if expected:
        provided = _extract_access_key(authorization, x_api_key)
        if provided != expected:
            raise HTTPException(status_code=401, detail="Invalid access key")

    # 2. 按渠道名找渠道
    channel = await get_channel_by_name(channel_name)
    if not channel:
        raise HTTPException(status_code=404, detail=f"渠道 '{channel_name}' 不存在")
    if int(channel.get("is_active", 1) or 0) != 1:
        raise HTTPException(status_code=403, detail=f"渠道 '{channel_name}' 已停用")

    # 3. 解析请求体
    try:
        raw_body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="请求体不是合法 JSON")

    # 4. 按渠道配置打缓存断点 + 清洗字段
    body = prepare_request_body(raw_body, channel)

    # 5. 组装上游请求头（按渠道 auth_mode）并转发到渠道的上游 URL
    headers = build_headers(channel, {k.lower(): v for k, v in request.headers.items()})
    start_time = time.time()
    forward = forward_stream if body.get("stream") else forward_normal
    return await forward(body, headers, channel, start_time)


@router.post("/{channel_name}/v1/messages")
async def proxy_messages_full(channel_name: str, request: Request,
                              authorization: str = Header(None),
                              x_api_key: str = Header(None)):
    return await _handle(channel_name, request, authorization, x_api_key)


@router.post("/{channel_name}/messages")
async def proxy_messages_short(channel_name: str, request: Request,
                               authorization: str = Header(None),
                               x_api_key: str = Header(None)):
    return await _handle(channel_name, request, authorization, x_api_key)


@router.post("/{channel_name}")
async def proxy_messages_base(channel_name: str, request: Request,
                              authorization: str = Header(None),
                              x_api_key: str = Header(None)):
    return await _handle(channel_name, request, authorization, x_api_key)
