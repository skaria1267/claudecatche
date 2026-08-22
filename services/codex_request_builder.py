import copy
import json
import re

from models import get_setting


THINKING_RE = re.compile(r"^(.+?)-thinking(?:-(none|minimal|low|medium|high|xhigh|max))?$")
STRIP_KEYS = (
    "max_tokens", "max_completion_tokens", "max_output_tokens", "metadata",
    "prompt_cache_options", "temperature", "top_p", "top_logprobs",
    "safety_identifier", "truncation", "stream_options",
)


def parse_models(raw: str) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        value = [part.strip() for part in re.split(r"[,\n]", raw or "")]
    return [str(item).strip() for item in value if str(item).strip()]


async def client_models(discovered: list[str] | None = None) -> list[str]:
    configured = parse_models(await get_setting("codex_models") or "[]")
    models = configured or (discovered or [])
    aliases = (await get_setting("codex_thinking_alias") or "1") == "1"
    result = []
    for model in models:
        for item in (model, f"{model}-thinking") if aliases else (model,):
            if item not in result:
                result.append(item)
    return result


def _text_content(content) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content or "")
    parts = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") in ("text", "input_text", "output_text"):
            parts.append(str(part.get("text") or ""))
    return "\n".join(filter(None, parts))


def _response_content(content, role: str):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content or "")
    result = []
    for part in content:
        if not isinstance(part, dict):
            continue
        kind = part.get("type")
        if kind in ("input_text", "input_image", "output_text"):
            result.append(copy.deepcopy(part))
        elif kind == "text":
            result.append({
                "type": "output_text" if role == "assistant" else "input_text",
                "text": str(part.get("text") or ""),
            })
        elif kind == "image_url":
            image = part.get("image_url")
            url = image.get("url") if isinstance(image, dict) else image
            if url:
                item = {"type": "input_image", "image_url": url}
                if isinstance(image, dict) and image.get("detail"):
                    item["detail"] = image["detail"]
                result.append(item)
    return result


def _messages_to_input(messages: list) -> tuple[str, list]:
    instructions = []
    items = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "user")
        if role in ("system", "developer"):
            text = _text_content(message.get("content"))
            if text:
                instructions.append(text)
            continue
        if role == "tool":
            items.append({
                "type": "function_call_output",
                "call_id": message.get("tool_call_id") or "",
                "output": _text_content(message.get("content")),
            })
            continue
        if role == "assistant" and isinstance(message.get("tool_calls"), list):
            text = _text_content(message.get("content"))
            if text:
                items.append({"type": "message", "role": "assistant", "content": text})
            for call in message["tool_calls"]:
                function = (call or {}).get("function") or {}
                items.append({
                    "type": "function_call",
                    "call_id": (call or {}).get("id") or "",
                    "name": function.get("name") or "",
                    "arguments": function.get("arguments") or "{}",
                })
            continue
        items.append({
            "type": "message",
            "role": "assistant" if role == "assistant" else "user",
            "content": _response_content(message.get("content"), role),
        })
    return "\n".join(instructions), items


def _tools(tools) -> list:
    result = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        if tool.get("type") == "function" and isinstance(tool.get("function"), dict):
            fn = tool["function"]
            result.append({
                "type": "function", "name": fn.get("name") or "",
                "description": fn.get("description") or "",
                "parameters": fn.get("parameters") or {},
                "strict": bool(fn.get("strict", False)),
            })
        else:
            result.append(copy.deepcopy(tool))
    return result


def _tool_choice(value):
    if not isinstance(value, dict) or value.get("type") != "function":
        return value
    function = value.get("function") or {}
    return {"type": "function", "name": function.get("name") or value.get("name") or ""}


def _mark_breakpoint(item: dict) -> bool:
    content = item.get("content")
    if isinstance(content, str):
        item["content"] = [{
            "type": "input_text", "text": content,
            "prompt_cache_breakpoint": {"mode": "explicit"},
        }]
        return True
    if isinstance(content, list):
        for part in reversed(content):
            if isinstance(part, dict):
                part["prompt_cache_breakpoint"] = {"mode": "explicit"}
                return True
    return False


def _cache(body: dict, mode: str, cache_key: str, raw_rules: str) -> None:
    if cache_key:
        body["prompt_cache_key"] = cache_key[:64]
    if mode != "explicit":
        return
    try:
        rules = json.loads(raw_rules or "[]")
    except ValueError:
        rules = []
    items = body.get("input") or []
    marked = set()
    for rule in rules[:4]:
        if not isinstance(rule, dict):
            continue
        try:
            ordinal = max(1, int(rule.get("index", 1)))
        except (TypeError, ValueError):
            continue
        index = len(items) - ordinal if rule.get("direction") == "backward" else ordinal - 1
        if 0 <= index < len(items) and index not in marked and _mark_breakpoint(items[index]):
            marked.add(index)


async def prepare_chat(raw: dict) -> tuple[dict, str, str, str]:
    requested_model = str(raw.get("model") or "")
    model = requested_model
    effort = str(raw.get("reasoning_effort") or "")
    if (await get_setting("codex_thinking_alias") or "1") == "1":
        match = THINKING_RE.match(model)
        if match:
            model = match.group(1)
            effort = match.group(2) or "medium"
    instructions, input_items = _messages_to_input(raw.get("messages") or [])
    body = copy.deepcopy(raw)
    body.pop("messages", None)
    for key in STRIP_KEYS:
        body.pop(key, None)
    body.update({
        "model": model, "input": input_items, "instructions": instructions,
        "stream": True, "store": False,
    })
    if effort:
        body["reasoning"] = {"effort": effort}
    body.pop("reasoning_effort", None)
    if "tools" in body:
        body["tools"] = _tools(body["tools"])
    if "tool_choice" in body:
        body["tool_choice"] = _tool_choice(body["tool_choice"])
    mode = await get_setting("codex_cache_mode") or "auto"
    _cache(
        body, mode, await get_setting("codex_cache_key") or "",
        await get_setting("codex_cache_rules") or "[]",
    )
    return body, requested_model, model, effort


async def prepare_responses(raw: dict) -> tuple[dict, str, str, str]:
    body = copy.deepcopy(raw)
    requested_model = str(body.get("model") or "")
    model = requested_model
    effort = ""
    if (await get_setting("codex_thinking_alias") or "1") == "1":
        match = THINKING_RE.match(model)
        if match:
            model = match.group(1)
            effort = match.group(2) or "medium"
    body["model"] = model
    body["stream"] = True
    body["store"] = False
    for key in STRIP_KEYS:
        body.pop(key, None)
    if effort:
        body["reasoning"] = {"effort": effort}
    mode = await get_setting("codex_cache_mode") or "auto"
    _cache(
        body, mode, await get_setting("codex_cache_key") or "",
        await get_setting("codex_cache_rules") or "[]",
    )
    return body, requested_model, model, effort
