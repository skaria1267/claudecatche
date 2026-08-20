import copy
import json
import re


_THINKING_ALIAS_RE = re.compile(
    r"^(.+?)-thinking(?:-(none|minimal|low|medium|high|xhigh|max))?$"
)


def parse_models(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
    except (TypeError, ValueError):
        pass
    return [part.strip() for part in re.split(r"[,\n]", raw) if part.strip()]


def build_client_models(config: dict) -> list[str]:
    models = parse_models(config.get("models", ""))
    if int(config.get("thinking_alias", 0) or 0) != 1:
        return models
    result = []
    seen = set()
    for model in models:
        for item in (model, f"{model}-thinking"):
            if item not in seen:
                seen.add(item)
                result.append(item)
    return result


def _apply_thinking_alias(body: dict, config: dict) -> None:
    if int(config.get("thinking_alias", 0) or 0) != 1:
        return
    model = body.get("model")
    if not isinstance(model, str):
        return
    match = _THINKING_ALIAS_RE.match(model)
    if not match:
        return
    body["model"] = match.group(1)
    body["reasoning_effort"] = match.group(2) or "medium"


def _remove_breakpoints(value) -> None:
    if isinstance(value, dict):
        value.pop("prompt_cache_breakpoint", None)
        for child in value.values():
            _remove_breakpoints(child)
    elif isinstance(value, list):
        for child in value:
            _remove_breakpoints(child)


def _mark_message(message: dict) -> bool:
    content = message.get("content")
    if isinstance(content, str):
        message["content"] = [{
            "type": "text",
            "text": content,
            "prompt_cache_breakpoint": {"mode": "explicit"},
        }]
        return True
    if not isinstance(content, list):
        return False
    for part in reversed(content):
        if isinstance(part, dict):
            part["prompt_cache_breakpoint"] = {"mode": "explicit"}
            return True
    return False


def _apply_explicit_breakpoints(body: dict, raw_rules: str) -> None:
    messages = body.get("messages")
    if not isinstance(messages, list):
        return
    try:
        rules = json.loads(raw_rules or "[]")
    except (TypeError, ValueError):
        rules = []

    marked = 0
    used_indexes = set()
    for rule in rules:
        if marked >= 4 or not isinstance(rule, dict):
            break
        try:
            ordinal = max(1, int(rule.get("index", 1)))
        except (TypeError, ValueError):
            continue
        index = ordinal - 1
        if rule.get("direction") == "backward":
            index = len(messages) - ordinal
        if index < 0 or index >= len(messages) or index in used_indexes:
            continue
        message = messages[index]
        if isinstance(message, dict) and _mark_message(message):
            used_indexes.add(index)
            marked += 1


def _apply_cache(body: dict, config: dict) -> None:
    mode = config.get("cache_mode") or "off"
    if mode not in ("off", "implicit", "explicit"):
        mode = "off"

    _remove_breakpoints(body.get("messages"))
    body.pop("prompt_cache_options", None)
    body.pop("prompt_cache_key", None)
    if mode == "off":
        return

    body["prompt_cache_options"] = {"mode": mode, "ttl": "30m"}
    cache_key = (config.get("cache_key") or "").strip()
    if cache_key:
        body["prompt_cache_key"] = cache_key[:64]
    if mode == "explicit":
        _apply_explicit_breakpoints(body, config.get("cache_rules") or "[]")


def prepare_openai_request(raw_body: dict, config: dict) -> dict:
    body = copy.deepcopy(raw_body)
    _apply_thinking_alias(body, config)
    _apply_cache(body, config)
    if body.get("stream"):
        stream_options = body.get("stream_options")
        if not isinstance(stream_options, dict):
            stream_options = {}
        stream_options["include_usage"] = True
        body["stream_options"] = stream_options
    return body
