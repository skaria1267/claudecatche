import os
import unittest


TEST_DB = os.path.join(os.path.dirname(__file__), "openai-test.db")
os.environ["DB_PATH"] = TEST_DB
os.environ["ADMIN_PASSWORD"] = "test-admin"
os.environ["ACCESS_KEY"] = "test-access"

import httpx

from database import init_db
from main import app
from models import add_openai_request_log, add_request_log
from services.openai_upstream import forward_openai_normal
from services.upstream import clear_failures, get_recent_failures


class OpenAIIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if os.path.exists(TEST_DB):
            os.unlink(TEST_DB)
        await init_db()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        response = await self.client.post(
            "/api/login", json={"password": "test-admin"}
        )
        self.assertEqual(response.status_code, 200)
        self.admin_headers = {
            "Authorization": "Bearer " + response.json()["token"]
        }
        clear_failures()

    async def asyncTearDown(self):
        await self.client.aclose()
        if os.path.exists(TEST_DB):
            os.unlink(TEST_DB)

    async def test_config_is_secret_safe_and_public_models_route_is_specific(self):
        response = await self.client.patch(
            "/api/openai/config",
            headers=self.admin_headers,
            json={
                "api_key": "sk-test-secret-value",
                "models": '["gpt-5.6-sol"]',
                "is_active": 1,
                "thinking_alias": 1,
                "cache_mode": "explicit",
                "cache_rules": '[{"direction":"forward","index":1}]',
            },
        )
        self.assertEqual(response.status_code, 200)

        response = await self.client.get(
            "/api/openai/config", headers=self.admin_headers
        )
        self.assertEqual(response.status_code, 200)
        config = response.json()
        self.assertNotIn("api_key", config)
        self.assertTrue(config["api_key_configured"])
        self.assertNotIn("test-secret", config["api_key_mask"])

        response = await self.client.get("/gpt/v1/models")
        self.assertEqual(response.status_code, 401)

        response = await self.client.get(
            "/gpt/v1/models",
            headers={"Authorization": "Bearer test-access"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["id"] for item in response.json()["data"]],
            ["gpt-5.6-sol", "gpt-5.6-sol-thinking"],
        )

    async def test_logs_include_openai_usage_fields(self):
        await add_request_log(
            channel_id=1, channel_name="Claude A", model="claude-test",
            input_tokens=10, output_tokens=4,
            cache_creation_tokens=3, cache_read_tokens=2,
            duration_ms=120, status=200,
        )
        await add_openai_request_log(
            model="gpt-5.6-sol", prompt_tokens=100,
            completion_tokens=30, cached_tokens=60,
            cache_write_tokens=20, reasoning_tokens=12,
            duration_ms=450, status=200,
        )

        response = await self.client.get(
            "/api/logs?source=openai", headers=self.admin_headers
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source"], "openai")
        self.assertEqual(rows[0]["channel_name"], "OpenAI")
        self.assertEqual(rows[0]["input_tokens"], 100)
        self.assertEqual(rows[0]["output_tokens"], 30)
        self.assertEqual(rows[0]["cache_creation_tokens"], 20)
        self.assertEqual(rows[0]["cache_read_tokens"], 60)
        self.assertEqual(rows[0]["reasoning_tokens"], 12)

        response = await self.client.get(
            "/api/logs", headers=self.admin_headers
        )
        self.assertEqual({row["source"] for row in response.json()}, {"claude", "openai"})

    async def test_openai_failure_keeps_complete_request_body(self):
        class FakeResponse:
            status_code = 429
            text = '{"error":{"message":"rate limited"}}'

            def json(self):
                return {"error": {"message": "rate limited"}}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, *args, **kwargs):
                return FakeResponse()

        import unittest.mock
        body = {
            "model": "gpt-5.6-sol",
            "messages": [{"role": "user", "content": "keep all of this"}],
            "reasoning_effort": "high",
        }
        config = {
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-test",
            "proxy_url": "",
        }
        with unittest.mock.patch(
            "services.openai_upstream.httpx.AsyncClient", FakeClient
        ):
            response = await forward_openai_normal(body, config, 0)

        self.assertEqual(response.status_code, 429)
        failures = get_recent_failures()
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["channel"], "OpenAI")
        self.assertEqual(failures[0]["body"], body)


if __name__ == "__main__":
    unittest.main()
