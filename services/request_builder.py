import json

from services.cache_inject import inject_cache_breakpoints


_ALLOWED_KEYS = {
    "model", "messages", "max_tokens", "system", "stream",
    "temperature", "top_k", "top_p", "stop_sequences",
    "tools", "tool_choice", "thinking", "metadata", "cache_control",
    "output_config", "provider",
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


def _apply_provider_routing(body: dict, channel: dict) -> dict:
    """渠道开启 or_routing 时，把模型名里的 `@供应商` 解析成 OpenRouter 的
    provider 硬锁定字段（only + allow_fallbacks:false），并把模型名还原。

    约定：
      claude-sonnet-4.5@deepinfra        -> only:["deepinfra"]
      claude-sonnet-4.5@anthropic,azure  -> only:["anthropic","azure"]（仍不回退到名单外）
    """
    if int(channel.get("or_routing", 0) or 0) != 1:
        return body
    model = body.get("model") or ""
    if "@" not in model:
        return body
    base, _, prov = model.rpartition("@")
    base = base.strip()
    provs = [p.strip() for p in prov.split(",") if p.strip()]
    if not base or not provs:
        return body
    body["model"] = base
    body["provider"] = {"only": provs, "allow_fallbacks": False}
    return body


def prepare_request_body(raw_body: dict, channel: dict) -> dict:
    """按渠道配置打缓存断点，并过滤非法字段后返回发往上游的 body。"""
    body = _apply_provider_routing(raw_body, channel)
    body = _apply_cache_inject(body, channel)
    body = _filter_allowed_keys(body)
    return body
