# -*- coding: utf-8 -*-
"""L2-lite 多用户认证：PBKDF2 密码哈希 + 签名用户会话 cookie。

与现有单管理员 src.auth 完全独立：独立 cookie 名与独立签名密钥文件。
验证阶段无第三方依赖（仅 stdlib hashlib/hmac）。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

USER_COOKIE_NAME = "dsa_user"
_PBKDF2_ITER = 200_000
SESSION_MAX_AGE_DAYS = 30
MIN_PASSWORD_LEN = 6

_user_session_secret: Optional[bytes] = None


def _data_dir() -> Path:
    db_path = os.getenv("DATABASE_PATH", "./data/stock_analysis.db")
    return Path(db_path).resolve().parent


def _load_secret() -> bytes:
    """加载或创建用户会话签名密钥（独立于 admin 的 .session_secret）。"""
    global _user_session_secret
    if _user_session_secret is not None:
        return _user_session_secret
    d = _data_dir()
    p = d / ".user_session_secret"
    try:
        if p.exists() and p.stat().st_size == 32:
            _user_session_secret = p.read_bytes()
            return _user_session_secret
        d.mkdir(parents=True, exist_ok=True)
        new = secrets.token_bytes(32)
        try:
            with open(p, "xb") as f:
                f.write(new)
            p.chmod(0o600)
            _user_session_secret = new
        except FileExistsError:
            _user_session_secret = p.read_bytes()
        return _user_session_secret
    except OSError as e:  # noqa: BLE001
        logger.error("user session secret error: %s", e)
        if _user_session_secret is None:
            _user_session_secret = secrets.token_bytes(32)
        return _user_session_secret


# ---------------- 密码 ----------------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITER)
    return (
        "pbkdf2_sha256$"
        + str(_PBKDF2_ITER)
        + "$"
        + base64.b64encode(salt).decode("ascii")
        + "$"
        + base64.b64encode(derived).decode("ascii")
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iter_s, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        iters = int(iter_s)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
        return hmac.compare_digest(derived, expected)
    except Exception:  # noqa: BLE001
        return False


def validate_password(pwd: str) -> Optional[str]:
    if not pwd or not pwd.strip():
        return "密码不能为空"
    if len(pwd) < MIN_PASSWORD_LEN:
        return "密码至少 " + str(MIN_PASSWORD_LEN) + " 位"
    return None


# ---------------- 会话 ----------------
def create_user_session(user_id: int) -> str:
    secret = _load_secret()
    payload = str(int(user_id)) + "." + str(int(time.time()))
    sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return payload + "." + sig


def verify_user_session(value: str) -> Optional[int]:
    if not value:
        return None
    parts = value.split(".")
    if len(parts) != 3:
        return None
    uid_s, ts_s, sig = parts
    payload = uid_s + "." + ts_s
    secret = _load_secret()
    expected = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        ts = int(ts_s)
        uid = int(uid_s)
    except ValueError:
        return None
    if time.time() - ts > SESSION_MAX_AGE_DAYS * 86400:
        return None
    return uid
