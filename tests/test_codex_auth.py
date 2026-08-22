import base64
import hashlib
import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

class CodexAuthcodeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        global codex_auth
        from services import codex_auth as codex_auth_module

        codex_auth = codex_auth_module
        codex_auth._auth_sessions.clear()

    def tearDown(self):
        codex_auth._auth_sessions.clear()

    async def _start(self):
        account = {"id": 7, "proxy_url": "http://proxy.example:8080"}
        with patch(
            "services.codex_auth.codex_store.get_account",
            AsyncMock(return_value=account),
        ):
            return await codex_auth.authcode_start(7)

    async def test_authcode_start_builds_cli_pkce_authorize_url(self):
        started = await self._start()
        parsed = urlparse(started["authorize_url"])
        query = parse_qs(parsed.query)
        session = codex_auth._auth_sessions[started["login_session_id"]]
        expected_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(session["verifier"].encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")

        self.assertEqual(f"{parsed.scheme}://{parsed.netloc}{parsed.path}", codex_auth.AUTHORIZE_URL)
        self.assertEqual(query["client_id"], [codex_auth.OAUTH_CLIENT_ID])
        self.assertEqual(query["redirect_uri"], [codex_auth.AUTHCODE_REDIRECT_URI])
        self.assertEqual(query["code_challenge"], [expected_challenge])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["state"], [session["state"]])
        self.assertEqual(query["originator"], ["codex_exec"])

    async def test_callback_exchanges_through_account_proxy_and_is_one_time(self):
        started = await self._start()
        session_id = started["login_session_id"]
        session = codex_auth._auth_sessions[session_id]
        callback_url = (
            f"http://localhost:1455/auth/callback?code=auth-code"
            f"&state={session['state']}"
        )
        account = {"id": 7, "proxy_url": "http://proxy.example:8080"}
        exchange = AsyncMock(return_value={"access_token": "access", "expires_in": 3600})
        save = AsyncMock()
        with (
            patch("services.codex_auth.codex_store.get_account", AsyncMock(return_value=account)),
            patch("services.codex_auth._exchange_code", exchange),
            patch("services.codex_auth.save_login", save),
        ):
            result = await codex_auth.authcode_complete(7, session_id, callback_url)

        self.assertEqual(result["status"], "ready")
        exchange.assert_awaited_once_with(
            "auth-code", session["verifier"], account["proxy_url"],
            codex_auth.AUTHCODE_REDIRECT_URI,
        )
        save.assert_awaited_once_with(7, {"access_token": "access", "expires_in": 3600})
        self.assertNotIn(session_id, codex_auth._auth_sessions)
        with self.assertRaisesRegex(RuntimeError, "不存在或已过期"):
            await codex_auth.authcode_complete(7, session_id, callback_url)

    async def test_callback_rejects_wrong_state_without_consuming_session(self):
        started = await self._start()
        session_id = started["login_session_id"]
        exchange = AsyncMock()
        with patch("services.codex_auth._exchange_code", exchange):
            with self.assertRaisesRegex(RuntimeError, "state 不匹配"):
                await codex_auth.authcode_complete(
                    7,
                    session_id,
                    "http://localhost:1455/auth/callback?code=auth-code&state=wrong",
                )
        exchange.assert_not_awaited()
        self.assertIn(session_id, codex_auth._auth_sessions)

    def test_callback_requires_exact_loopback_redirect(self):
        with self.assertRaisesRegex(RuntimeError, "完整 localhost 回调 URL"):
            codex_auth._callback_values(
                "https://example.com/auth/callback?code=auth-code&state=state"
            )

        with self.assertRaisesRegex(RuntimeError, "完整 localhost 回调 URL"):
            codex_auth._callback_values(
                "http://localhost:invalid/auth/callback?code=auth-code&state=state"
            )


if __name__ == "__main__":
    unittest.main()
