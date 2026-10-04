import time

import aiosqlite

from database import get_db
from services.usage_filters import usage_where

# 四个请求表的统一字段映射：(表名, 输入, 输出, 缓存写入, 缓存读取, 筛选列)。
_SOURCES = {
    "claude": ("requests", "input_tokens", "output_tokens",
               "cache_creation_tokens", "cache_read_tokens", "channel_id"),
    "openai": ("openai_requests", "prompt_tokens", "completion_tokens",
               "cache_write_tokens", "cached_tokens", None),
    "codex": ("codex_requests", "prompt_tokens", "completion_tokens",
              "cache_write_tokens", "cached_tokens", "account_id"),
    "claudecode": ("claudecode_requests", "input_tokens", "output_tokens",
                   "cache_creation_tokens", "cache_read_tokens", "account_id"),
}
SOURCES = (*_SOURCES, "main")
MAX_TZ_OFFSET = 14 * 3600


def _select(source: str, start_at, end_at, target_id) -> tuple[str, list]:
    """把一个来源的请求表投影成 request_at / input / output / cache_write / cache_read。"""
    table, inp, out, write, read, column = _SOURCES[source]
    where, params = usage_where(
        start_at, end_at,
        channel_id=target_id if column == "channel_id" else None,
        account_id=target_id if column == "account_id" else None,
    )
    return (f"SELECT request_at, {inp} AS input, {out} AS output, "
            f"{write} AS cache_write, {read} AS cache_read FROM {table}{where}"), params


def _union(source: str, start_at, end_at, target_id) -> tuple[str, list]:
    # main = Claude 渠道 + OpenAI；按渠道筛选时只看 Claude 渠道。
    parts = ["claude", "openai"] if source == "main" and target_id is None else \
        ["claude"] if source == "main" else [source]
    sqls, params = [], []
    for part in parts:
        sql, part_params = _select(part, start_at, end_at, target_id)
        sqls.append(sql)
        params.extend(part_params)
    return " UNION ALL ".join(sqls), params


async def daily_usage(source: str, target_id: int | None = None,
                      start_at: int | None = None, end_at: int | None = None,
                      tz_offset: int = 0) -> list[dict]:
    """按客户端时区的自然日分组。tz_offset 为本地时间相对 UTC 的秒数（东八区 = 28800）。"""
    sql, params = _union(source, start_at, end_at, target_id)
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"""SELECT date(request_at + ?, 'unixepoch') AS day, COUNT(*) AS requests,
                       COALESCE(SUM(input), 0) AS input, COALESCE(SUM(output), 0) AS output,
                       COALESCE(SUM(cache_write), 0) AS cache_write,
                       COALESCE(SUM(cache_read), 0) AS cache_read
                FROM ({sql}) GROUP BY day ORDER BY day""",
            [tz_offset, *params],
        ) as cursor:
            return [dict(row) for row in await cursor.fetchall()]


async def overview(tz_offset: int = 0, days: int = 7) -> dict:
    """总览用：各路由今日请求与 Token，以及最近 days 天每日请求数。"""
    now = int(time.time())
    today_start = (now + tz_offset) // 86400 * 86400 - tz_offset
    window_start = today_start - (days - 1) * 86400
    day_keys = [time.strftime("%Y-%m-%d", time.gmtime(window_start + i * 86400 + tz_offset))
                for i in range(days)]
    result = {"days": day_keys, "today_start": today_start, "routes": {}}
    for source in _SOURCES:
        rows = {r["day"]: r for r in await daily_usage(source, start_at=window_start, tz_offset=tz_offset)}
        today = rows.get(day_keys[-1], {})
        result["routes"][source] = {
            "today_requests": today.get("requests", 0),
            "today_tokens": sum(today.get(k, 0) for k in ("input", "output", "cache_write", "cache_read")),
            "trend": [rows.get(day, {}).get("requests", 0) for day in day_keys],
        }
    return result
