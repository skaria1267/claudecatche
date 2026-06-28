import json

from services.cache_inject import inject_cache_breakpoints


_ALLOWED_KEYS = {
    "model", "messages", "max_tokens", "system", "stream",
    "temperature", "top_k", "top_p", "stop_sequences",
    "tools", "tool_choice", "thinking", "metadata", "cache_control",
    "output_config",
}
_DROP_IF_ZERO = ("top_k", "top_p", "temperature")


def _filter_allowed_keys(body: dict) -> dict:
    out = {k: v for k, v in body.items() if k in _ALLOWED_KEYS}
    for k in _DROP_IF_ZERO:
        if k in out and (out[k] is None or out[k] == 0):
            del out[k]
    if "stop_sequences" in out and not out["stop_sequences"]:
        del out["stop_sequences"]
    return out


def _apply_cache_inject(body: dict, channel: dict) -> dict:
    if int(channel.get("cache_enabled", 1) or 0) != 1:
        return body
    mode = channel.get("cache_mode") or "auto"
    ttl = channel.get("cache_ttl") or "5m"
    try:
        rules = json.loads(channel.get("cache_rules") or "[]")
    except Exception:
        rules = []
    return inject_cache_breakpoints(body, mode=mode, ttl=ttl, rules=rules)


def prepare_request_body(raw_body: dict, channel: dict) -> dict:
    """按渠道配置打缓存断点，并过滤非法字段后返回发往上游的 body。"""
    body = _apply_cache_inject(raw_body, channel)
    body = _filter_allowed_keys(body)
    return body
