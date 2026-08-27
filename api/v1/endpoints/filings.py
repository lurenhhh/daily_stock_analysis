# -*- coding: utf-8 -*-
"""原始财报查询接口：定期报告清单（匿名可用，跳官方源）。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from api.v1.schemas.filings import FilingItem, FilingsResponse
from data_provider.base import normalize_stock_code
from src.services.filings_service import FilingsService

logger = logging.getLogger(__name__)

router = APIRouter()
_service = FilingsService()


@router.get(
    "",
    response_model=FilingsResponse,
    summary="定期报告清单（A股：巨潮；港股待开放）",
)
def get_filings(
    code: str = Query(..., description="股票代码或名称对应的代码"),
    market: str = Query("", description="市场：ashare / hk（缺省按代码自动判定）"),
    type: str = Query("all", description="类型：all / annual / interim / q1 / q3"),
    year: str = Query("all", description="年份筛选：all / 2025 ..."),
    refresh: bool = Query(False, description="绕过缓存强制刷新"),
) -> FilingsResponse:
    raw_code = (code or "").strip()
    if not raw_code:
        raise HTTPException(status_code=422, detail="请提供股票代码")

    normalized = normalize_stock_code(raw_code)
    try:
        result = _service.get_filings(
            raw_code,
            market=(market or None),
            report_type=type,
            year=year,
            refresh=refresh,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Filings] endpoint failed for %s: %s", raw_code, exc)
        raise HTTPException(status_code=502, detail="获取财报清单失败，请稍后重试") from exc

    items = []
    for it in result.get("items", []):
        data = dict(it)
        data["display_code"] = raw_code
        items.append(FilingItem(**data))

    return FilingsResponse(
        code=normalized,
        display_code=raw_code,
        market=result.get("market", ""),
        supported=bool(result.get("supported")),
        message=result.get("message"),
        items=items,
    )
