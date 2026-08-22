import json
import logging
import time

import httpx
from fastapi.responses import JSONResponse, StreamingResponse

from models import add_openai_request_log
from services.upstream import record_failure


def normalize_base_url(base_url: str) -> str:
    url = (base_url or "https://api.openai.com/v1").strip().rstrip("/")
    if url.endswith("/chat/completions"):
        return url[: -len("/chat/completions")]
    return url


def chat_completions_url(base_url: str) -> str:
    return normalize_base_url(base_url) + "/chat/completions"


def models_url(base_url: str) -> str:
    return normalize_base_url(base_url) + "/models"


def build_openai_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


async def fetch_openai_models(base_url: str, api_key: str,
                              proxy: str | None = None) -> list[str]:
    async with httpx.AsyncClient(timeout=30, proxy=proxy) as client:
        response = await client.get(
            models_url(base_url), headers=build_openai_headers(api_key)
        )
    if response.status_code >= 400:
        raise RuntimeError(f"OpenAI 返回 {response.status_code}: {response.text[:300]}")
    try:
        items = response.json().get("data", [])
    except Exception as exc:
        raise RuntimeError(f"OpenAI 返回的不是 JSON: {response.text[:200]}") from exc
    ids = sorted({str(item.get("id")) for item in items
                  if isinstance(item, dict) and item.get("id")})
    return ids


def _usage_values(usage: dict) -> dict:
    prompt_details = (
        usage.get("prompt_tokens_details")
        or usage.get("input_tokens_details")
        or {}
    )
    completion_details = (
        usage.get("completion_tokens_details")
        or usage.get("output_tokens_details")
        or {}
    )
    return {
        "prompt_tokens": (
            usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0) or 0
        ),
        "completion_tokens": (
            usage.get("completion_tokens", 0) or usage.get("output_tokens", 0) or 0
        ),
        "cached_tokens": prompt_details.get("cached_tokens", 0) or 0,
        "cache_write_tokens": (
            prompt_details.get("cache_write_tokens", 0)
            or prompt_details.get("cache_creation_tokens", 0)
            or usage.get("cache_write_tokens", 0)
            or usage.get("cache_creation_tokens", 0)
            or 0
        ),
        "reasoning_tokens": completion_details.get("reasoning_tokens", 0) or 0,
    }


async def _log(model: str, usage: dict, started_at: float, status: int) -> None:
    values = _usage_values(usage)
    await add_openai_request_log(
        model=model,
        duration_ms=int((time.time() - started_at) * 1000),
        status=status,
        **values,
    )


async def forward_openai_normal(body: dict, config: dict, started_at: float):
    model = body.get("model", "")
    try:
        async with httpx.AsyncClient(
            timeout=300, proxy=config.get("proxy_url") or None
        ) as client:
            response = await client.post(
                chat_completions_url(config["base_url"]),
                headers=build_openai_headers(config["api_key"]),
                json=body,
            )
        try:
            data = response.json()
        except Exception:
            data = {"error": {"message": response.text[:500]}}
        await _log(model, data.get("usage") or {}, started_at, response.status_code)
        if response.status_code >= 400:
            record_failure(
                "OpenAI", body, streaming=False,
                upstream_status=response.status_code,
                upstream_body=response.text[:4000],
            )
        return JSONResponse(content=data, status_code=response.status_code)
    except Exception as exc:
        logging.exception("[OPENAI-UPSTREAM] request failed")
        record_failure(
            "OpenAI", body, streaming=False,
            error_type=type(exc).__name__, error_repr=repr(exc),
        )
        await _log(model, {}, started_at, 502)
        return JSONResponse(
            content={"error": {"message": f"{type(exc).__name__}: {exc}"}},
            status_code=502,
        )


async def forward_openai_stream(body: dict, config: dict, started_at: float):
    model = body.get("model", "")
    client = None
    response = None
    try:
        client = httpx.AsyncClient(timeout=300, proxy=config.get("proxy_url") or None)
        response = await client.send(
            client.build_request(
                "POST",
                chat_completions_url(config["base_url"]),
                headers=build_openai_headers(config["api_key"]),
                json=body,
            ),
            stream=True,
        )
        if response.status_code >= 400:
            raw = await response.aread()
            await response.aclose()
            await client.aclose()
            try:
                data = json.loads(raw)
            except Exception:
                data = {"error": {"message": raw.decode("utf-8", "replace")[:500]}}
            record_failure(
                "OpenAI", body, streaming=True,
                upstream_status=response.status_code,
                upstream_body=raw.decode("utf-8", "replace")[:4000],
            )
            await _log(model, {}, started_at, response.status_code)
            return JSONResponse(content=data, status_code=response.status_code)

        status = response.status_code
        usage = {}

        async def generate():
            log_status = status
            try:
                async for line in response.aiter_lines():
                    yield line + "\n"
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        event = json.loads(payload)
                    except Exception:
                        continue
                    if isinstance(event.get("usage"), dict):
                        usage.update(event["usage"])
            except Exception as exc:
                log_status = 502
                logging.exception("[OPENAI-UPSTREAM-STREAM] response interrupted")
                record_failure(
                    "OpenAI", body, streaming=True,
                    error_type=type(exc).__name__, error_repr=repr(exc),
                )
                yield "data: " + json.dumps({
                    "error": {"message": f"{type(exc).__name__}: {exc}"}
                }, ensure_ascii=False) + "\n\n"
            finally:
                await response.aclose()
                await client.aclose()
                await _log(model, usage, started_at, log_status)

        return StreamingResponse(generate(), media_type="text/event-stream")
    except Exception as exc:
        logging.exception("[OPENAI-UPSTREAM-STREAM] request failed")
        if response is not None:
            await response.aclose()
        if client is not None:
            await client.aclose()
        record_failure(
            "OpenAI", body, streaming=True,
            error_type=type(exc).__name__, error_repr=repr(exc),
        )
        await _log(model, {}, started_at, 502)
        return JSONResponse(
            content={"error": {"message": f"{type(exc).__name__}: {exc}"}},
            status_code=502,
        )
