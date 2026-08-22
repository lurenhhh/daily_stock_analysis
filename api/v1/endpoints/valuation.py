# -*- coding: utf-8 -*-
"""
===================================
历史 PE 估值 endpoint
===================================

提供个股近 N 年历史市盈率（PE）时间序列，并基于正态分布（均值 μ ± 标准差 σ）
给出「高估 / 平均 / 低估」三条参考线。

数据源（均来自百度股市通历史估值接口，period="全部" 取最长可得历史）：
- A 股：akshare ``stock_zh_valuation_baidu``
- 港股：akshare ``stock_hk_valuation_baidu``
- 美股：akshare ``stock_us_valuation_baidu``
- 日 / 韩 / 台等：暂无对应数据源，返回 supported=False，由前端友好提示。

设计要点：
- 统计量（均值、标准差、三条线）使用「全量、过滤后的日频序列」计算，保证准确；
  折线图数据在过大时做等间隔降采样，避免前端渲染压力。
- 过滤掉非正值与缺失的 PE（亏损期 PE 为负，无估值意义）。
- 简单的进程内 TTL 缓存，避免重复触发较慢的爬虫请求。
"""

from __future__ import annotations

import logging
import math
import statistics
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query

from api.v1.schemas.valuation import PeHistoryResponse
from data_provider.base import _market_tag, normalize_stock_code

logger = logging.getLogger(__name__)

router = APIRouter()

# 折线图最多返回的点数（统计量仍使用全量数据计算）。
_MAX_POINTS = 1500

# 进程内缓存：{cache_key: (timestamp, full_series)}，full_series 为过滤后的全量正值序列。
_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL_SECONDS = 6 * 3600
_CACHE_LOCK = threading.Lock()

_SUPPORTED_MARKETS = {"cn", "hk", "us"}
_VALID_METRICS = {"pe_ttm", "pe"}

# 估值指标 -> 百度股市通 indicator 名称
_INDICATOR_BY_METRIC = {
    "pe_ttm": "市盈率(TTM)",
    "pe": "市盈率(静)",
}


def _finite_positive(value: Any) -> Optional[float]:
    """转换为有限正浮点数，非法/非正返回 None。"""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(num) or math.isinf(num) or num <= 0:
        return None
    return num


def _baidu_symbol(market: str, code: str) -> str:
    """将规范化代码转换为百度股市通所需的 symbol 形式。"""
    normalized = normalize_stock_code(code)
    if market == "cn":
        return "".join(ch for ch in normalized if ch.isdigit())[:6]
    if market == "hk":
        return "".join(ch for ch in normalized if ch.isdigit()).zfill(5)
    if market == "us":
        return normalized.upper()
    return normalized


def _fetch_series(market: str, code: str, metric: str) -> List[Tuple[str, float]]:
    """通过百度股市通历史估值接口获取（日期, PE）序列。"""
    import akshare as ak

    indicator = _INDICATOR_BY_METRIC.get(metric, "市盈率(TTM)")
    symbol = _baidu_symbol(market, code)
    if not symbol:
        return []

    logger.info(
        "[Valuation] baidu valuation market=%s symbol=%s indicator=%s",
        market, symbol, indicator,
    )
    if market == "cn":
        df = ak.stock_zh_valuation_baidu(symbol=symbol, indicator=indicator, period="全部")
    elif market == "hk":
        df = ak.stock_hk_valuation_baidu(symbol=symbol, indicator=indicator, period="全部")
    elif market == "us":
        df = ak.stock_us_valuation_baidu(symbol=symbol, indicator=indicator, period="全部")
    else:
        return []

    if df is None or getattr(df, "empty", True):
        return []

    columns = list(df.columns)
    date_col = "date" if "date" in columns else columns[0]
    val_col = "value" if "value" in columns else columns[-1]

    out: List[Tuple[str, float]] = []
    for _, row in df.iterrows():
        pe = _finite_positive(row.get(val_col))
        raw_date = row.get(date_col)
        if pe is None or raw_date is None:
            continue
        out.append((str(raw_date)[:10], pe))
    return out


def _filter_recent_years(
    series: List[Tuple[str, float]], years: int
) -> List[Tuple[str, float]]:
    """按最新日期回溯 years 年过滤，并按日期升序排序。"""
    if not series:
        return []
    ordered = sorted(series, key=lambda item: item[0])
    if not years or years <= 0:
        return ordered

    last_date_str = ordered[-1][0]
    try:
        last_date = datetime.strptime(last_date_str, "%Y-%m-%d")
        cutoff = last_date.replace(year=last_date.year - years)
        cutoff_str = cutoff.strftime("%Y-%m-%d")
    except ValueError:
        return ordered

    return [item for item in ordered if item[0] >= cutoff_str]


def _downsample(series: List[Tuple[str, float]], max_points: int) -> List[Tuple[str, float]]:
    """等间隔降采样，始终保留最后一个点。"""
    if len(series) <= max_points:
        return series
    step = math.ceil(len(series) / max_points)
    sampled = series[::step]
    if sampled[-1] != series[-1]:
        sampled.append(series[-1])
    return sampled


def _build_stats(series: List[Tuple[str, float]]) -> Optional[Dict[str, Any]]:
    values = [pe for _, pe in series]
    if len(values) < 2:
        return None
    mean = statistics.mean(values)
    std = statistics.pstdev(values)
    overvalued = mean + std
    undervalued = mean - std
    current_date, current = series[-1]

    if current > overvalued:
        zone = "high"
    elif current < undervalued:
        zone = "low"
    else:
        zone = "fair"

    return {
        "count": len(values),
        "mean": round(mean, 2),
        "std": round(std, 2),
        "overvalued": round(overvalued, 2),
        "undervalued": round(undervalued, 2),
        "current": round(current, 2),
        "current_date": current_date,
        "min": round(min(values), 2),
        "max": round(max(values), 2),
        "zone": zone,
    }


def _load_full_series(market: str, code: str, metric: str) -> List[Tuple[str, float]]:
    """带缓存地加载「全量」正值序列。"""
    cache_key = f"{market}:{normalize_stock_code(code).upper()}:{metric}"
    now = time.time()

    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]["series"]

    series = _fetch_series(market, code, metric)

    with _CACHE_LOCK:
        _CACHE[cache_key] = (now, {"series": series})
    return series


@router.get(
    "/pe-history",
    response_model=PeHistoryResponse,
    summary="历史 PE 估值（含正态分布高估/平均/低估参考线）",
)
def get_pe_history(
    code: str = Query(..., description="股票代码或名称对应的代码，如 600519 / 00700.HK"),
    years: int = Query(20, ge=1, le=30, description="回溯年数，默认 20 年"),
    metric: str = Query("pe_ttm", description="估值指标：pe_ttm / pe"),
) -> PeHistoryResponse:
    raw_code = (code or "").strip()
    if not raw_code:
        raise HTTPException(status_code=422, detail="请提供股票代码")

    normalized = normalize_stock_code(raw_code)
    market = _market_tag(normalized)
    metric = metric if metric in _VALID_METRICS else "pe_ttm"

    if market not in _SUPPORTED_MARKETS:
        return PeHistoryResponse(
            code=normalized,
            display_code=raw_code,
            market=market,
            metric=metric,
            supported=False,
            message="该市场暂无可用的历史 PE 数据源",
            series=[],
            stats=None,
        )

    try:
        full_series = _load_full_series(market, raw_code, metric)
    except Exception as exc:  # noqa: BLE001 - 数据源不稳定，统一转为可重试错误
        logger.warning("[Valuation] fetch failed for %s: %s", raw_code, exc)
        raise HTTPException(
            status_code=502,
            detail="获取历史估值数据失败，请稍后重试",
        ) from exc

    recent = _filter_recent_years(full_series, years)
    stats = _build_stats(recent)

    if not recent or stats is None:
        return PeHistoryResponse(
            code=normalized,
            display_code=raw_code,
            market=market,
            metric=metric,
            supported=True,
            message="该股票历史 PE 多为负值或数据缺失，无法计算估值区间",
            series=[],
            stats=None,
        )

    sampled = _downsample(recent, _MAX_POINTS)
    series = [{"date": d, "pe": round(pe, 2)} for d, pe in sampled]

    return PeHistoryResponse(
        code=normalized,
        display_code=raw_code,
        market=market,
        metric=metric,
        supported=True,
        message=None,
        series=series,
        stats=stats,
    )
