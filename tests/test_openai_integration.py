import os
import unittest


TEST_DB = os.path.join(os.path.dirname(__file__), "openai-test.db")
os.environ["DB_PATH"] = TEST_DB
os.environ["ADMIN_PASSWORD"] = "test-admin"
os.environ["ACCESS_KEY"] = "test-access"

import httpx

from database import init_db
from main import app


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


if __name__ == "__main__":
    unittest.main()
