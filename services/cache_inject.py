def _make_cc(ttl: str = None) -> dict:
    cc = {"type": "ephemeral"}
    if ttl and ttl != "5m":
        cc["ttl"] = ttl
    return cc


def _inject_at(messages: list, idx: int, ttl: str = None):
    if idx < 0 or idx >= len(messages):
        return
    msg = messages[idx]
    cc = _make_cc(ttl)
    content = msg.get("content")
    if isinstance(content, str):
        messages[idx]["content"] = [
            {"type": "text", "text": content, "cache_control": cc}
        ]
    elif isinstance(content, list) and content:
        content[-1]["cache_control"] = cc


def _inject_system(body: dict, ttl: str = None):
    cc = _make_cc(ttl)
    system = body.get("system")
    if not system:
        return
    if isinstance(system, str):
        body["system"] = [
            {"type": "text", "text": system, "cache_control": cc}
        ]
    elif isinstance(system, list) and system:
        system[-1]["cache_control"] = cc


def _auto_inject(body: dict, ttl: str = None) -> dict:
    body["cache_control"] = _make_cc(ttl)
    _inject_system(body, ttl)
    return body


def _rules_inject(body: dict, ttl: str = None, rules: list = None) -> dict:
    if not rules:
        return body

    messages = body.get("messages", [])
    injected_msg_indices = set()

    for rule in rules[:4]:
        target = rule.get("target", "messages")
        direction = rule.get("direction", "backward")
        index = rule.get("index", 1)
        if index < 1:
            continue

        if target == "system":
            _inject_system(body, ttl)
        elif target == "messages" and messages:
            if direction == "forward":
                idx = index - 1
            else:
                idx = len(messages) - index
            idx = max(0, min(idx, len(messages) - 1))
            if idx not in injected_msg_indices:
                _inject_at(messages, idx, ttl)
                injected_msg_indices.add(idx)

    if messages:
        body["messages"] = messages
    return body


def inject_cache_breakpoints(body: dict, mode: str = "auto", ttl: str = "5m",
                             rules: list = None) -> dict:
    if mode == "rules":
        return _rules_inject(body, ttl, rules=rules)
    return _auto_inject(body, ttl)
