import time
import json
import logging
from collections import deque
import httpx
from fastapi.responses import JSONResponse, StreamingResponse

from models import add_request_log


ANTHROPIC_VERSION = "2023-06-01"

# 最近失败请求滚动缓冲：排查上游错误用。
_FAILURES: deque = deque(maxlen=30)


def record_failure(channel_name: str, body: dict, streaming: bool,
                   error_type: str = "", error_repr: str = "",
                   upstream_status: int | None = None, upstream_body: str | None = None):
    _FAILURES.appendleft({
        "ts": int(time.time()),
        "channel": channel_name,
        "streaming": streaming,
        "error_type": error_type,
        "error_repr": error_repr,
        "upstream_status": upstream_status,
        "upstream_body": upstream_body,
        "body": body,
    })


def get_recent_failures() -> list:
    return list(_FAILURES)


def clear_failures():
    _FAILURES.clear()


def _normalize_base_url(base_url: str) -> str:
    """把渠道 base_url 规整成 .../v1/messages 的完整 endpoint。"""
    url = (base_url or "").strip().rstrip("/")
    if url.endswith("/v1/messages"):
        return url
    if url.endswith("/v1"):
        return url + "/messages"
    return url + "/v1/messages"


def build_headers(channel: dict, incoming_headers: dict) -> dict:
    """根据渠道 auth_mode 组装发往上游的请求头。"""
    key = channel["api_key"]
    mode = channel.get("auth_mode", "both")
    headers = {
        "anthropic-version": incoming_headers.get("anthropic-version", ANTHROPIC_VERSION),
        "content-type": "application/json",
    }
    beta = incoming_headers.get("anthropic-beta")
    if beta:
        headers["anthropic-beta"] = beta
    if mode in ("x", "both"):
        headers["x-api-key"] = key
    if mode in ("a", "both"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _endpoint(channel: dict) -> str:
    return _normalize_base_url(channel["base_url"])


async def _log(channel: dict, model: str, usage: dict, duration_ms: int, status: int):
    await add_request_log(
        channel_id=channel["id"], channel_name=channel["name"], model=model,
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        cache_creation_tokens=usage.get("cache_creation_input_tokens", 0),
        cache_read_tokens=usage.get("cache_read_input_tokens", 0),
        duration_ms=duration_ms, status=status,
    )


async def forward_normal(body: dict, headers: dict, channel: dict, start_time: float):
    """非流式转发。"""
    model = body.get("model", "")
    url = _endpoint(channel)
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(url, headers=headers, json=body)
        duration_ms = int((time.time() - start_time) * 1000)
        try:
            data = resp.json()
        except Exception:
            data = {"error": {"message": resp.text[:500]}}
        await _log(channel, model, data.get("usage", {}), duration_ms, resp.status_code)

        if resp.status_code >= 400:
            record_failure(channel["name"], body, streaming=False,
                           upstream_status=resp.status_code, upstream_body=resp.text[:4000])

        return JSONResponse(content=data, status_code=resp.status_code)

    except Exception as e:
        err_type, err_repr = type(e).__name__, repr(e)
        logging.exception(f"[UPSTREAM] 请求异常 channel={channel['name']}")
        record_failure(channel["name"], body, streaming=False,
                       error_type=err_type, error_repr=err_repr)
        return JSONResponse(content={"error": f"{err_type}: {err_repr}"}, status_code=502)


async def forward_stream(body: dict, headers: dict, channel: dict, start_time: float):
    """流式转发：先探测状态码，错误则直接返回，正常则流式透传。"""
    model = body.get("model", "")
    url = _endpoint(channel)
    try:
        client = httpx.AsyncClient(timeout=300)
        resp = await client.send(
            client.build_request("POST", url, headers=headers, json=body),
            stream=True,
        )

        if resp.status_code >= 400:
            body_bytes = await resp.aread()
            await resp.aclose()
            await client.aclose()
            record_failure(channel["name"], body, streaming=True,
                           upstream_status=resp.status_code,
                           upstream_body=body_bytes.decode("utf-8", "replace")[:4000])
            duration_ms = int((time.time() - start_time) * 1000)
            await _log(channel, model, {}, duration_ms, resp.status_code)
            try:
                err_data = json.loads(body_bytes)
            except Exception:
                err_data = {"error": {"message": body_bytes.decode("utf-8", "replace")[:500]}}
            return JSONResponse(content=err_data, status_code=resp.status_code)

        upstream_status = resp.status_code
        usage = {
            "input_tokens": 0, "output_tokens": 0,
            "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
        }

        async def generate():
            try:
                async for line in resp.aiter_lines():
                    if not line:
                        yield "\n"
                        continue
                    yield f"{line}\n"
                    if not line.startswith("data:"):
                        continue
                    try:
                        data = json.loads(line[5:].strip())
                    except Exception:
                        continue
                    if data.get("type") == "message_start":
                        u = data.get("message", {}).get("usage", {})
                        usage["input_tokens"] = u.get("input_tokens", 0)
                        usage["cache_creation_input_tokens"] = u.get("cache_creation_input_tokens", 0)
                        usage["cache_read_input_tokens"] = u.get("cache_read_input_tokens", 0)
                    elif data.get("type") == "message_delta":
                        usage["output_tokens"] = data.get("usage", {}).get("output_tokens", 0)
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n"
            finally:
                await resp.aclose()
                await client.aclose()
                duration_ms = int((time.time() - start_time) * 1000)
                await _log(channel, model, usage, duration_ms, upstream_status)

        return StreamingResponse(generate(), media_type="text/event-stream")

    except Exception as e:
        err_type, err_repr = type(e).__name__, repr(e)
        logging.exception(f"[UPSTREAM-STREAM] 请求异常 channel={channel['name']}")
        record_failure(channel["name"], body, streaming=True,
                       error_type=err_type, error_repr=err_repr)
        return JSONResponse(content={"error": f"{err_type}: {err_repr}"}, status_code=502)
