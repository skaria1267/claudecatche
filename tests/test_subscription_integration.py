import base64
import os
import sqlite3
import unittest

import httpx

import config
import database
from database import init_db
from main import app
from models import set_setting
from routers.auth import get_sessions
from services import claudecode_store, codex_store
from scripts.import_wanquan import import_wanquan


TEST_DB = os.path.join(os.path.dirname(__file__), "subscriptions-test.db")
WANQUAN_DB = os.path.join(os.path.dirname(__file__), "wanquan-source-test.db")


class SubscriptionIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if os.path.exists(TEST_DB):
            os.unlink(TEST_DB)
        if os.path.exists(WANQUAN_DB):
            os.unlink(WANQUAN_DB)
        database.DB_PATH = TEST_DB
        config.MASTER_KEY = base64.b64encode(b"s" * 32).decode("ascii")
        await init_db()
        await set_setting("access_key", "subscription-access")
        self.token = "subscription-admin-token"
        get_sessions().add(self.token)
        self.admin = {"Authorization": f"Bearer {self.token}"}
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        get_sessions().discard(self.token)
        if os.path.exists(TEST_DB):
            os.unlink(TEST_DB)
        if os.path.exists(WANQUAN_DB):
            os.unlink(WANQUAN_DB)

    async def test_accounts_are_isolated_encrypted_and_public_routes_are_specific(self):
        response = await self.client.post(
            "/api/codex/accounts", headers=self.admin,
            json={"name": "Codex One", "proxy_url": "http://127.0.0.1:8080"},
        )
        self.assertEqual(response.status_code, 200)
        codex_id = response.json()["id"]

        response = await self.client.post(
            "/api/claudecode/accounts", headers=self.admin,
            json={"name": "Claude One", "credential": "session-secret", "proxy_url": ""},
        )
        self.assertEqual(response.status_code, 200)
        claude_id = response.json()["id"]

        raw_claude = await claudecode_store.get_account(claude_id)
        self.assertTrue(raw_claude["credential_secret"].startswith("enc:v1:"))
        self.assertNotIn("session-secret", raw_claude["credential_secret"])
        public_claude = (await claudecode_store.list_accounts())[0]
        self.assertNotIn("credential_secret", public_claude)

        raw_codex = await codex_store.get_account(codex_id)
        self.assertNotIn("access_token", raw_codex)

        for kind, model in (("codex", "gpt-5.3-codex"), ("claudecode", "claude-sonnet-4-6")):
            response = await self.client.patch(
                f"/api/{kind}/config", headers=self.admin,
                json={"enabled": 1, "models": f'["{model}"]', "thinking_alias": 1},
            )
            self.assertEqual(response.status_code, 200)
            response = await self.client.get(
                f"/{kind}/v1/models",
                headers={"Authorization": "Bearer subscription-access"},
            )
            self.assertEqual(response.status_code, 200)
            ids = [item["id"] for item in response.json()["data"]]
            self.assertEqual(ids, [model, f"{model}-thinking"])

        self.assertEqual(
            (await self.client.get("/api/codex/logs", headers=self.admin)).json(), []
        )
        self.assertEqual(
            (await self.client.get("/api/claudecode/logs", headers=self.admin)).json(), []
        )

    async def test_system_route_names_cannot_be_created_as_channels(self):
        for name in ("gpt", "codex", "claudecode", "CODEX"):
            response = await self.client.post(
                "/api/channels", headers=self.admin,
                json={"name": name, "base_url": "https://example.com", "api_key": "key"},
            )
            self.assertEqual(response.status_code, 400)

    async def test_wanquan_import_reencrypts_accounts_and_preserves_logs(self):
        source = sqlite3.connect(WANQUAN_DB)
        source.executescript("""
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY, name TEXT, type TEXT, credential TEXT,
                refresh_token TEXT, token_expires_at INTEGER, is_active INTEGER,
                disable_reason TEXT, proxy_url TEXT, created_at INTEGER
            );
            CREATE TABLE requests (
                id INTEGER PRIMARY KEY, account_id INTEGER, input_tokens INTEGER,
                output_tokens INTEGER, cache_creation_tokens INTEGER,
                cache_read_tokens INTEGER, request_at INTEGER, duration_ms INTEGER,
                status INTEGER
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO accounts VALUES
                (1, 'Old Claude', 'cookie', 'old-session', '', 0, 1, '',
                 '127.0.0.1:8080', 1700000000);
            INSERT INTO requests VALUES
                (1, 1, 12, 4, 3, 8, 1700000010, 250, 200);
            INSERT INTO settings VALUES ('rpm_limit', '9');
            INSERT INTO settings VALUES ('cache_enabled', '0');
        """)
        source.commit()
        source.close()

        accounts, requests = import_wanquan(WANQUAN_DB, TEST_DB)
        self.assertEqual((accounts, requests), (1, 1))
        imported = (await claudecode_store.list_accounts(public=False))[0]
        self.assertTrue(imported["credential_secret"].startswith("enc:v1:"))
        self.assertNotIn("old-session", imported["credential_secret"])
        self.assertEqual(imported["proxy_url"], "http://127.0.0.1:8080")
        logs = await claudecode_store.list_requests()
        self.assertEqual(logs[0]["input_tokens"], 12)
        self.assertEqual(logs[0]["cache_read_tokens"], 8)


if __name__ == "__main__":
    unittest.main()
