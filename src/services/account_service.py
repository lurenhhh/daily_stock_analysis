# -*- coding: utf-8 -*-
"""L2-lite 账号与用户看板的 service 层（最小实现）。"""

from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.storage import User, UserDashboard, UserDossier
from src.user_auth import hash_password, verify_password


class UserService:
    def __init__(self, db: Session):
        self.db = db

    def get_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(User.email == email).first()

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.db.get(User, user_id)

    def register(
        self, email: str, password: str, nickname: Optional[str]
    ) -> Tuple[Optional[User], Optional[str]]:
        email = (email or "").strip().lower()
        if not email or "@" not in email:
            return None, "邮箱格式不正确"
        if self.get_by_email(email):
            return None, "该邮箱已注册"
        user = User(
            email=email,
            password_hash=hash_password(password),
            nickname=(nickname or None),
        )
        self.db.add(user)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            return None, "该邮箱已注册"
        self.db.refresh(user)
        return user, None

    def authenticate(self, email: str, password: str) -> Optional[User]:
        user = self.get_by_email((email or "").strip().lower())
        if not user or not verify_password(password, user.password_hash):
            return None
        return user


class DashboardService:
    def __init__(self, db: Session):
        self.db = db

    def get(self, user_id: int) -> Tuple[List, Optional[datetime]]:
        row = self.db.get(UserDashboard, user_id)
        if not row:
            return [], None
        try:
            items = json.loads(row.data_json) if row.data_json else []
            if not isinstance(items, list):
                items = []
        except Exception:  # noqa: BLE001
            items = []
        return items, row.updated_at

    def save(self, user_id: int, items: List) -> datetime:
        payload = json.dumps(items or [], ensure_ascii=False)
        row = self.db.get(UserDashboard, user_id)
        now = datetime.now()
        if row:
            row.data_json = payload
            row.updated_at = now
        else:
            row = UserDashboard(user_id=user_id, data_json=payload, updated_at=now)
            self.db.add(row)
        self.db.commit()
        return now


class DossierService:
    """持仓纪律/投资底稿的整体 JSON blob 存取。"""

    def __init__(self, db: Session):
        self.db = db

    def get(self, user_id: int) -> Tuple[Optional[dict], Optional[datetime]]:
        row = self.db.get(UserDossier, user_id)
        if not row:
            return None, None
        try:
            data = json.loads(row.data_json) if row.data_json else None
            if not isinstance(data, dict):
                data = None
        except Exception:  # noqa: BLE001
            data = None
        return data, row.updated_at

    def save(self, user_id: int, data: dict) -> datetime:
        payload = json.dumps(data or {}, ensure_ascii=False)
        row = self.db.get(UserDossier, user_id)
        now = datetime.now()
        if row:
            row.data_json = payload
            row.updated_at = now
        else:
            row = UserDossier(user_id=user_id, data_json=payload, updated_at=now)
            self.db.add(row)
        self.db.commit()
        return now
