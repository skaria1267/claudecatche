import base64
import json
import time

import httpx

from services import codex_store


OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
TOKEN_URL = "https://auth.openai.com/oauth/token"
DEVICE_USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode"
DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token"
DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device"
DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback"


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


async def _exchange_code(code: str, verifier: str, proxy: str) -> dict:
    async with httpx.AsyncClient(timeout=30, proxy=proxy or None) as client:
        response = await client.post(
            TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": DEVICE_REDIRECT_URI,
                "client_id": OAUTH_CLIENT_ID,
                "code_verifier": verifier,
            },
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Codex token 交换失败 HTTP {response.status_code}: {response.text[:300]}")
    return response.json()


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
