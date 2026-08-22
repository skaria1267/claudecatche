import base64
import json
import unittest
from unittest.mock import AsyncMock, patch

import config
from services.claudecode_request_builder import prepare as prepare_claudecode
from services.codex_request_builder import prepare_chat
from services.codex_upstream import _chat_chunk
from services.secret_store import open_secret, seal
from services.proxy_config import normalize_proxy_url


class SubscriptionBuilderTests(unittest.IsolatedAsyncioTestCase):
    async def test_codex_chat_conversion_thinking_cache_and_tools(self):
        settings = {
            "codex_thinking_alias": "1",
            "codex_cache_mode": "explicit",
            "codex_cache_key": "tavern-main",
            "codex_cache_rules": json.dumps([{"direction": "backward", "index": 1}]),
        }
        raw = {
            "model": "gpt-5.3-codex-thinking-high",
            "stream": False,
            "temperature": 0.8,
            "messages": [
                {"role": "system", "content": "system rules"},
                {"role": "user", "content": [
                    {"type": "text", "text": "hello"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA==", "detail": "low"}},
                ]},
            ],
            "tools": [{
                "type": "function",
                "function": {"name": "lookup", "description": "Lookup", "parameters": {"type": "object"}},
            }],
        }
        with patch(
            "services.codex_request_builder.get_setting",
            AsyncMock(side_effect=lambda key: settings.get(key)),
        ):
            body, requested, model, effort = await prepare_chat(raw)

        self.assertEqual(requested, "gpt-5.3-codex-thinking-high")
        self.assertEqual(model, "gpt-5.3-codex")
        self.assertEqual(effort, "high")
        self.assertEqual(body["reasoning"], {"effort": "high"})
        self.assertEqual(body["instructions"], "system rules")
        self.assertTrue(body["stream"])
        self.assertFalse(body["store"])
        self.assertNotIn("temperature", body)
        self.assertEqual(body["prompt_cache_key"], "tavern-main")
        self.assertEqual(
            body["input"][-1]["content"][1]["prompt_cache_breakpoint"],
            {"mode": "explicit"},
        )
        self.assertEqual(body["tools"][0]["name"], "lookup")
        self.assertEqual(body["input"][-1]["content"][1]["type"], "input_image")
        self.assertEqual(body["input"][-1]["content"][1]["detail"], "low")

    async def test_claudecode_thinking_is_adaptive_and_billing_is_added(self):
        settings = {
            "claudecode_thinking_alias": "1",
            "claudecode_cache_mode": "off",
        }
        raw = {
            "model": "claude-sonnet-4-6-thinking-medium",
            "max_tokens": 256,
            "messages": [{"role": "user", "content": "hello world"}],
        }
        with patch(
            "services.claudecode_request_builder.get_setting",
            AsyncMock(side_effect=lambda key: settings.get(key)),
        ):
            body, _, effort = await prepare_claudecode(raw)

        self.assertEqual(body["model"], "claude-sonnet-4-6")
        self.assertEqual(body["thinking"], {"type": "adaptive", "display": "summarized"})
        self.assertEqual(body["output_config"], {"effort": "medium"})
        self.assertEqual(effort, "medium")
        self.assertIn("x-anthropic-billing-header", body["system"][0]["text"])

    def test_codex_sse_events_become_chat_chunks(self):
        created = _chat_chunk(
            {"type": "response.created"}, "gpt-5.3-codex", "chatcmpl-test"
        )
        self.assertEqual(created["choices"][0]["delta"]["role"], "assistant")
        chunk = _chat_chunk(
            {"type": "response.reasoning_summary_text.delta", "delta": "think"},
            "gpt-5.3-codex", "chatcmpl-test",
        )
        self.assertEqual(chunk["choices"][0]["delta"]["reasoning_content"], "think")
        completed = _chat_chunk(
            {"type": "response.completed", "response": {"usage": {"input_tokens": 10, "output_tokens": 4}}},
            "gpt-5.3-codex", "chatcmpl-test",
        )
        self.assertEqual(completed["choices"][0]["finish_reason"], "stop")
        self.assertEqual(completed["usage"]["prompt_tokens"], 10)

    def test_subscription_secrets_are_encrypted(self):
        old = config.MASTER_KEY
        config.MASTER_KEY = base64.b64encode(b"x" * 32).decode("ascii")
        try:
            encrypted = seal("very-secret-token")
            self.assertTrue(encrypted.startswith("enc:v1:"))
            self.assertNotIn("very-secret-token", encrypted)
            self.assertEqual(open_secret(encrypted), "very-secret-token")
        finally:
            config.MASTER_KEY = old

    def test_compact_authenticated_proxy_is_normalized(self):
        self.assertEqual(
            normalize_proxy_url("192.0.2.10:8080:proxy-user:proxy-pass"),
            "http://proxy-user:proxy-pass@192.0.2.10:8080",
        )


if __name__ == "__main__":
    unittest.main()
