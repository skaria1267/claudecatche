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

            CREATE TABLE IF NOT EXISTS openai_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
                api_key TEXT NOT NULL DEFAULT '',
                models TEXT NOT NULL DEFAULT '[]',
                is_active INTEGER NOT NULL DEFAULT 0,
                proxy_url TEXT NOT NULL DEFAULT '',
                thinking_alias INTEGER NOT NULL DEFAULT 0,
                cache_mode TEXT NOT NULL DEFAULT 'off',
                cache_key TEXT NOT NULL DEFAULT '',
                cache_rules TEXT NOT NULL DEFAULT '[]',
                updated_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS openai_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model TEXT,
                prompt_tokens INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                cached_tokens INTEGER DEFAULT 0,
                cache_write_tokens INTEGER DEFAULT 0,
                reasoning_tokens INTEGER DEFAULT 0,
                request_at INTEGER DEFAULT (strftime('%s','now')),
                duration_ms INTEGER DEFAULT 0,
                status INTEGER DEFAULT 200
            );

            CREATE TABLE IF NOT EXISTS claudecode_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                credential_secret TEXT NOT NULL,
                access_secret TEXT NOT NULL DEFAULT '',
                refresh_secret TEXT NOT NULL DEFAULT '',
                token_expires_at INTEGER DEFAULT 0,
                email TEXT DEFAULT '',
                subscription_type TEXT DEFAULT '',
                organization_id TEXT DEFAULT '',
                proxy_url TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                disable_reason TEXT DEFAULT '',
                last_usage_json TEXT DEFAULT '{}',
                usage_refreshed_at INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS claudecode_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER,
                model TEXT DEFAULT '',
                thinking_effort TEXT DEFAULT '',
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cache_creation_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0,
                request_at INTEGER DEFAULT (strftime('%s','now')),
                duration_ms INTEGER DEFAULT 0,
                status INTEGER DEFAULT 200,
                FOREIGN KEY(account_id) REFERENCES claudecode_accounts(id)
            );

            CREATE TABLE IF NOT EXISTS codex_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                access_secret TEXT NOT NULL DEFAULT '',
                refresh_secret TEXT NOT NULL DEFAULT '',
                id_secret TEXT NOT NULL DEFAULT '',
                token_expires_at INTEGER DEFAULT 0,
                account_uid TEXT DEFAULT '',
                email TEXT DEFAULT '',
                subscription_type TEXT DEFAULT '',
                proxy_url TEXT DEFAULT '',
                models TEXT DEFAULT '[]',
                is_active INTEGER DEFAULT 1,
                disable_reason TEXT DEFAULT '',
                last_usage_json TEXT DEFAULT '{}',
                usage_refreshed_at INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS codex_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER,
                requested_model TEXT DEFAULT '',
                model TEXT DEFAULT '',
                thinking_effort TEXT DEFAULT '',
                prompt_tokens INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                cached_tokens INTEGER DEFAULT 0,
                cache_write_tokens INTEGER DEFAULT 0,
                reasoning_tokens INTEGER DEFAULT 0,
                request_at INTEGER DEFAULT (strftime('%s','now')),
                duration_ms INTEGER DEFAULT 0,
                status INTEGER DEFAULT 200,
                FOREIGN KEY(account_id) REFERENCES codex_accounts(id)
            );
        """)

        await db.execute("""
            INSERT OR IGNORE INTO openai_config (
                id, base_url, api_key, models, is_active, proxy_url,
                thinking_alias, cache_mode, cache_key, cache_rules
            ) VALUES (1, 'https://api.openai.com/v1', '', '[]', 0, '', 0, 'off', '', '[]')
        """)
        await db.executemany(
            "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
            [
                ("claudecode_enabled", "0"),
                ("claudecode_models", "[]"),
                ("claudecode_thinking_alias", "1"),
                ("claudecode_cache_mode", "auto"),
                ("claudecode_cache_ttl", "5m"),
                ("claudecode_cache_rules", "[]"),
                ("claudecode_rpm_limit", "0"),
                ("codex_enabled", "0"),
                ("codex_models", "[]"),
                ("codex_thinking_alias", "1"),
                ("codex_cache_mode", "auto"),
                ("codex_cache_key", ""),
                ("codex_cache_rules", "[]"),
                ("codex_allow_unlisted_models", "1"),
            ],
        )

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

        cur = await db.execute("PRAGMA table_info(claudecode_accounts)")
        _cc_cols = [r[1] for r in await cur.fetchall()]
        if "access_secret" not in _cc_cols:
            await db.execute(
                "ALTER TABLE claudecode_accounts ADD COLUMN access_secret TEXT NOT NULL DEFAULT ''"
            )

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
