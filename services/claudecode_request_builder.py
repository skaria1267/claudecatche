import copy
import hashlib
import json
import re

from models import get_setting
from services.cache_inject import inject_cache_breakpoints
from services.claudecode_auth import (
    CLAUDE_CODE_BILLING_SALT,
    CLAUDE_CODE_UA,
    CLAUDE_CODE_VERSION,
)


ALLOWED_KEYS = {
    "model", "messages", "max_tokens", "system", "stream", "temperature",
    "top_k", "top_p", "stop_sequences", "tools", "tool_choice", "thinking",
    "metadata", "cache_control", "output_config",
}
THINKING_RE = re.compile(r"^(.+?)-thinking(?:-(low|medium|high|xhigh|max))?$")


def parse_models(raw: str) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        value = []
    return [str(item).strip() for item in value if str(item).strip()] if isinstance(value, list) else []


async def client_models() -> list[str]:
    models = parse_models(await get_setting("claudecode_models") or "[]")
    if (await get_setting("claudecode_thinking_alias") or "1") != "1":
        return models
    output = []
    for model in models:
        output.extend([model, f"{model}-thinking"])
    return list(dict.fromkeys(output))


def _first_user_sample(body: dict) -> str:
    for message in body.get("messages", []):
        if message.get("role") != "user":
            continue
        content = message.get("content", "")
        if isinstance(content, list):
            content = next(
                (part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"),
                "",
            )
        encoded = str(content).encode("utf-16-le")
        return "".join(
            chr(encoded[index * 2] | (encoded[index * 2 + 1] << 8))
            if index * 2 + 1 < len(encoded) else ""
            for index in (4, 7, 20)
        )
    return ""


def _billing(body: dict) -> str:
    digest = hashlib.sha256(
        f"{CLAUDE_CODE_BILLING_SALT}{_first_user_sample(body)}{CLAUDE_CODE_VERSION}".encode()
    ).hexdigest()[:3]
    return f"cc_version={CLAUDE_CODE_VERSION}.{digest}; cc_entrypoint=cli; cch=00000;"


def _inject_billing(body: dict) -> None:
    block = {"type": "text", "text": f"x-anthropic-billing-header: {_billing(body)}"}
    system = body.get("system")
    if system is None:
        body["system"] = [block]
    elif isinstance(system, str):
        body["system"] = [block, {"type": "text", "text": system}]
    elif isinstance(system, list):
        body["system"] = [block, *system]


async def prepare(raw_body: dict) -> tuple[dict, str, str]:
    body = copy.deepcopy(raw_body)
    effort = ""
    if (await get_setting("claudecode_thinking_alias") or "1") == "1":
        match = THINKING_RE.match(str(body.get("model") or ""))
        if match:
            body["model"] = match.group(1)
            effort = match.group(2) or "high"
            body["thinking"] = {"type": "adaptive", "display": "summarized"}
            if match.group(2):
                body["output_config"] = {"effort": match.group(2)}
            else:
                body.pop("output_config", None)
    mode = await get_setting("claudecode_cache_mode") or "auto"
    if mode != "off":
        try:
            rules = json.loads(await get_setting("claudecode_cache_rules") or "[]")
        except ValueError:
            rules = []
        body = inject_cache_breakpoints(
            body,
            mode="rules" if mode == "rules" else "auto",
            ttl=await get_setting("claudecode_cache_ttl") or "5m",
            rules=rules,
        )
    body = {key: value for key, value in body.items() if key in ALLOWED_KEYS}
    for key in ("top_k", "top_p", "temperature"):
        if body.get(key) in (None, 0):
            body.pop(key, None)
    _inject_billing(body)
    return body, CLAUDE_CODE_UA, effort
