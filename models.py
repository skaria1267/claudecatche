import aiosqlite
from database import get_db

# ========== 渠道 ==========

_CHANNEL_FIELDS = (
    "name", "base_url", "api_key", "auth_mode", "models",
    "cache_enabled", "cache_mode", "cache_ttl", "cache_rules",
    "or_routing", "or_providers", "thinking_alias", "proxy_url", "is_active",
)


async def add_channel(name: str, base_url: str, api_key: str, auth_mode: str = "both",
                      models: str = "", cache_enabled: int = 1, cache_mode: str = "auto",
                      cache_ttl: str = "5m", cache_rules: str = "[]",
                      or_routing: int = 0,
                      or_providers: str = "anthropic,google-vertex,amazon-bedrock",
                      thinking_alias: int = 0, proxy_url: str = ""):
    async with get_db() as db:
        await db.execute(
            """INSERT INTO channels
               (name, base_url, api_key, auth_mode, models,
                cache_enabled, cache_mode, cache_ttl, cache_rules,
                or_routing, or_providers, thinking_alias, proxy_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (name, base_url, api_key, auth_mode, models,
             cache_enabled, cache_mode, cache_ttl, cache_rules,
             or_routing, or_providers, thinking_alias, proxy_url)
        )
        await db.commit()


async def get_channels():
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM channels ORDER BY id") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def get_channel(channel_id: int):
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM channels WHERE id = ?", (channel_id,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def get_channel_by_name(name: str):
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM channels WHERE name = ?", (name,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def update_channel(channel_id: int, **kwargs):
    fields = ", ".join(f"{k} = ?" for k in kwargs)
    values = list(kwargs.values()) + [channel_id]
    async with get_db() as db:
        await db.execute(f"UPDATE channels SET {fields} WHERE id = ?", values)
        await db.commit()


async def delete_channel(channel_id: int):
    async with get_db() as db:
        await db.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
        await db.commit()


# ========== 请求日志 ==========

async def add_request_log(channel_id: int, channel_name: str, model: str,
                          input_tokens: int, output_tokens: int,
                          cache_creation_tokens: int, cache_read_tokens: int,
                          duration_ms: int, status: int):
    async with get_db() as db:
        await db.execute("""
            INSERT INTO requests (
                channel_id, channel_name, model,
                input_tokens, output_tokens,
                cache_creation_tokens, cache_read_tokens,
                duration_ms, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            channel_id, channel_name, model,
            input_tokens, output_tokens,
            cache_creation_tokens, cache_read_tokens,
            duration_ms, status
        ))
        await db.commit()


async def get_requests(channel_id: int = None, limit: int = 50, offset: int = 0):
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        if channel_id:
            async with db.execute(
                "SELECT * FROM requests WHERE channel_id = ? ORDER BY request_at DESC LIMIT ? OFFSET ?",
                (channel_id, limit, offset)
            ) as cursor:
                rows = await cursor.fetchall()
        else:
            async with db.execute(
                "SELECT * FROM requests ORDER BY request_at DESC LIMIT ? OFFSET ?",
                (limit, offset)
            ) as cursor:
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_usage_summary(channel_id: int = None):
    async with get_db() as db:
        db.row_factory = aiosqlite.Row
        cols = """
            COUNT(*) as total_requests,
            SUM(input_tokens) as total_input,
            SUM(output_tokens) as total_output,
            SUM(cache_creation_tokens) as total_cache_creation,
            SUM(cache_read_tokens) as total_cache_read,
            MIN(request_at) as first_request,
            MAX(request_at) as last_request
        """
        if channel_id:
            async with db.execute(
                f"SELECT {cols} FROM requests WHERE channel_id = ?", (channel_id,)
            ) as cursor:
                row = await cursor.fetchone()
        else:
            async with db.execute(f"SELECT {cols} FROM requests") as cursor:
                row = await cursor.fetchone()
        return dict(row) if row else {}


# ========== 设置 ==========

async def get_setting(key: str):
    async with get_db() as db:
        async with db.execute("SELECT value FROM settings WHERE key = ?", (key,)) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else None


async def set_setting(key: str, value: str):
    async with get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value)
        )
        await db.commit()
