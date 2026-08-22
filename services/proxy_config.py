from urllib.parse import quote


SCHEMES = ("http://", "https://", "socks5://", "socks5h://", "socks4://")


def normalize_proxy_url(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    if value.startswith(SCHEMES):
        return value
    parts = value.split(":", 3)
    if len(parts) == 2 and parts[0] and parts[1].isdigit():
        return f"http://{parts[0]}:{parts[1]}"
    if len(parts) == 4 and parts[0] and parts[1].isdigit() and parts[2]:
        user = quote(parts[2], safe="")
        password = quote(parts[3], safe="")
        return f"http://{user}:{password}@{parts[0]}:{parts[1]}"
    raise ValueError(
        "代理需使用 URL，host:port，或 host:port:user:password 格式"
    )
