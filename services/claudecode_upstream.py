import json
import time
from collections import deque

import httpx
from fastapi.responses import JSONResponse, StreamingResponse

from services import claudecode_store
from services.claudecode_auth import ANTHROPIC_BETA, ANTHROPIC_VERSION, CLAUDE_BASE


FAILURES: deque = deque(maxlen=50)
AUTH_FAILURES = {401, 403}
RETRY_FAILURES = {401, 403, 429}


def failures() -> list:
    return list(FAILURES)


def clear_failures() -> None:
    FAILURES.clear()


def _failure(account_id: int, body: dict, streaming: bool, response=None, error=None) -> None:
    FAILURES.appendleft({
        "ts": int(time.time()),
        "account_id": account_id,
        "streaming": streaming,
        "upstream_status": getattr(response, "status_code", None),
        "upstream_body": (getattr(response, "text", "") or "")[:4000],
        "error_type": type(error).__name__ if error else "",
        "error_repr": repr(error) if error else "",
        "body": body,
    })


def request_headers(token: str, user_agent: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": ANTHROPIC_BETA,
        "content-type": "application/json",
        "user-agent": user_agent,
    }


async def forward(body: dict, token: str, user_agent: str, account: dict,
                  effort: str, started_at: float):
    return await (_stream if body.get("stream") else _normal)(
        body, token, user_agent, account, effort, started_at
    )


async def _normal(body, token, user_agent, account, effort, started_at):
    try:
        async with httpx.AsyncClient(timeout=300, proxy=account.get("proxy_url") or None) as client:
            response = await client.post(
                f"{CLAUDE_BASE}/v1/messages",
                headers=request_headers(token, user_agent),
                json=body,
            )
        try:
            data = response.json()
        except ValueError:
            data = {"error": {"message": response.text[:500]}}
        await claudecode_store.add_request(
            account["id"], body.get("model", ""), effort, data.get("usage") or {},
            int((time.time() - started_at) * 1000), response.status_code,
        )
        if response.status_code >= 400:
            _failure(account["id"], body, False, response=response)
        retry = response.status_code in RETRY_FAILURES
        if response.status_code in AUTH_FAILURES:
            await claudecode_store.update_account(
                account["id"], is_active=0,
                disable_reason=f"上游认证失败 HTTP {response.status_code}",
            )
        return JSONResponse(data, status_code=response.status_code), retry
    except Exception as exc:
        _failure(account["id"], body, False, error=exc)
        await claudecode_store.add_request(
            account["id"], body.get("model", ""), effort, {},
            int((time.time() - started_at) * 1000), 502,
        )
        return JSONResponse({"error": {"message": str(exc)}}, status_code=502), True


async def _stream(body, token, user_agent, account, effort, started_at):
    client = httpx.AsyncClient(timeout=300, proxy=account.get("proxy_url") or None)
    try:
        response = await client.send(
            client.build_request(
                "POST", f"{CLAUDE_BASE}/v1/messages",
                headers=request_headers(token, user_agent), json=body,
            ),
            stream=True,
        )
        if response.status_code >= 400:
            raw = await response.aread()
            await response.aclose()
            await client.aclose()
            text = raw.decode("utf-8", "replace")
            fake = type("Response", (), {"status_code": response.status_code, "text": text})()
            _failure(account["id"], body, True, response=fake)
            await claudecode_store.add_request(
                account["id"], body.get("model", ""), effort, {},
                int((time.time() - started_at) * 1000), response.status_code,
            )
            retry = response.status_code in RETRY_FAILURES
            if response.status_code in AUTH_FAILURES:
                await claudecode_store.update_account(
                    account["id"], is_active=0,
                    disable_reason=f"上游认证失败 HTTP {response.status_code}",
                )
            try:
                data = json.loads(text)
            except ValueError:
                data = {"error": {"message": text[:500]}}
            return JSONResponse(data, status_code=response.status_code), retry

        async def generate():
            usage = {}
            status = response.status_code
            try:
                async for line in response.aiter_lines():
                    yield line + "\n"
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:].strip())
                    except ValueError:
                        continue
                    current = event.get("message", {}).get("usage") or event.get("usage")
                    if isinstance(current, dict):
                        usage.update(current)
            except Exception as exc:
                status = 502
                _failure(account["id"], body, True, error=exc)
            finally:
                await response.aclose()
                await client.aclose()
                await claudecode_store.add_request(
                    account["id"], body.get("model", ""), effort, usage,
                    int((time.time() - started_at) * 1000), status,
                )

        return StreamingResponse(generate(), media_type="text/event-stream"), False
    except Exception as exc:
        await client.aclose()
        _failure(account["id"], body, True, error=exc)
        await claudecode_store.add_request(
            account["id"], body.get("model", ""), effort, {},
            int((time.time() - started_at) * 1000), 502,
        )
        return JSONResponse({"error": {"message": str(exc)}}, status_code=502), True
