# -*- coding: utf-8 -*-
"""个股体检卡 - 事件日历接口（未来大事，匿名可用）。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from api.v1.schemas.checkup import CheckupEventsResponse, EventItem
from data_provider.base import normalize_stock_code
from src.services.checkup_service import CheckupService

logger = logging.getLogger(__name__)

router = APIRouter()
_service = CheckupService()


@router.get(
    "/events",
    response_model=CheckupEventsResponse,
    summary="个股未来大事（限售解禁 / 除权除息）",
)
def get_events(
    code: str = Query(..., description="股票代码或名称对应的代码"),
    refresh: bool = Query(False, description="绕过缓存强制刷新"),
) -> CheckupEventsResponse:
    raw_code = (code or "").strip()
    if not raw_code:
        raise HTTPException(status_code=422, detail="请提供股票代码")

    normalized = normalize_stock_code(raw_code)
    try:
        result = _service.get_events(raw_code, refresh=refresh)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Checkup] events endpoint failed for %s: %s", raw_code, exc)
        raise HTTPException(status_code=502, detail="获取未来大事失败，请稍后重试") from exc

    return CheckupEventsResponse(
        code=normalized,
        display_code=raw_code,
        market=result.get("market", ""),
        supported=bool(result.get("supported")),
        message=result.get("message"),
        events=[EventItem(**e) for e in result.get("events", [])],
    )
