import json
import unittest

from services.openai_request_builder import build_client_models, prepare_openai_request


class OpenAIRequestBuilderTests(unittest.TestCase):
    def test_thinking_alias_defaults_to_medium_and_preserves_input(self):
        raw = {
            "model": "gpt-5.6-sol-thinking",
            "messages": [{"role": "user", "content": "hello"}],
            "temperature": 0.4,
        }
        result = prepare_openai_request(raw, {
            "thinking_alias": 1,
            "cache_mode": "off",
        })

        self.assertEqual(result["model"], "gpt-5.6-sol")
        self.assertEqual(result["reasoning_effort"], "medium")
        self.assertEqual(result["temperature"], 0.4)
        self.assertEqual(raw["model"], "gpt-5.6-sol-thinking")

    def test_explicit_cache_marks_selected_message_content_blocks(self):
        raw = {
            "model": "gpt-5.6-terra-thinking-max",
            "stream": True,
            "stream_options": {"include_obfuscation": False},
            "messages": [
                {"role": "developer", "content": "rules"},
                {"role": "user", "content": [{"type": "text", "text": "one"}]},
                {"role": "assistant", "content": "two"},
                {"role": "user", "content": "three"},
            ],
        }
        config = {
            "thinking_alias": 1,
            "cache_mode": "explicit",
            "cache_key": "tavern-main",
            "cache_rules": json.dumps([
                {"direction": "forward", "index": 1},
                {"direction": "backward", "index": 1},
            ]),
        }
        result = prepare_openai_request(raw, config)

        self.assertEqual(result["model"], "gpt-5.6-terra")
        self.assertEqual(result["reasoning_effort"], "max")
        self.assertEqual(result["prompt_cache_key"], "tavern-main")
        self.assertEqual(
            result["prompt_cache_options"], {"mode": "explicit", "ttl": "30m"}
        )
        self.assertEqual(
            result["messages"][0]["content"][0]["prompt_cache_breakpoint"],
            {"mode": "explicit"},
        )
        self.assertEqual(
            result["messages"][3]["content"][0]["prompt_cache_breakpoint"],
            {"mode": "explicit"},
        )
        self.assertTrue(result["stream_options"]["include_usage"])
        self.assertFalse(result["stream_options"]["include_obfuscation"])

    def test_disabled_cache_removes_client_cache_overrides(self):
        raw = {
            "model": "gpt-4o",
            "prompt_cache_key": "client-key",
            "prompt_cache_options": {"mode": "explicit", "ttl": "30m"},
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "text",
                    "text": "hello",
                    "prompt_cache_breakpoint": {"mode": "explicit"},
                }],
            }],
        }
        result = prepare_openai_request(raw, {
            "thinking_alias": 0,
            "cache_mode": "off",
        })

        self.assertNotIn("prompt_cache_key", result)
        self.assertNotIn("prompt_cache_options", result)
        self.assertNotIn(
            "prompt_cache_breakpoint", result["messages"][0]["content"][0]
        )

    def test_model_list_adds_only_base_thinking_alias(self):
        result = build_client_models({
            "models": json.dumps(["gpt-5.6-sol", "gpt-5.6-terra"]),
            "thinking_alias": 1,
        })
        self.assertEqual(result, [
            "gpt-5.6-sol", "gpt-5.6-sol-thinking",
            "gpt-5.6-terra", "gpt-5.6-terra-thinking",
        ])


if __name__ == "__main__":
    unittest.main()
