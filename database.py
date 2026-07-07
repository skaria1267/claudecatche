import aiosqlite
from config import DB_PATH


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                auth_mode TEXT NOT NULL DEFAULT 'both' CHECK(auth_mode IN ('x', 'a', 'both')),
                models TEXT DEFAULT '',
                cache_enabled INTEGER DEFAULT 1,
                cache_mode TEXT DEFAULT 'auto',
                cache_ttl TEXT DEFAULT '5m',
                cache_rules TEXT DEFAULT '[]',
                or_routing INTEGER DEFAULT 0,
                or_providers TEXT DEFAULT 'anthropic,google-vertex,amazon-bedrock',
                thinking_alias INTEGER DEFAULT 0,
                proxy_url TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id INTEGER,
                channel_name TEXT,
                model TEXT,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cache_creation_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0,
                request_at INTEGER DEFAULT (strftime('%s','now')),
                duration_ms INTEGER DEFAULT 0,
                status INTEGER DEFAULT 200,
                FOREIGN KEY(channel_id) REFERENCES channels(id)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        """)

        # 迁移：给已存在的旧库补 OpenRouter 供应商路由相关列
        cur = await db.execute("PRAGMA table_info(channels)")
        _cols = [r[1] for r in await cur.fetchall()]
        if "or_routing" not in _cols:
            await db.execute("ALTER TABLE channels ADD COLUMN or_routing INTEGER DEFAULT 0")
        if "or_providers" not in _cols:
            await db.execute(
                "ALTER TABLE channels ADD COLUMN or_providers TEXT DEFAULT 'anthropic,google-vertex,amazon-bedrock'"
            )
        if "thinking_alias" not in _cols:
            await db.execute("ALTER TABLE channels ADD COLUMN thinking_alias INTEGER DEFAULT 0")
        if "proxy_url" not in _cols:
            await db.execute("ALTER TABLE channels ADD COLUMN proxy_url TEXT DEFAULT ''")

        # admin_password / access_key 只在首次初始化时写入（INSERT OR IGNORE），
        # 避免每次容器重启都被环境变量覆盖掉用户在面板里改过的值。
        # 想强制重置请设 FORCE_RESET_ADMIN_PASSWORD=1。
        from config import INIT_ADMIN_PASSWORD, INIT_ACCESS_KEY
        import os
        await db.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES ('admin_password', ?)",
            (INIT_ADMIN_PASSWORD or 'admin123',),
        )
        await db.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES ('access_key', ?)",
            (INIT_ACCESS_KEY or '',),
        )
        if os.environ.get("FORCE_RESET_ADMIN_PASSWORD") == "1" and INIT_ADMIN_PASSWORD:
            await db.execute(
                "UPDATE settings SET value = ? WHERE key = 'admin_password'",
                (INIT_ADMIN_PASSWORD,),
            )
        await db.commit()


def get_db():
    return aiosqlite.connect(DB_PATH)
