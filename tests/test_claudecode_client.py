import asyncio
import base64
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import httpx

import config
import database
from main import app
from models import get_setting
from routers.auth import get_sessions
from services import claudecode_client as versions, claudecode_store
from services.claudecode_auth import headers
from services.claudecode_request_builder import prepare
from services.claudecode_upstream import clear_failures, failures


class ClaudeClientVersionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db, self.old_key = database.DB_PATH, config.MASTER_KEY
        database.DB_PATH = os.path.join(self.tmp.name, "test.db")
        config.MASTER_KEY = base64.b64encode(b"v" * 32).decode()
        await database.init_db()
        clear_failures()
        self.addCleanup(clear_failures)
        self.token = "version-test-admin"
        get_sessions().add(self.token)
        self.admin = {"Authorization": "Bearer " + self.token}
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.account_id = await claudecode_store.add_account("Test", "cookie", "http://proxy.test:8080")

    async def asyncTearDown(self):
        await self.client.aclose()
        get_sessions().discard(self.token)
        database.DB_PATH, config.MASTER_KEY = self.old_db, self.old_key
        self.tmp.cleanup()

    async def test_saved_version_changes_headers_and_body_and_can_restore(self):
        url = "/api/claudecode/client-version"
        self.assertEqual((await self.client.get(url)).status_code, 401)
        for version in ("", "latest", "2.1.280\r\nx-header: evil"):
            r = await self.client.post(url + "/apply", headers=self.admin,
                                      json={"version": version, "expected_version": versions.DEFAULT_VERSION})
            self.assertEqual(r.status_code, 400)
        r = await self.client.post(url + "/apply", headers=self.admin,
                                  json={"version": "2.1.281", "expected_version": versions.DEFAULT_VERSION})
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json()["tested_at"])
        body, ua, _ = await prepare({"model": "claude-test", "messages": []})
        self.assertEqual(ua, "claude-code/2.1.281")
        self.assertEqual((await headers())["user-agent"], ua)
        self.assertIn("cc_version=2.1.281.", body["system"][0]["text"])
        self.assertEqual(json.loads(await get_setting(versions.PROFILE_KEY))["version"], "2.1.281")
        r = await self.client.post(url + "/apply", headers=self.admin,
                                  json={"version": "2.1.282", "expected_version": versions.DEFAULT_VERSION})
        self.assertEqual(r.status_code, 400)
        r = await self.client.post(url + "/restore", headers=self.admin,
                                  json={"version": versions.DEFAULT_VERSION, "expected_version": "2.1.281"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(await versions.current_version(), versions.DEFAULT_VERSION)

    async def test_candidate_request_uses_proxy_and_only_success_applies(self):
        original_client = httpx.AsyncClient
        calls = []
        success = False

        def handle(request):
            body = json.loads(request.content)
            self.assertEqual(request.headers["user-agent"], "claude-code/2.1.282")
            self.assertIn("cc_version=2.1.282.", body["system"][0]["text"])
            if success:
                return httpx.Response(200, json={"type": "message", "content": [{"type": "text", "text": "OK"}], "usage": {"input_tokens": 3, "output_tokens": 1}})
            return httpx.Response(400, json={"error": {"message": "Version rejected"}})

        def client_factory(**kwargs):
            calls.append(kwargs)
            return original_client(transport=httpx.MockTransport(handle))

        async def token(_):
            self.assertEqual((await headers())["user-agent"], "claude-code/2.1.282")
            return "test-token"

        payload = {"version": "2.1.282", "expected_version": versions.DEFAULT_VERSION,
                   "account_id": self.account_id, "model": "claude-test"}
        with patch("routers.claudecode.valid_token", token), patch("routers.claudecode.httpx.AsyncClient", client_factory):
            r = await self.client.post("/api/claudecode/client-version/test", headers=self.admin, json=payload)
            self.assertEqual(r.status_code, 502)
            self.assertIn("Version rejected", r.json()["detail"])
            self.assertEqual(failures()[0]["body"]["model"], "claude-test")
            self.assertEqual(await versions.current_version(), versions.DEFAULT_VERSION)
            self.assertTrue((await claudecode_store.get_account(self.account_id))["is_active"])
            success = True
            r = await self.client.post("/api/claudecode/client-version/test", headers=self.admin, json=payload)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["tested_model"], "claude-test")
            self.assertTrue(r.json()["tested_at"])
        self.assertEqual(calls[0]["proxy"], "http://proxy.test:8080")
        self.assertEqual(await versions.current_version(), "2.1.282")
        logs = await claudecode_store.list_requests()
        self.assertEqual({x["status"] for x in logs}, {200, 400})

    async def test_concurrent_candidate_identity_does_not_leak(self):
        async def candidate(version):
            with versions.use_version(version):
                await asyncio.sleep(0)
                return (await headers())["user-agent"]
        self.assertEqual(await asyncio.gather(candidate("2.1.281"), candidate("2.1.282")),
                         ["claude-code/2.1.281", "claude-code/2.1.282"])
        self.assertEqual(await versions.current_version(), versions.DEFAULT_VERSION)

    async def test_check_is_cached_does_not_apply_and_keeps_last_release_on_failure(self):
        original_client = httpx.AsyncClient
        requests = []
        fail = False

        def handle(request):
            requests.append(request)
            self.assertNotIn("authorization", request.headers)
            if fail:
                raise httpx.ConnectError("offline", request=request)
            return httpx.Response(200, json={"name": "@anthropic-ai/claude-code", "version": "2.1.282"})

        with patch("services.claudecode_client.httpx.AsyncClient", lambda **kw: original_client(transport=httpx.MockTransport(handle))):
            first = await versions.check_release()
            self.assertEqual(first["version"], "2.1.282")
            self.assertEqual(await versions.check_release(), first)
            self.assertEqual(len(requests), 1)
            self.assertEqual(await versions.current_version(), versions.DEFAULT_VERSION)
            fail = True
            result = await versions.check_release(force=True)
            self.assertTrue(result["error"])
            self.assertEqual(result["version"], "2.1.282")
            self.assertEqual(result["fetched_at"], first["fetched_at"])


if __name__ == "__main__":
    unittest.main()
