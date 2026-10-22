import hashlib
import json
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from services import claudecode_store
from services.claudecode_auth import ANTHROPIC_BETA, CLAUDE_BASE, account_info, valid_token
from services.claudecode_client import current_version


# Discovery is read-only with skip_spend. Only explicit redemption may spend.
PROGRAM = "cedar_ember"
GRANT_ID = re.compile(r"^[a-z0-9_-]{1,40}$")


class ResetCreditConflict(ValueError):
    pass


def _date(value):
    if value is None:
        return None, None
    if not isinstance(value, str):
        raise RuntimeError("Claude 重置卡日期格式无法识别")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc).isoformat(), parsed.timestamp()
    except (ValueError, OverflowError) as exc:
        raise RuntimeError("Claude 重置卡日期格式无法识别") from exc


def _inventory(data: dict, organization_id: str) -> dict:
    block = data.get(PROGRAM)
    result = {"credits": [], "available_count": 0, "redeemable_count": 0,
              "queried_at": int(time.time()), "supported": isinstance(block, dict),
              "eligible": False, "reason": "not_reported", "cooldown_until": None}
    if block is None:
        return result
    if not isinstance(block, dict) or not isinstance(block.get("eligible"), bool):
        raise RuntimeError("Claude 重置卡响应格式无法识别")
    grants = block.get("grants", [])
    if not isinstance(grants, list):
        raise RuntimeError("Claude 重置卡列表格式无法识别")
    cooldown, cooldown_at = _date(block.get("cooldown_until"))
    now = time.time()
    cooling = cooldown_at is not None and cooldown_at > now
    eligible = block["eligible"]
    reason = str(block.get("ineligible_reason") or ("" if eligible else "ineligible"))[:100]
    result.update(eligible=eligible, reason=reason, cooldown_until=cooldown)
    for grant in grants:
        if not isinstance(grant, dict):
            raise RuntimeError("Claude 重置卡格式无法识别")
        grant_id = grant.get("id")
        left = grant.get("resets_left")
        if not isinstance(grant_id, str) or not GRANT_ID.fullmatch(grant_id):
            raise RuntimeError("Claude 重置卡标识无法识别")
        if type(left) is not int or left < 0:
            raise RuntimeError("Claude 重置卡剩余次数无法识别")
        starts, starts_at = _date(grant.get("starts_at"))
        ends, ends_at = _date(grant.get("ends_at"))
        expired = ends_at is not None and ends_at <= now
        pending = starts_at is not None and starts_at > now
        selected = grant_id == block.get("next_grant_id")
        usable = (eligible and selected and grant.get("usable_now") is True
                  and not grant.get("paused") and not cooling and not pending
                  and not expired and left > 0)
        if expired:
            state, note = "expired", "已过期"
        elif left == 0:
            state, note = "redeemed", "已用完"
        elif usable:
            state, note = "available", "可使用"
        else:
            state = "unavailable"
            note = ("尚未生效" if pending else "已暂停" if grant.get("paused") else
                    "冷却中" if cooling else "当前接口不支持使用" if reason == "surface" else
                    "客户端版本过旧" if reason == "cli_version" else
                    "账号暂不符合条件" if not eligible else
                    "需先使用上游指定的其他卡片" if not selected else
                    "需达到用量限制" if grant.get("use_requires_limit", True) else
                    "上游暂未允许使用")
        # Scope an idempotent redemption to this grant's remaining use and dates.
        version = hashlib.sha256(json.dumps(
            [organization_id, PROGRAM, grant_id, left, starts, ends], separators=(",", ":"),
        ).encode()).hexdigest()
        clears = grant.get("clears") or []
        result["credits"].append({
            "id": grant_id, "program": PROGRAM, "credit_version": version,
            "title": str(grant.get("label") or "Claude 用量重置")[:200],
            "remaining_count": left, "status": state, "usable": usable,
            "status_text": note, "granted_at": starts, "expires_at": ends,
            "clears": [x for x in clears if isinstance(x, str)] if isinstance(clears, list) else [],
        })
        if not expired and left:
            result["available_count"] += left
        if usable:
            result["redeemable_count"] += left
    return result


async def _context(account_id: int):
    if not await claudecode_store.get_account(account_id):
        raise ValueError("账号不存在")
    token = await valid_token(account_id)
    account = await claudecode_store.get_account(account_id)
    if not account.get("organization_id"):
        await account_info(account_id)
        account = await claudecode_store.get_account(account_id)
    organization_id = account.get("organization_id") or ""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", organization_id):
        raise ValueError("请先验证并登录此 Claude Code 账号")
    # Reset discovery uses the CLI surface, unlike the existing model request UA.
    return account, {
        "Authorization": f"Bearer {token}",
        "anthropic-beta": ANTHROPIC_BETA,
        "user-agent": f"claude-cli/{await current_version()} (external, cli)",
        "accept": "application/json",
    }


async def _fetch(client, account, request_headers):
    try:
        response = await client.get(
            f"{CLAUDE_BASE}/api/oauth/usage",
            params={PROGRAM: "1", "skip_spend": "1"}, headers=request_headers,
        )
    except httpx.HTTPError as exc:
        raise RuntimeError("Claude 重置卡查询连接失败，请稍后刷新") from exc
    if response.status_code >= 400:
        raise RuntimeError(f"Claude 重置卡查询失败 HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError("Claude 重置卡查询未返回有效 JSON") from exc
    if not isinstance(data, dict):
        raise RuntimeError("Claude 重置卡响应格式无法识别")
    return _inventory(data, account["organization_id"])


async def fetch_reset_credits(account_id: int) -> dict:
    account, request_headers = await _context(account_id)
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        return await _fetch(client, account, request_headers)


async def consume_reset_credit(account_id: int, credit_id: str, credit_version: str) -> dict:
    account, request_headers = await _context(account_id)
    async with httpx.AsyncClient(timeout=30, proxy=account.get("proxy_url") or None) as client:
        inventory = await _fetch(client, account, request_headers)
        credit = next((c for c in inventory["credits"] if c["id"] == credit_id), None)
        if not credit or credit["credit_version"] != credit_version:
            raise ResetCreditConflict("重置卡已变化，请重新查询后选择")
        if not credit["usable"]:
            raise ResetCreditConflict(f"这张重置卡当前不可用：{credit['status_text']}")
        request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"catch:claude-reset:{credit_version}"))
        try:
            response = await client.post(
                f"{CLAUDE_BASE}/api/organizations/{quote(account['organization_id'], safe='')}/reset_rate_limits",
                headers=request_headers,
                json={"program": PROGRAM, "grant_id": credit_id, "request_id": request_id},
            )
        except httpx.HTTPError as exc:
            raise RuntimeError("使用重置卡的响应未确认，可能已生效。请先刷新卡片和用量；不会自动重试。") from exc
    if response.status_code >= 400:
        raise RuntimeError(f"重置卡请求返回 HTTP {response.status_code}，请先刷新卡片和用量确认结果")
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError("上游未返回有效的重置结果，请先刷新卡片和用量") from exc
    outcome = data.get("result") if isinstance(data, dict) else None
    if not isinstance(outcome, str):
        outcome = None
    if outcome not in ("reset", "already_used"):
        reasons = {"cooldown": "处于重置冷却期", "not_limited": "尚未达到需要重置的限制",
                   "ineligible": "账号当前不符合条件", "unavailable": "重置卡已不可用"}
        raise RuntimeError(reasons.get(outcome, "上游未确认重置成功") + "，请刷新卡片和用量")
    return {"ok": True, "already_used": outcome == "already_used"}
