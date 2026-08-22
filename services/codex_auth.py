import base64
import hashlib
import json
import secrets
import time
from urllib.parse import parse_qs, quote, urlencode, urlparse

import httpx

from services import codex_store


OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
TOKEN_URL = "https://auth.openai.com/oauth/token"
AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
AUTHCODE_REDIRECT_URI = "http://localhost:1455/auth/callback"
OAUTH_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke"
DEVICE_USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode"
DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token"
DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device"
DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback"
AUTH_SESSION_TTL = 600
_auth_sessions: dict[str, dict] = {}


def _prune_auth_sessions() -> None:
    now = time.monotonic()
    expired = [key for key, value in _auth_sessions.items() if value["expires_at"] <= now]
    for key in expired:
        _auth_sessions.pop(key, None)


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _jwt_payload(token: str) -> dict:
    try:
        raw = token.split(".")[1]
        raw += "=" * (-len(raw) % 4)
        return json.loads(base64.urlsafe_b64decode(raw))
    except Exception:
        return {}


def _identity(id_token: str) -> tuple[str, str]:
    payload = _jwt_payload(id_token)
    auth = payload.get("https://api.openai.com/auth") or {}
    profile = payload.get("https://api.openai.com/profile") or {}
    return (
        str(auth.get("chatgpt_account_id") or ""),
        str(payload.get("email") or profile.get("email") or ""),
    )


async def _post_json(url: str, body: dict, proxy: str = "") -> httpx.Response:
    async with httpx.AsyncClient(timeout=30, proxy=proxy or None) as client:
        return await client.post(
            url,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            json=body,
        )


async def device_start(account_id: int) -> dict:
    account = await codex_store.get_account(account_id)
    if not account:
        raise RuntimeError("账号不存在")
    response = await _post_json(
        DEVICE_USERCODE_URL,
        {"client_id": OAUTH_CLIENT_ID},
        account.get("proxy_url") or "",
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Codex 设备授权启动失败 HTTP {response.status_code}: {response.text[:300]}")
    data = response.json()
    return {
        "device_auth_id": data["device_auth_id"],
        "user_code": data.get("user_code") or data.get("usercode"),
        "verification_url": DEVICE_VERIFICATION_URL,
        "interval": max(int(data.get("interval") or 5), 1),
    }


async def _exchange_code(
    code: str, verifier: str, proxy: str, redirect_uri: str = DEVICE_REDIRECT_URI,
) -> dict:
    async with httpx.AsyncClient(timeout=30, proxy=proxy or None) as client:
        response = await client.post(
            TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": OAUTH_CLIENT_ID,
                "code_verifier": verifier,
            },
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Codex token 交换失败 HTTP {response.status_code}: {response.text[:300]}")
    return response.json()


async def authcode_start(account_id: int) -> dict:
    account = await codex_store.get_account(account_id)
    if not account:
        raise RuntimeError("账号不存在")
    _prune_auth_sessions()
    verifier, challenge = _pkce()
    state = secrets.token_urlsafe(24)
    session_id = secrets.token_urlsafe(24)
    _auth_sessions[session_id] = {
        "account_id": account_id,
        "verifier": verifier,
        "state": state,
        "redirect_uri": AUTHCODE_REDIRECT_URI,
        "expires_at": time.monotonic() + AUTH_SESSION_TTL,
    }
    query = urlencode(
        {
            "response_type": "code",
            "client_id": OAUTH_CLIENT_ID,
            "redirect_uri": AUTHCODE_REDIRECT_URI,
            "scope": OAUTH_SCOPE,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "id_token_add_organizations": "true",
            "codex_cli_simplified_flow": "true",
            "state": state,
            "originator": "codex_exec",
        },
        quote_via=quote,
    )
    return {
        "login_session_id": session_id,
        "authorize_url": f"{AUTHORIZE_URL}?{query}",
        "expires_in": AUTH_SESSION_TTL,
    }


def _callback_values(callback_url: str) -> tuple[str, str]:
    parsed = urlparse(callback_url.strip())
    try:
        port = parsed.port
    except ValueError as exc:
        raise RuntimeError("请粘贴浏览器地址栏中的完整 localhost 回调 URL") from exc
    if (
        parsed.scheme != "http"
        or parsed.hostname not in ("localhost", "127.0.0.1")
        or port != 1455
        or parsed.path != "/auth/callback"
    ):
        raise RuntimeError("请粘贴浏览器地址栏中的完整 localhost 回调 URL")
    query = parse_qs(parsed.query)
    if query.get("error"):
        raise RuntimeError(f"OpenAI 授权失败: {query['error'][0]}")
    code = str((query.get("code") or [""])[0]).strip()
    state = str((query.get("state") or [""])[0]).strip()
    if not code or not state:
        raise RuntimeError("回调 URL 缺少 code 或 state")
    return code, state


async def authcode_complete(account_id: int, session_id: str, callback_url: str) -> dict:
    _prune_auth_sessions()
    session = _auth_sessions.get(session_id)
    if not session or session["account_id"] != account_id:
        raise RuntimeError("授权会话不存在或已过期，请重新连接")
    code, callback_state = _callback_values(callback_url)
    if not secrets.compare_digest(callback_state, session["state"]):
        raise RuntimeError("回调 state 不匹配，请重新连接")
    account = await codex_store.get_account(account_id)
    if not account:
        raise RuntimeError("账号不存在")
    tokens = await _exchange_code(
        code,
        session["verifier"],
        account.get("proxy_url") or "",
        session["redirect_uri"],
    )
    _auth_sessions.pop(session_id, None)
    await save_login(account_id, tokens)
    return {"status": "ready", "account": await codex_store.get_account(account_id)}


async def device_poll(account_id: int, device_auth_id: str, user_code: str) -> dict:
    account = await codex_store.get_account(account_id)
    if not account:
        raise RuntimeError("账号不存在")
    proxy = account.get("proxy_url") or ""
    response = await _post_json(
        DEVICE_TOKEN_URL,
        {"device_auth_id": device_auth_id, "user_code": user_code},
        proxy,
    )
    if response.status_code in (403, 404):
        return {"status": "pending"}
    if response.status_code >= 400:
        raise RuntimeError(f"Codex 设备授权失败 HTTP {response.status_code}: {response.text[:300]}")
    data = response.json()
    tokens = await _exchange_code(data["authorization_code"], data["code_verifier"], proxy)
    await save_login(account_id, tokens)
    return {"status": "ready", "account": await codex_store.get_account(account_id)}


async def save_login(account_id: int, tokens: dict) -> None:
    access_token = str(tokens.get("access_token") or "")
    if not access_token:
        raise RuntimeError("Codex token 响应缺少 access_token")
    current = await codex_store.get_account(account_id, decrypt=True)
    refresh_token = str(tokens.get("refresh_token") or (current or {}).get("refresh_token") or "")
    id_token = str(tokens.get("id_token") or (current or {}).get("id_token") or "")
    account_uid, email = _identity(id_token)
    expires_at = int(time.time()) + int(tokens.get("expires_in") or 3600)
    await codex_store.save_tokens(
        account_id, access_token, refresh_token, id_token, expires_at,
        account_uid or str((current or {}).get("account_uid") or ""),
        email or str((current or {}).get("email") or ""),
    )


async def valid_token(account_id: int) -> tuple[str, dict]:
    account = await codex_store.get_account(account_id, decrypt=True)
    if not account:
        raise RuntimeError("账号不存在")
    token = account.get("access_token") or ""
    if token and int(account.get("token_expires_at") or 0) > int(time.time()) + 60:
        return token, account
    refresh_token = account.get("refresh_token") or ""
    if not refresh_token:
        raise RuntimeError("账号未授权或授权已失效")
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        response = await client.post(
            TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": OAUTH_CLIENT_ID,
            },
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Codex token 刷新失败 HTTP {response.status_code}: {response.text[:300]}")
    await save_login(account_id, response.json())
    refreshed = await codex_store.get_account(account_id, decrypt=True)
    return refreshed["access_token"], refreshed
