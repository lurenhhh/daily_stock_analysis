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

from api.v1.schemas.valuation import (
    FundamentalsResponse,
    MetricsResponse,
    PeHistoryResponse,
)
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


def _fetch_baidu(market: str, code: str, indicator: str) -> List[Tuple[str, float]]:
    """通过百度股市通历史估值接口获取（日期, 数值）序列（按指标）。"""
    import akshare as ak

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
        value = _finite_positive(row.get(val_col))
        raw_date = row.get(date_col)
        if value is None or raw_date is None:
            continue
        out.append((str(raw_date)[:10], value))
    return out


def _fetch_series(market: str, code: str, metric: str) -> List[Tuple[str, float]]:
    """历史 PE 序列（按估值指标）。"""
    indicator = _INDICATOR_BY_METRIC.get(metric, "市盈率(TTM)")
    return _fetch_baidu(market, code, indicator)


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


# ============================================================================
# 基本面：总营收（年度柱）+ 总市值（日频线）
# ============================================================================

_CURRENCY_BY_MARKET = {"cn": "CNY", "hk": "HKD", "us": "USD"}


def _amount_to_yi_factor(values: List[float]) -> float:
    """推断原始金额单位并返回换算到「亿」的除数。

    数据源可能返回「元」（数值很大）或已是「亿」（数值较小）。
    以中位数量级判断：>= 1e6 视为「元」→ 除以 1e8；否则视为已是「亿」。
    """
    vals = sorted(v for v in values if v and v > 0)
    if not vals:
        return 1.0
    median = vals[len(vals) // 2]
    return 1e8 if median >= 1e6 else 1.0


def _parse_cn_amount(raw: Any) -> Optional[float]:
    """解析同花顺带单位的金额字符串，统一换算为「亿」。"""
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").replace("，", "")
    if not s or s in ("--", "-", "None", "nan", "NaN"):
        return None
    mult = 1.0 / 1e8  # 默认按「元」处理
    if s.endswith("万亿"):
        mult, s = 1e4, s[:-2]
    elif s.endswith("亿"):
        mult, s = 1.0, s[:-1]
    elif s.endswith("万"):
        mult, s = 1e-4, s[:-1]
    try:
        return float(s) * mult
    except (TypeError, ValueError):
        return None


def _pick_num(row: Any, keys: List[str]) -> Optional[float]:
    for key in keys:
        if key in row and row.get(key) not in (None, "", "--"):
            try:
                num = float(row.get(key))
            except (TypeError, ValueError):
                continue
            if not (math.isnan(num) or math.isinf(num)):
                return num
    return None


def _fetch_revenue_cn(code: str) -> List[Tuple[str, str, float]]:
    """A 股年度总营收（同花顺按年度）。返回 [(date, year, 亿)]。"""
    import akshare as ak

    symbol = "".join(ch for ch in normalize_stock_code(code) if ch.isdigit())[:6]
    if not symbol:
        return []
    df = ak.stock_financial_abstract_ths(symbol=symbol, indicator="按年度")
    if df is None or getattr(df, "empty", True):
        return []

    columns = [str(c) for c in df.columns]
    rev_col = None
    for keyword in ("营业总收入", "营业收入", "营收"):
        for col in columns:
            if keyword in col:
                rev_col = col
                break
        if rev_col:
            break
    if rev_col is None:
        return []
    period_col = "报告期" if "报告期" in columns else columns[0]

    out: List[Tuple[str, str, float]] = []
    for _, row in df.iterrows():
        year = str(row.get(period_col))[:4]
        value = _parse_cn_amount(row.get(rev_col))
        if value is None or not year.isdigit():
            continue
        out.append((f"{year}-12-31", year, value))
    out.sort(key=lambda item: item[1])
    return out


def _fetch_revenue_em(market: str, code: str) -> List[Tuple[str, str, float]]:
    """港股 / 美股年度总营收（东方财富）。返回 [(date, year, 亿)]。"""
    import akshare as ak

    normalized = normalize_stock_code(code)
    if market == "hk":
        symbol = "".join(ch for ch in normalized if ch.isdigit()).zfill(5)
        df = ak.stock_financial_hk_analysis_indicator_em(symbol=symbol, indicator="年度")
        date_keys = ["STD_REPORT_DATE", "REPORT_DATE"]
        rev_keys = ["OPERATE_INCOME", "OPERATE_INCOME_RMB", "TOTAL_OPERATE_INCOME", "OPERATE_INCOME_TTM"]
    elif market == "us":
        symbol = normalized.upper()
        df = ak.stock_financial_us_analysis_indicator_em(symbol=symbol, indicator="年报")
        date_keys = ["REPORT_DATE", "STD_REPORT_DATE"]
        rev_keys = ["TOTAL_INCOME", "OPERATE_INCOME", "OPERATE_INCOME_TTM"]
    else:
        return []

    if df is None or getattr(df, "empty", True):
        return []

    records = df.to_dict(orient="records")
    date_key = next((k for k in date_keys if k in df.columns), None)
    if date_key is None:
        return []

    raw: List[Tuple[str, str, float]] = []
    for row in records:
        num = _pick_num(row, rev_keys)
        date_val = row.get(date_key)
        if num is None or date_val is None:
            continue
        date_str = str(date_val)[:10]
        year = date_str[:4]
        if not year.isdigit():
            continue
        raw.append((f"{year}-12-31", year, num))

    factor = _amount_to_yi_factor([v for _, _, v in raw])
    out = [(d, y, v / factor) for d, y, v in raw]
    out.sort(key=lambda item: item[1])
    return out


def _fetch_revenue(market: str, code: str) -> List[Tuple[str, str, float]]:
    try:
        if market == "cn":
            return _fetch_revenue_cn(code)
        if market in ("hk", "us"):
            return _fetch_revenue_em(market, code)
    except Exception as exc:  # noqa: BLE001 - 营收为尽力支持，失败不阻断市值展示
        logger.warning("[Valuation] revenue fetch failed for %s (%s): %s", code, market, exc)
    return []


def _load_fundamentals(
    market: str, code: str
) -> Tuple[List[Tuple[str, float]], List[Tuple[str, str, float]]]:
    """带缓存地加载（总市值原始序列, 年度营收序列）。"""
    cache_key = f"fund:{market}:{normalize_stock_code(code).upper()}"
    now = time.time()

    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            data = cached[1]
            return data["cap"], data["rev"]

    cap = _fetch_baidu(market, code, "总市值")  # 市值失败会抛出 -> 由上层转 502
    rev = _fetch_revenue(market, code)  # 营收失败内部吞掉，返回 []

    with _CACHE_LOCK:
        _CACHE[cache_key] = (now, {"cap": cap, "rev": rev})
    return cap, rev


@router.get(
    "/fundamentals",
    response_model=FundamentalsResponse,
    summary="总营收（年度柱）+ 总市值（日频线）组合数据",
)
def get_fundamentals(
    code: str = Query(..., description="股票代码或名称对应的代码"),
    years: int = Query(20, ge=1, le=30, description="回溯年数，默认 20 年"),
) -> FundamentalsResponse:
    raw_code = (code or "").strip()
    if not raw_code:
        raise HTTPException(status_code=422, detail="请提供股票代码")

    normalized = normalize_stock_code(raw_code)
    market = _market_tag(normalized)
    currency = _CURRENCY_BY_MARKET.get(market, "")

    if market not in _SUPPORTED_MARKETS:
        return FundamentalsResponse(
            code=normalized,
            display_code=raw_code,
            market=market,
            supported=False,
            currency=currency,
            unit="亿",
            message="该市场暂无可用的基本面数据源",
            market_cap=[],
            revenue=[],
        )

    try:
        cap_raw, rev_raw = _load_fundamentals(market, raw_code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Valuation] fundamentals fetch failed for %s: %s", raw_code, exc)
        raise HTTPException(
            status_code=502,
            detail="获取基本面数据失败，请稍后重试",
        ) from exc

    cap_recent = _filter_recent_years(cap_raw, years)
    factor = _amount_to_yi_factor([v for _, v in cap_recent])
    cap_sampled = _downsample(cap_recent, _MAX_POINTS)
    market_cap = [{"date": d, "value": round(v / factor, 2)} for d, v in cap_sampled]

    # 营收按同一时间窗过滤
    ref_year: Optional[int] = None
    if cap_recent:
        ref_year = int(cap_recent[-1][0][:4])
    elif rev_raw:
        ref_year = max(int(y) for _, y, _ in rev_raw)
    cutoff = ref_year - years + 1 if ref_year is not None else None
    revenue = [
        {"date": d, "year": y, "value": round(v, 2)}
        for d, y, v in rev_raw
        if cutoff is None or int(y) >= cutoff
    ]

    supported = True
    message = None if (market_cap or revenue) else "该股票暂无可用的市值/营收数据"

    return FundamentalsResponse(
        code=normalized,
        display_code=raw_code,
        market=market,
        supported=supported,
        currency=currency,
        unit="亿",
        message=message,
        market_cap=market_cap,
        revenue=revenue,
    )


# ============================================================================
# 扩展财务指标：毛利率 / 资产负债率 / 股息率 / ROE（折线）
#              扣非净利润 / 自由现金流（柱状）——每个指标一条年度序列
# 说明：目前仅 A 股（数据源为同花顺主要指标 + 东财现金流量表）。
# ============================================================================

# 指标 -> (图形 kind, 单位)
_METRIC_META = {
    "gross_margin": ("line", "%"),
    "debt_ratio": ("line", "%"),
    "dividend_yield": ("line", "%"),
    "roe": ("line", "%"),
    "deducted_net_profit": ("bar", "亿"),
    "free_cash_flow": ("bar", "亿"),
}


def _parse_ratio(raw: Any) -> Optional[float]:
    """解析百分比/比率字符串为数值（保留正负号，去掉 % 号）。"""
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").replace("，", "").replace("%", "")
    if not s or s in ("--", "-", "None", "nan", "NaN"):
        return None
    try:
        num = float(s)
    except (TypeError, ValueError):
        return None
    if math.isnan(num) or math.isinf(num):
        return None
    return round(num, 2)


def _em_prefixed_symbol(code: str) -> str:
    """A 股 6 位代码转东财带市场前缀形式，如 600519 -> SH600519。"""
    digits = "".join(ch for ch in normalize_stock_code(code) if ch.isdigit())[:6]
    if not digits:
        return ""
    if digits[0] in "69" or digits.startswith("5"):
        market = "SH"
    elif digits.startswith(("4", "8")) or digits.startswith("92"):
        market = "BJ"
    else:
        market = "SZ"
    return f"{market}{digits}"


def _find_column(columns: List[str], keywords: List[str], exclude: Tuple[str, ...] = ()) -> Optional[str]:
    for col in columns:
        if any(k in col for k in keywords) and not any(e in col for e in exclude):
            return col
    return None


def _extract_ths_metrics(df: Any) -> Dict[str, List[Tuple[str, float]]]:
    """从同花顺「按年度主要指标」df 中提取指标年度序列。"""
    columns = [str(c) for c in df.columns]
    period_col = "报告期" if "报告期" in columns else columns[0]

    gross = _find_column(columns, ["销售毛利率", "毛利率"])
    debt = _find_column(columns, ["资产负债率"])
    roe = _find_column(columns, ["净资产收益率"], exclude=("摊薄",)) or _find_column(columns, ["净资产收益率"])
    dividend = _find_column(columns, ["股息率", "股息"])
    deducted = _find_column(columns, ["扣非"], exclude=("同比", "增长"))

    plan = [
        ("gross_margin", gross, "ratio"),
        ("debt_ratio", debt, "ratio"),
        ("dividend_yield", dividend, "ratio"),
        ("roe", roe, "ratio"),
        ("deducted_net_profit", deducted, "amount"),
    ]

    result: Dict[str, List[Tuple[str, float]]] = {}
    for key, col, kind in plan:
        if not col:
            continue
        points: List[Tuple[str, float]] = []
        for _, row in df.iterrows():
            year = str(row.get(period_col))[:4]
            if not year.isdigit():
                continue
            value = _parse_ratio(row.get(col)) if kind == "ratio" else _parse_cn_amount(row.get(col))
            if value is None:
                continue
            points.append((year, round(value, 2)))
        points.sort(key=lambda item: item[0])
        if points:
            result[key] = points
    return result


def _fetch_free_cash_flow(code: str) -> List[Tuple[str, float]]:
    """自由现金流 = 经营活动现金流量净额 - 资本开支（东财现金流量表-按年度）。"""
    import akshare as ak

    symbol = _em_prefixed_symbol(code)
    if not symbol:
        return []
    df = ak.stock_cash_flow_sheet_by_yearly_em(symbol=symbol)
    if df is None or getattr(df, "empty", True):
        return []

    columns = list(df.columns)
    if "REPORT_DATE" not in columns:
        return []
    operate_keys = ["NETCASH_OPERATE"]
    capex_keys = [
        "CONSTRUCT_LONG_ASSET",  # 购建固定资产、无形资产和其他长期资产支付的现金
        "PAY_ACQUIRE_ASSET",
    ]
    operate_key = next((k for k in operate_keys if k in columns), None)
    capex_key = next((k for k in capex_keys if k in columns), None)
    if operate_key is None or capex_key is None:
        return []

    records = df.to_dict(orient="records")
    raw: List[Tuple[str, float]] = []
    for row in records:
        date_str = str(row.get("REPORT_DATE"))[:10]
        year = date_str[:4]
        if not year.isdigit() or not date_str.endswith("12-31"):
            continue
        try:
            operate = float(row.get(operate_key))
            capex = float(row.get(capex_key))
        except (TypeError, ValueError):
            continue
        if math.isnan(operate) or math.isnan(capex):
            continue
        raw.append((year, operate - capex))

    factor = _amount_to_yi_factor([abs(v) for _, v in raw]) or 1.0
    out = [(y, round(v / factor, 2)) for y, v in raw]
    out.sort(key=lambda item: item[0])
    return out


def _load_metrics(market: str, code: str) -> Dict[str, List[Tuple[str, float]]]:
    """带缓存地加载扩展财务指标（仅 A 股）。"""
    cache_key = f"metrics:{market}:{normalize_stock_code(code).upper()}"
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]["metrics"]

    metrics: Dict[str, List[Tuple[str, float]]] = {}
    if market == "cn":
        import akshare as ak

        symbol = "".join(ch for ch in normalize_stock_code(code) if ch.isdigit())[:6]
        try:
            df = ak.stock_financial_abstract_ths(symbol=symbol, indicator="按年度")
            metrics.update(_extract_ths_metrics(df))
        except Exception as exc:  # noqa: BLE001 - 尽力支持
            logger.warning("[Valuation] ths metrics failed for %s: %s", code, exc)
        try:
            fcf = _fetch_free_cash_flow(code)
            if fcf:
                metrics["free_cash_flow"] = fcf
        except Exception as exc:  # noqa: BLE001 - 尽力支持
            logger.warning("[Valuation] fcf failed for %s: %s", code, exc)

    with _CACHE_LOCK:
        _CACHE[cache_key] = (now, {"metrics": metrics})
    return metrics


@router.get(
    "/metrics",
    response_model=MetricsResponse,
    summary="扩展财务指标（毛利率/资产负债率/股息率/ROE/扣非净利润/自由现金流，年度）",
)
def get_metrics(
    code: str = Query(..., description="股票代码或名称对应的代码"),
    years: int = Query(20, ge=1, le=30, description="回溯年数，默认 20 年"),
) -> MetricsResponse:
    raw_code = (code or "").strip()
    if not raw_code:
        raise HTTPException(status_code=422, detail="请提供股票代码")

    normalized = normalize_stock_code(raw_code)
    market = _market_tag(normalized)
    currency = _CURRENCY_BY_MARKET.get(market, "")

    if market != "cn":
        return MetricsResponse(
            code=normalized,
            display_code=raw_code,
            market=market,
            supported=False,
            currency=currency,
            message="扩展财务指标目前仅支持 A 股",
            metrics={},
        )

    try:
        raw_metrics = _load_metrics(market, raw_code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Valuation] metrics fetch failed for %s: %s", raw_code, exc)
        raise HTTPException(status_code=502, detail="获取财务指标失败，请稍后重试") from exc

    latest_year = 0
    for series in raw_metrics.values():
        for year, _ in series:
            latest_year = max(latest_year, int(year))
    cutoff = latest_year - years + 1 if latest_year else 0

    metrics: Dict[str, Dict[str, Any]] = {}
    for key, (kind, unit) in _METRIC_META.items():
        series = raw_metrics.get(key)
        if not series:
            continue
        points = [
            {"year": year, "value": value}
            for year, value in series
            if not cutoff or int(year) >= cutoff
        ]
        if points:
            metrics[key] = {"kind": kind, "unit": unit, "points": points}

    message = None if metrics else "该股票暂无可用的扩展财务指标数据"
    return MetricsResponse(
        code=normalized,
        display_code=raw_code,
        market=market,
        supported=True,
        currency=currency,
        message=message,
        metrics=metrics,
    )
