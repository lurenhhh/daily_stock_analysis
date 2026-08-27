# -*- coding: utf-8 -*-
"""L2-lite 多用户账号接口：注册 / 登录 / 注销 / me / 看板同步。

独立于现有单管理员 src.auth（不同 cookie、不同签名密钥、不同路径前缀 /account）。
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.deps import get_db
from src.auth import check_rate_limit, clear_rate_limit, get_client_ip, record_login_failure
from src.services.account_service import DashboardService, DossierService, UserService
from src.storage import User
from src.user_auth import (
    SESSION_MAX_AGE_DAYS,
    USER_COOKIE_NAME,
    create_user_session,
    validate_password,
    verify_user_session,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class RegisterReq(BaseModel):
    email: str = Field(..., description="邮箱")
    password: str = Field(..., description="密码")
    nickname: Optional[str] = Field(default=None, description="昵称（可空）")


class LoginReq(BaseModel):
    email: str = Field(..., description="邮箱")
    password: str = Field(..., description="密码")


class DashboardPutReq(BaseModel):
    items: List[Any] = Field(default_factory=list, description="DashboardItem[] 原样")


class DossierPutReq(BaseModel):
    data: Dict[str, Any] = Field(default_factory=dict, description="持仓底稿整体 JSON")


def _secure_cookie(request: Request) -> bool:
    if os.getenv("TRUST_X_FORWARDED_FOR", "false").lower() == "true":
        return request.headers.get("X-Forwarded-Proto", "").lower() == "https"
    return request.url.scheme == "https"


def _set_session_cookie(response: Response, request: Request, user_id: int) -> None:
    response.set_cookie(
        USER_COOKIE_NAME,
        create_user_session(user_id),
        max_age=SESSION_MAX_AGE_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=_secure_cookie(request),
        path="/",
    )


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(USER_COOKIE_NAME)
    uid = verify_user_session(token) if token else None
    if not uid:
        raise HTTPException(status_code=401, detail="未登录")
    user = UserService(db).get_by_id(uid)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    return user


def _user_out(u: User) -> dict:
    return {"id": str(u.id), "email": u.email, "nickname": u.nickname}


@router.post("/register", summary="邮箱+密码注册（成功即登录）")
def register(body: RegisterReq, request: Request, response: Response, db: Session = Depends(get_db)):
    err = validate_password(body.password)
    if err:
        raise HTTPException(status_code=422, detail=err)
    user, err = UserService(db).register(body.email, body.password, body.nickname)
    if err or user is None:
        raise HTTPException(status_code=409, detail=err or "注册失败")
    _set_session_cookie(response, request, user.id)
    return {"user": _user_out(user)}


@router.post("/login", summary="邮箱+密码登录")
def login(body: LoginReq, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = get_client_ip(request)
    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="尝试过于频繁，请稍后再试")
    user = UserService(db).authenticate(body.email, body.password)
    if not user:
        record_login_failure(ip)
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    clear_rate_limit(ip)
    _set_session_cookie(response, request, user.id)
    return {"user": _user_out(user)}


@router.post("/logout", summary="注销")
def logout(response: Response):
    response.delete_cookie(USER_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", summary="当前登录用户")
def me(user: User = Depends(get_current_user)):
    return {"user": _user_out(user)}


@router.get("/dashboard", summary="拉取当前用户看板 JSON")
def get_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items, updated = DashboardService(db).get(user.id)
    return {"items": items, "updatedAt": updated.isoformat() if updated else None}


@router.put("/dashboard", summary="覆盖保存看板 JSON（last-write-wins）")
def put_dashboard(
    body: DashboardPutReq,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updated = DashboardService(db).save(user.id, body.items)
    return {"ok": True, "updatedAt": updated.isoformat()}


@router.get("/dossier", summary="拉取当前用户的持仓底稿 JSON")
def get_dossier(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    data, updated = DossierService(db).get(user.id)
    return {"data": data, "updatedAt": updated.isoformat() if updated else None}


@router.put("/dossier", summary="覆盖保存持仓底稿 JSON（last-write-wins）")
def put_dossier(
    body: DossierPutReq,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updated = DossierService(db).save(user.id, body.data)
    return {"ok": True, "updatedAt": updated.isoformat()}
