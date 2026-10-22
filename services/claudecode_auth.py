import asyncio
import base64
import hashlib
import os
import secrets
import time
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from services import claudecode_store
from services.claudecode_client import DEFAULT_VERSION, current_version


CLAUDE_BASE = "https://api.anthropic.com"
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
TOKEN_URL = f"{CLAUDE_BASE}/v1/oauth/token"
REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize"
AUTHCODE_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback"
OAUTH_SCOPE = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
AUTH_SESSION_TTL = 600
ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_BETA = "oauth-2025-04-20"
CLAUDE_CODE_VERSION = DEFAULT_VERSION
CLAUDE_CODE_UA = f"claude-code/{CLAUDE_CODE_VERSION}"
CLAUDE_CODE_BILLING_SALT = "59cf53e54c78"

_token_cache: dict[int, tuple[str, int]] = {}
_account_locks: dict[int, asyncio.Lock] = {}
_auth_sessions: dict[str, dict] = {}


def account_lock(account_id: int) -> asyncio.Lock:
    return _account_locks.setdefault(account_id, asyncio.Lock())


def invalidate_account(account_id: int) -> None:
    _token_cache.pop(account_id, None)
    for key, value in list(_auth_sessions.items()):
        if value["account_id"] == account_id or value["expires_at"] <= time.monotonic():
            _auth_sessions.pop(key, None)


def _profile_fields(data: dict) -> dict:
    account = data.get("account") if isinstance(data.get("account"), dict) else {}
    org = data.get("organization") if isinstance(data.get("organization"), dict) else {}
    def string(value):
        return value.strip() if isinstance(value, str) else ""
    return {
        "email": string(account.get("email") or account.get("email_address")),
        "organization_id": string(org.get("uuid")),
        "subscription_type": string(org.get("seat_tier") or org.get("organization_type")
                                    or org.get("billing_type")).removeprefix("claude_"),
        "rate_limit_tier": string(org.get("rate_limit_tier")),
    }


async def _oauth_profile(client: httpx.AsyncClient, token: str) -> dict:
    response = await client.get(f"{CLAUDE_BASE}/api/oauth/profile",
                               headers={**await headers(), "Authorization": f"Bearer {token}"})
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("账号信息响应格式无效")
    return _profile_fields(data)


async def authcode_start(account_id: int) -> dict:
    account = await claudecode_store.get_account(account_id)
    if not account:
        raise ValueError("账号不存在")
    # One pending login per account, with PKCE secrets retained only server-side.
    for key, value in list(_auth_sessions.items()):
        if value["expires_at"] <= time.monotonic() or value["account_id"] == account_id:
            _auth_sessions.pop(key, None)
    verifier, challenge = _pkce()
    state, session_id = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    _auth_sessions[session_id] = {
        "account_id": account_id, "verifier": verifier, "state": state,
        "proxy_url": account.get("proxy_url") or "",
        "expires_at": time.monotonic() + AUTH_SESSION_TTL,
    }
    query = urlencode({"code": "true", "client_id": CLIENT_ID, "response_type": "code",
                       "redirect_uri": AUTHCODE_REDIRECT_URI, "scope": OAUTH_SCOPE,
                       "code_challenge": challenge, "code_challenge_method": "S256", "state": state})
    return {"login_session_id": session_id, "authorize_url": f"{AUTHORIZE_URL}?{query}",
            "expires_in": AUTH_SESSION_TTL}


def _login_code(value: str, expected_state: str) -> str:
    value = value.strip()
    if "://" in value:
        parsed = urlparse(value)
        if (parsed.scheme != "https" or parsed.netloc not in
                ("platform.claude.com", "console.anthropic.com")
                or parsed.path != "/oauth/code/callback"):
            raise ValueError("请粘贴 Claude 授权页返回的代码或完整回调地址")
        query = parse_qs(parsed.query)
        if query.get("error"):
            raise ValueError("Claude 授权未完成，请重新登录")
        code = (query.get("code") or [""])[0]
        state = (query.get("state") or [""])[0]
        if not state:
            raise ValueError("回调地址缺少 state，请复制完整地址")
    else:
        code, separator, state = value.partition("#")
        if separator and not state:
            raise ValueError("授权码缺少 state，请完整复制")
    if state and not secrets.compare_digest(state.encode(), expected_state.encode()):
        raise ValueError("授权码不属于本次登录，请使用最新授权窗口返回的代码")
    if not code or any(char.isspace() for char in code):
        raise ValueError("授权码格式无效，请完整复制")
    return code


async def authcode_complete(account_id: int, session_id: str, value: str) -> dict:
    warnings = []
    async with account_lock(account_id):
        session = _auth_sessions.get(session_id)
        if (not session or session["account_id"] != account_id
                or session["expires_at"] <= time.monotonic()):
            raise ValueError("授权会话不存在或已过期，请重新打开登录窗口")
        code = _login_code(value, session["state"])
        account = await claudecode_store.get_account(account_id)
        if not account:
            raise ValueError("账号不存在")
        if (account.get("proxy_url") or "") != session["proxy_url"]:
            raise ValueError("账号代理已更改，请重新打开登录窗口")
        # A code is single-use; do not automatically retry an uncertain exchange.
        _auth_sessions.pop(session_id, None)
        async with httpx.AsyncClient(timeout=30, proxy=session["proxy_url"] or None) as client:
            try:
                response = await client.post(TOKEN_URL, headers={**await headers(),
                    "user-agent": f"claude-cli/{await current_version()} (external, cli)"}, json={
                    "grant_type": "authorization_code", "client_id": CLIENT_ID, "code": code,
                    "redirect_uri": AUTHCODE_REDIRECT_URI, "code_verifier": session["verifier"],
                    "state": session["state"],
                })
                if response.status_code >= 400:
                    raise ValueError(f"授权交换失败 HTTP {response.status_code}，请重新打开登录窗口")
                try:
                    tokens = response.json()
                except ValueError as exc:
                    raise ValueError("授权响应不是有效 JSON，请重新登录") from exc
            except httpx.HTTPError as exc:
                raise ValueError("授权连接失败，请检查账号代理并重新打开登录窗口") from exc
            if not isinstance(tokens, dict):
                raise ValueError("授权响应格式无效，请重新登录")
            access, refresh = tokens.get("access_token"), tokens.get("refresh_token")
            if not isinstance(access, str) or not access or not isinstance(refresh, str) or not refresh:
                raise ValueError("授权响应缺少登录令牌，请重新登录")
            try:
                expires_in = int(tokens.get("expires_in") or 28800)
                if expires_in <= 0:
                    raise ValueError()
            except (ValueError, TypeError, OverflowError) as exc:
                raise ValueError("授权响应的有效期无效，请重新登录") from exc
            expires_at = int(time.time()) + expires_in
            info = _profile_fields(tokens)
            try:
                profile = await _oauth_profile(client, access)
                info.update({key: val for key, val in profile.items() if val})
            except Exception:
                warnings.append("账号信息暂未获取，可稍后验证登录")
            await claudecode_store.save_oauth_login(account_id, access, refresh, expires_at, info)
            invalidate_account(account_id)
            _token_cache[account_id] = (access, expires_at)
    try:
        await account_usage(account_id)
    except Exception:
        warnings.append("用量暂未获取，可稍后手动刷新")
    return {"ok": True, "account": await claudecode_store.get_public_account(account_id),
            "warnings": warnings}


async def headers(cookie: str = "") -> dict:
    result = {
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": ANTHROPIC_BETA,
        "user-agent": f"claude-code/{await current_version()}",
    }
    if cookie:
        value = cookie.strip()
        if "=" in value and value.lower().startswith("session"):
            value = value.split("=", 1)[1].strip()
        result["cookie"] = f"sessionKey={value}"
    return result


def _pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


async def _bootstrap(cookie: str, client: httpx.AsyncClient) -> dict:
    response = await client.get(f"{CLAUDE_BASE}/api/bootstrap", headers=await headers(cookie))
    response.raise_for_status()
    data = response.json()
    if not data.get("account"):
        raise ValueError("Cookie 无效或已过期")
    return data


def _organization(account: dict) -> dict:
    for membership in account.get("memberships", []):
        organization = membership.get("organization") or {}
        if "chat" in (organization.get("capabilities") or []):
            return organization
    raise ValueError("未找到可用于 Claude Code 的组织")


async def _authorize(cookie: str, organization_id: str,
                     client: httpx.AsyncClient) -> tuple[str, str, str]:
    verifier, challenge = _pkce()
    state = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    payload = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "user:profile user:inference",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "organization_uuid": organization_id,
    }
    request_headers = await headers(cookie)
    request_headers["content-type"] = "application/json"
    response = await client.post(
        f"{CLAUDE_BASE}/v1/oauth/{organization_id}/authorize",
        headers=request_headers,
        json=payload,
    )
    if response.status_code != 200:
        raise ValueError(f"Claude Code authorize 失败({response.status_code}): {response.text[:500]}")
    redirect = response.json().get("redirect_uri", "")
    query = parse_qs(urlparse(redirect).query)
    code = query.get("code", [""])[0]
    if not code:
        raise ValueError("Claude Code authorize 未返回 code")
    return code, verifier, query.get("state", [""])[0]


async def _exchange(code: str, verifier: str, state: str,
                    client: httpx.AsyncClient) -> dict:
    payload = {
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }
    if state:
        payload["state"] = state
    response = await client.post(TOKEN_URL, headers=await headers(), json=payload)
    response.raise_for_status()
    return response.json()


async def _refresh(refresh_token: str, client: httpx.AsyncClient) -> dict:
    response = await client.post(
        TOKEN_URL,
        headers=await headers(),
        json={
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": refresh_token,
        },
    )
    response.raise_for_status()
    return response.json()


async def account_info(account_id: int) -> dict:
    async with account_lock(account_id):
        return await _account_info(account_id)


async def _account_info(account_id: int) -> dict:
    account = await claudecode_store.get_account(account_id, decrypt=True)
    if not account:
        raise ValueError("账号不存在")
    if not account.get("credential"):
        token = await _valid_token(account_id)
        async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
            result = await _oauth_profile(client, token)
        await claudecode_store.update_account(account_id, **{k: v for k, v in result.items() if v})
        return result
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        data = await _bootstrap(account["credential"], client)
    profile = data["account"]
    organization = _organization(profile)
    capabilities = organization.get("capabilities") or []
    plan = organization.get("billing_type") or next(
        (item for item in capabilities if item in {"pro", "max", "team", "enterprise"}),
        "",
    )
    result = {
        "email": profile.get("email_address", ""),
        "display_name": profile.get("display_name", ""),
        "organization_id": organization.get("uuid", ""),
        "subscription_type": plan,
        "rate_limit_tier": organization.get("rate_limit_tier", ""),
        "capabilities": capabilities,
    }
    await claudecode_store.update_account(
        account_id,
        email=result["email"],
        organization_id=result["organization_id"],
        subscription_type=result["subscription_type"],
    )
    return result


async def valid_token(account_id: int) -> str:
    async with account_lock(account_id):
        return await _valid_token(account_id)


async def _valid_token(account_id: int) -> str:
    now = int(time.time())
    cached = _token_cache.get(account_id)
    if cached and now < cached[1] - 300:
        return cached[0]
    account = await claudecode_store.get_account(account_id, decrypt=True)
    if not account:
        raise ValueError("账号不存在")
    if account.get("access_token") and now < int(account.get("token_expires_at") or 0) - 300:
        _token_cache[account_id] = (account["access_token"], account["token_expires_at"])
        return account["access_token"]
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        data = None
        if account.get("refresh_token"):
            try:
                data = await _refresh(account["refresh_token"], client)
            except Exception:
                data = None
        organization_id = account.get("organization_id") or ""
        if data is None:
            if not account.get("credential"):
                raise ValueError("OAuth 登录已失效或暂时无法续期，请检查代理或重新授权")
            bootstrap = await _bootstrap(account["credential"], client)
            organization = _organization(bootstrap["account"])
            organization_id = organization.get("uuid", "")
            code, verifier, state = await _authorize(
                account["credential"], organization_id, client
            )
            data = await _exchange(code, verifier, state, client)
    access_token = data["access_token"]
    refresh_token = data.get("refresh_token") or account.get("refresh_token") or ""
    expires_at = now + int(data.get("expires_in") or 28800)
    await claudecode_store.save_token(
        account_id, access_token, refresh_token, expires_at, organization_id
    )
    _token_cache[account_id] = (access_token, expires_at)
    return access_token


async def account_usage(account_id: int) -> dict:
    async with account_lock(account_id):
        return await _account_usage(account_id)


async def _account_usage(account_id: int) -> dict:
    account = await claudecode_store.get_account(account_id, decrypt=True)
    if not account:
        raise ValueError("账号不存在")
    token = await _valid_token(account_id)
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        response = await client.get(
            f"{CLAUDE_BASE}/api/oauth/usage",
            headers={**await headers(), "Authorization": f"Bearer {token}"},
        )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("Claude 用量响应格式无效")
    await claudecode_store.set_usage(account_id, data)
    return data
