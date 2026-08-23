import base64
import hashlib
import os
import time
from urllib.parse import parse_qs, urlparse

import httpx

from services import claudecode_store


CLAUDE_BASE = "https://api.anthropic.com"
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
TOKEN_URL = f"{CLAUDE_BASE}/v1/oauth/token"
REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_BETA = "oauth-2025-04-20"
CLAUDE_CODE_VERSION = "2.1.76"
CLAUDE_CODE_UA = f"claude-code/{CLAUDE_CODE_VERSION}"
CLAUDE_CODE_BILLING_SALT = "59cf53e54c78"

_token_cache: dict[int, tuple[str, int]] = {}


def headers(cookie: str = "") -> dict:
    result = {
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": ANTHROPIC_BETA,
        "user-agent": CLAUDE_CODE_UA,
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
    response = await client.get(f"{CLAUDE_BASE}/api/bootstrap", headers=headers(cookie))
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
    request_headers = headers(cookie)
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
    response = await client.post(TOKEN_URL, headers=headers(), json=payload)
    response.raise_for_status()
    return response.json()


async def _refresh(refresh_token: str, client: httpx.AsyncClient) -> dict:
    response = await client.post(
        TOKEN_URL,
        headers=headers(),
        json={
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": refresh_token,
        },
    )
    response.raise_for_status()
    return response.json()


async def account_info(account_id: int) -> dict:
    account = await claudecode_store.get_account(account_id, decrypt=True)
    if not account:
        raise ValueError("账号不存在")
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
    now = int(time.time())
    cached = _token_cache.get(account_id)
    if cached and now < cached[1] - 300:
        return cached[0]
    account = await claudecode_store.get_account(account_id, decrypt=True)
    if not account:
        raise ValueError("账号不存在")
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        data = None
        if account.get("refresh_token"):
            try:
                data = await _refresh(account["refresh_token"], client)
            except Exception:
                data = None
        organization_id = account.get("organization_id") or ""
        if data is None:
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
    _token_cache[account_id] = (access_token, expires_at)
    await claudecode_store.save_token(
        account_id, access_token, refresh_token, expires_at, organization_id
    )
    return access_token


async def account_usage(account_id: int) -> dict:
    account = await claudecode_store.get_account(account_id, decrypt=True)
    if not account:
        raise ValueError("账号不存在")
    token = await valid_token(account_id)
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        response = await client.get(
            f"{CLAUDE_BASE}/api/oauth/usage",
            headers={**headers(), "Authorization": f"Bearer {token}"},
        )
    response.raise_for_status()
    data = response.json()
    await claudecode_store.set_usage(account_id, data)
    return data
