import json
import re

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


# 思考虚拟模型名：<真实模型名>-thinking[-tier]，tier 取值 low/medium/high/xhigh/max。
# 每渠道开关（thinking_alias）——有些中转站本身就有叫 xxx-thinking 的模型，
# 默认关闭避免撞名，需要的渠道自行开启。
_THINKING_ALIAS_RE = re.compile(
    r"^(.+?)-thinking(?:-(low|medium|high|xhigh|max))?$"
)


def _apply_thinking_alias(body: dict, channel: dict) -> dict:
    """渠道开启 thinking_alias 时，把虚拟模型名 `<模型>-thinking[-tier]`
    展开为真实模型名 + adaptive thinking 参数。

    覆盖语义：一旦模型名声明了 thinking/effort，客户端自带的 `thinking` /
    `output_config` 一律被覆盖——模型名即契约。无 tier 时不注入
    output_config，由上游默认挡位决定。

    注意 adaptive thinking / effort 仅 Claude 4.6+ 模型支持，老模型用
    虚拟名会被上游 400，由使用者自行保证。
    """
    if int(channel.get("thinking_alias", 0) or 0) != 1:
        return body
    model = body.get("model")
    if not isinstance(model, str):
        return body
    m = _THINKING_ALIAS_RE.match(model)
    if not m:
        return body
    base, tier = m.group(1), m.group(2)
    body["model"] = base
    body["thinking"] = {"type": "adaptive", "display": "summarized"}
    if tier:
        body["output_config"] = {"effort": tier}
    else:
        body.pop("output_config", None)
    return body


def prepare_request_body(raw_body: dict, channel: dict) -> dict:
    """按渠道配置打缓存断点，并过滤非法字段后返回发往上游的 body。"""
    body = _apply_provider_routing(raw_body, channel)  # 先剥 @供应商
    body = _apply_thinking_alias(body, channel)        # 再剥 -thinking[-tier]
    body = _apply_cache_inject(body, channel)
    body = _filter_allowed_keys(body)
    return body
