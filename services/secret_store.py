import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import config


PREFIX = "enc:v1:"


def is_configured() -> bool:
    return bool(config.MASTER_KEY)


def _key() -> bytes:
    master_key = config.MASTER_KEY
    if not master_key:
        raise RuntimeError("未配置 CATCH_MASTER_KEY，不能保存订阅账号凭据")
    try:
        key = base64.b64decode(master_key, validate=True)
    except Exception as exc:
        raise RuntimeError("CATCH_MASTER_KEY 不是合法 base64") from exc
    if len(key) != 32:
        raise RuntimeError("CATCH_MASTER_KEY 解码后必须是 32 字节")
    return key


def seal(value: str) -> str:
    if not value:
        return ""
    nonce = os.urandom(12)
    encrypted = AESGCM(_key()).encrypt(nonce, value.encode("utf-8"), None)
    return PREFIX + base64.urlsafe_b64encode(nonce + encrypted).decode("ascii")


def open_secret(value: str) -> str:
    if not value:
        return ""
    if not value.startswith(PREFIX):
        return value
    raw = base64.urlsafe_b64decode(value[len(PREFIX):])
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], None).decode("utf-8")
