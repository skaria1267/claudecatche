"""One-time import of Wanquan accounts, settings, and request logs."""

import argparse
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import DB_PATH
from services.secret_store import is_configured, seal
from services.proxy_config import normalize_proxy_url


def columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def import_wanquan(source_path: str, target_path: str) -> tuple[int, int]:
    if not is_configured():
        raise RuntimeError("请先配置 CATCH_MASTER_KEY")
    source = sqlite3.connect(source_path)
    source.row_factory = sqlite3.Row
    target = sqlite3.connect(target_path)
    target.row_factory = sqlite3.Row
    account_map = {}
    imported_accounts = 0
    imported_requests = 0
    try:
        account_columns = columns(source, "accounts")
        for account in source.execute("SELECT * FROM accounts ORDER BY id"):
            kind = account["type"] if "type" in account_columns else "cookie"
            credential = account["credential"] or ""
            refresh = account["refresh_token"] if "refresh_token" in account_columns else ""
            access_secret = seal(credential) if kind == "oauth" else ""
            credential_secret = seal(credential) if kind != "oauth" else ""
            cursor = target.execute(
                """INSERT INTO claudecode_accounts (
                       name, credential_secret, access_secret, refresh_secret,
                       token_expires_at, proxy_url, is_active, disable_reason, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    account["name"], credential_secret, access_secret, seal(refresh or ""),
                    account["token_expires_at"] if "token_expires_at" in account_columns else 0,
                    normalize_proxy_url(account["proxy_url"] if "proxy_url" in account_columns else ""),
                    account["is_active"] if "is_active" in account_columns else 1,
                    account["disable_reason"] if "disable_reason" in account_columns else "",
                    account["created_at"] if "created_at" in account_columns else None,
                ),
            )
            account_map[account["id"]] = cursor.lastrowid
            imported_accounts += 1

        request_columns = columns(source, "requests")
        for request in source.execute("SELECT * FROM requests ORDER BY id"):
            target.execute(
                """INSERT INTO claudecode_requests (
                       account_id, input_tokens, output_tokens, cache_creation_tokens,
                       cache_read_tokens, request_at, duration_ms, status
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    account_map.get(request["account_id"]), request["input_tokens"] or 0,
                    request["output_tokens"] or 0, request["cache_creation_tokens"] or 0,
                    request["cache_read_tokens"] or 0,
                    request["request_at"] if "request_at" in request_columns else None,
                    request["duration_ms"] or 0, request["status"] or 0,
                ),
            )
            imported_requests += 1

        settings = dict(source.execute("SELECT key, value FROM settings").fetchall())
        mapping = {
            "rpm_limit": "claudecode_rpm_limit", "cache_mode": "claudecode_cache_mode",
            "cache_ttl": "claudecode_cache_ttl", "cache_rules": "claudecode_cache_rules",
        }
        for old_key, new_key in mapping.items():
            if old_key in settings:
                target.execute(
                    "INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)",
                    (new_key, settings[old_key]),
                )
        if settings.get("cache_enabled") == "0":
            target.execute(
                "INSERT OR REPLACE INTO settings(key, value) VALUES ('claudecode_cache_mode', 'off')"
            )
        if imported_accounts:
            target.execute(
                "INSERT OR REPLACE INTO settings(key, value) VALUES ('claudecode_enabled', '1')"
            )
        target.commit()
    finally:
        source.close()
        target.close()
    return imported_accounts, imported_requests


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Wanquan into Claude Catche")
    parser.add_argument("source", help="Path to the Wanquan SQLite database")
    parser.add_argument("--target", default=DB_PATH, help="Path to the Catch SQLite database")
    args = parser.parse_args()
    accounts, requests = import_wanquan(args.source, args.target)
    print(f"Imported {accounts} accounts and {requests} requests")


if __name__ == "__main__":
    main()
