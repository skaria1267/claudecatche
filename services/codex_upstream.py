import json
import time
import uuid
from collections import deque

import httpx
from fastapi.responses import JSONResponse, StreamingResponse

from services import codex_store


CODEX_BASE = "https://chatgpt.com/backend-api/codex"
CODEX_VERSION = "0.147.0"
USER_AGENT = f"codex_exec/{CODEX_VERSION} (Debian 13.0.0; x86_64) xterm-256color (codex_exec; {CODEX_VERSION})"
FAILURES: deque = deque(maxlen=50)


def failures() -> list:
    return list(FAILURES)


def clear_failures() -> None:
    FAILURES.clear()


def _failure(account: dict, body: dict, streaming: bool, status=None, text="", error=None):
    FAILURES.appendleft({
        "ts": int(time.time()), "account_id": account["id"], "streaming": streaming,
        "upstream_status": status, "upstream_body": text[:4000],
        "error_type": type(error).__name__ if error else "",
        "error_repr": repr(error) if error else "", "body": body,
    })


def headers(token: str, account_uid: str, accept: str = "text/event-stream") -> dict:
    session_id = str(uuid.uuid4())
    result = {
        "Authorization": f"Bearer {token}", "Content-Type": "application/json",
        "Accept": accept, "User-Agent": USER_AGENT, "originator": "codex_exec",
        "session-id": session_id, "x-client-request-id": session_id,
    }
    if account_uid:
        result["chatgpt-account-id"] = account_uid
    return result


async def fetch_models(token: str, account: dict) -> list[str]:
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        response = await client.get(
            f"{CODEX_BASE}/models?client_version={CODEX_VERSION}",
            headers=headers(token, account.get("account_uid") or "", "application/json"),
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Codex 模型拉取失败 HTTP {response.status_code}: {response.text[:300]}")
    data = response.json()
    items = (data.get("data") or data.get("models") or []) if isinstance(data, dict) else data
    return sorted({
        str(item.get("id") or item.get("slug")) if isinstance(item, dict) else str(item)
        for item in (items or [])
        if (isinstance(item, dict) and (item.get("id") or item.get("slug")))
        or (isinstance(item, str) and item)
    })


async def fetch_usage(token: str, account: dict) -> dict:
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        response = await client.get(
            "https://chatgpt.com/backend-api/wham/usage",
            headers=headers(token, account.get("account_uid") or "", "application/json"),
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Codex 用量刷新失败 HTTP {response.status_code}: {response.text[:300]}")
    return response.json()


def _usage(event: dict) -> dict:
    response = event.get("response") or {}
    return response.get("usage") or event.get("usage") or {}


def _chat_chunk(event: dict, model: str, request_id: str) -> dict | None:
    kind = event.get("type")
    delta = {}
    finish = None
    if kind == "response.created":
        delta["role"] = "assistant"
    elif kind == "response.output_text.delta":
        delta["content"] = event.get("delta") or ""
    elif kind in ("response.reasoning_text.delta", "response.reasoning_summary_text.delta"):
        delta["reasoning_content"] = event.get("delta") or ""
    elif kind == "response.output_item.added":
        item = event.get("item") or {}
        if item.get("type") == "function_call":
            delta["tool_calls"] = [{
                "index": int(event.get("output_index") or 0),
                "id": item.get("call_id") or item.get("id"), "type": "function",
                "function": {"name": item.get("name") or "", "arguments": ""},
            }]
    elif kind == "response.function_call_arguments.delta":
        delta["tool_calls"] = [{
            "index": int(event.get("output_index") or 0),
            "function": {"arguments": event.get("delta") or ""},
        }]
    elif kind in ("response.completed", "response.done"):
        finish = "stop"
    elif kind in ("response.failed", "response.incomplete"):
        finish = "error"
    else:
        return None
    result = {
        "id": request_id, "object": "chat.completion.chunk", "created": int(time.time()),
        "model": model, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    usage = _usage(event)
    if usage:
        result["usage"] = {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
            "prompt_tokens_details": usage.get("input_tokens_details") or {},
            "completion_tokens_details": usage.get("output_tokens_details") or {},
        }
    return result


async def forward(body: dict, downstream_stream: bool, token: str, account: dict,
                  requested_model: str, model: str, effort: str, started_at: float,
                  responses_mode: bool = False):
    client = httpx.AsyncClient(timeout=300, proxy=account.get("proxy_url") or None)
    try:
        response = await client.send(
            client.build_request(
                "POST", f"{CODEX_BASE}/responses",
                headers=headers(token, account.get("account_uid") or ""), json=body,
            ), stream=True,
        )
        if response.status_code >= 400:
            raw = await response.aread()
            await response.aclose()
            await client.aclose()
            text = raw.decode("utf-8", "replace")
            _failure(account, body, downstream_stream, response.status_code, text)
            await codex_store.add_request(
                account["id"], requested_model, model, effort, {},
                int((time.time() - started_at) * 1000), response.status_code,
            )
            try:
                data = json.loads(text)
            except ValueError:
                data = {"error": {"message": text[:500]}}
            return JSONResponse(data, status_code=response.status_code), response.status_code in (401, 403, 429)

        request_id = f"chatcmpl-{uuid.uuid4().hex}"
        usage = {}

        async def events():
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    event = json.loads(payload)
                except ValueError:
                    continue
                current_usage = _usage(event)
                if current_usage:
                    usage.update(current_usage)
                yield event

        if not downstream_stream:
            content = []
            reasoning = []
            tool_calls = {}
            status = response.status_code
            try:
                async for event in events():
                    kind = event.get("type")
                    if kind == "response.output_text.delta":
                        content.append(str(event.get("delta") or ""))
                    elif kind in ("response.reasoning_text.delta", "response.reasoning_summary_text.delta"):
                        reasoning.append(str(event.get("delta") or ""))
                    elif kind == "response.output_item.added":
                        item = event.get("item") or {}
                        if item.get("type") == "function_call":
                            idx = int(event.get("output_index") or 0)
                            tool_calls[idx] = {
                                "id": item.get("call_id") or item.get("id"), "type": "function",
                                "function": {"name": item.get("name") or "", "arguments": ""},
                            }
                    elif kind == "response.function_call_arguments.delta":
                        idx = int(event.get("output_index") or 0)
                        tool_calls.setdefault(idx, {
                            "type": "function", "function": {"name": "", "arguments": ""},
                        })
                        tool_calls[idx]["function"]["arguments"] += str(event.get("delta") or "")
            except Exception as exc:
                status = 502
                _failure(account, body, False, error=exc)
            finally:
                await response.aclose()
                await client.aclose()
                await codex_store.add_request(
                    account["id"], requested_model, model, effort, usage,
                    int((time.time() - started_at) * 1000), status,
                )
            if responses_mode:
                output = [{
                    "type": "message", "role": "assistant",
                    "content": [{"type": "output_text", "text": "".join(content)}],
                }]
                return JSONResponse({
                    "id": request_id, "object": "response", "model": model,
                    "output": output, "usage": usage,
                }, status_code=status), False
            message = {"role": "assistant", "content": "".join(content)}
            if reasoning:
                message["reasoning_content"] = "".join(reasoning)
            if tool_calls:
                message["tool_calls"] = [tool_calls[key] for key in sorted(tool_calls)]
            normalized_usage = {
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "prompt_tokens_details": usage.get("input_tokens_details") or {},
                "completion_tokens_details": usage.get("output_tokens_details") or {},
            }
            return JSONResponse({
                "id": request_id, "object": "chat.completion", "created": int(time.time()),
                "model": model, "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
                "usage": normalized_usage,
            }, status_code=status), False

        async def generate():
            status = response.status_code
            try:
                async for event in events():
                    if responses_mode:
                        event_name = event.get("type", "message")
                        yield f"event: {event_name}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                    else:
                        chunk = _chat_chunk(event, model, request_id)
                        if chunk:
                            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                if not responses_mode:
                    yield "data: [DONE]\n\n"
            except Exception as exc:
                status = 502
                _failure(account, body, True, error=exc)
                error = {"error": {"message": str(exc)}}
                yield f"data: {json.dumps(error, ensure_ascii=False)}\n\n"
            finally:
                await response.aclose()
                await client.aclose()
                await codex_store.add_request(
                    account["id"], requested_model, model, effort, usage,
                    int((time.time() - started_at) * 1000), status,
                )

        return StreamingResponse(generate(), media_type="text/event-stream"), False
    except Exception as exc:
        await client.aclose()
        _failure(account, body, downstream_stream, error=exc)
        await codex_store.add_request(
            account["id"], requested_model, model, effort, {},
            int((time.time() - started_at) * 1000), 502,
        )
        return JSONResponse({"error": {"message": str(exc)}}, status_code=502), True
