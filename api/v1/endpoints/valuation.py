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
    DcfReferenceResponse,
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


def _fetch_dividend_yield(code: str) -> List[Tuple[str, float]]:
    """A 股年度股息率(%) = 当年每股现金分红 / 当年年末收盘价 × 100。

    - 每股现金分红：新浪分红明细「派息」为每 10 股派息(元)，按除权除息日所在年份累加后 / 10。
    - 年末收盘价：东财月线不复权收盘，取每年最后一条。
    """
    import akshare as ak

    symbol = "".join(ch for ch in normalize_stock_code(code) if ch.isdigit())[:6]
    if not symbol:
        return []

    # 1) 每股现金分红（按年）
    dps_by_year: Dict[str, float] = {}
    div_df = ak.stock_history_dividend_detail(symbol=symbol, indicator="分红")
    if div_df is not None and not getattr(div_df, "empty", True):
        for row in div_df.to_dict(orient="records"):
            try:
                pay = float(row.get("派息"))
            except (TypeError, ValueError):
                continue
            if not pay or pay <= 0 or math.isnan(pay):
                continue
            ex_str = str(row.get("除权除息日"))
            if len(ex_str) < 4 or not ex_str[:4].isdigit():
                continue
            year = ex_str[:4]
            dps_by_year[year] = dps_by_year.get(year, 0.0) + pay / 10.0

    if not dps_by_year:
        return []

    # 2) 年末收盘价（新浪日线不复权，每年最后一个交易日）
    #    注：改用新浪而非东财，避免部分网络/代理环境无法访问东财行情域名。
    if symbol[0] in ("6", "9"):
        sina_symbol = f"sh{symbol}"
    elif symbol.startswith(("4", "8")) or symbol.startswith("92"):
        sina_symbol = f"bj{symbol}"
    else:
        sina_symbol = f"sz{symbol}"

    yearend_close: Dict[str, float] = {}
    hist = ak.stock_zh_a_daily(
        symbol=sina_symbol, start_date="20000101", end_date="20261231", adjust=""
    )
    if hist is not None and not getattr(hist, "empty", True):
        date_col = "date" if "date" in hist.columns else hist.columns[0]
        close_col = "close" if "close" in hist.columns else "收盘"
        for row in hist.to_dict(orient="records"):
            date_str = str(row.get(date_col))
            if len(date_str) < 4 or not date_str[:4].isdigit():
                continue
            try:
                close = float(row.get(close_col))
            except (TypeError, ValueError):
                continue
            if close > 0:
                yearend_close[date_str[:4]] = close  # 升序遍历，最后写入即年末

    out: List[Tuple[str, float]] = []
    for year, dps in dps_by_year.items():
        close = yearend_close.get(year)
        if close and close > 0:
            out.append((year, round(dps / close * 100.0, 2)))
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
        try:
            dividend = _fetch_dividend_yield(code)
            if dividend:
                metrics["dividend_yield"] = dividend
        except Exception as exc:  # noqa: BLE001 - 尽力支持
            logger.warning("[Valuation] dividend yield failed for %s: %s", code, exc)

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


# ============================================================================
# DCF（现金流折现）估值：按选中公司给出参考值（当前市值、FCF、增长率等）
# 计算本身在前端进行，这里只提供「合理参考值」。
# ============================================================================


def _sina_symbol(code: str) -> str:
    """A 股 6 位代码转新浪代码，如 600519 -> sh600519。"""
    digits = "".join(ch for ch in normalize_stock_code(code) if ch.isdigit())[:6]
    if not digits:
        return ""
    if digits[0] in ("6", "9"):
        return f"sh{digits}"
    if digits.startswith(("4", "8")) or digits.startswith("92"):
        return f"bj{digits}"
    return f"sz{digits}"


def _latest_market_cap_yi(market: str, code: str) -> Optional[float]:
    """当前总市值（亿，本币），来自百度估值最新值。"""
    series = _fetch_baidu(market, code, "总市值")
    if not series:
        return None
    factor = _amount_to_yi_factor([v for _, v in series]) or 1.0
    return round(series[-1][1] / factor, 2)


def _latest_price_sina(code: str) -> Optional[float]:
    """当前股价（本币/股）：新浪日线最近一个交易日不复权收盘。"""
    import akshare as ak

    sina = _sina_symbol(code)
    if not sina:
        return None
    df = ak.stock_zh_a_daily(symbol=sina, start_date="20230101", end_date="20261231", adjust="")
    if df is None or getattr(df, "empty", True):
        return None
    columns = list(df.columns)
    date_col = "date" if "date" in columns else columns[0]
    close_col = "close" if "close" in columns else "收盘"
    last: Optional[float] = None
    for row in df.to_dict(orient="records"):
        _ = row.get(date_col)
        try:
            close = float(row.get(close_col))
        except (TypeError, ValueError):
            continue
        if close > 0:
            last = close
    return round(last, 2) if last else None


def _revenue_cagr_pct(code: str) -> Optional[float]:
    """历史营收 CAGR（%），取最近至多 5 个年度，钳制到 [0, 30]。"""
    revenue = _fetch_revenue_cn(code)  # [(date, year, 亿)]
    points = [(y, v) for _, y, v in revenue if v and v > 0]
    if len(points) < 2:
        return None
    points.sort(key=lambda item: item[0])
    window = points[-6:] if len(points) > 6 else points
    first = window[0][1]
    last = window[-1][1]
    span = len(window) - 1
    if first <= 0 or span <= 0:
        return None
    cagr = (last / first) ** (1.0 / span) - 1.0
    pct = round(cagr * 100.0, 1)
    return max(0.0, min(30.0, pct))


def _fcf_scenarios_sina(code: str) -> Optional[Dict[str, float]]:
    """自由现金流三档情景（亿）：base=最近一年，bear=近年最小，bull=近年最大。

    FCF = 经营活动现金流量净额 - 购建长期资产支付的现金。
    数据源：新浪现金流量表（避开被部分网络拦截的东财域名）。
    """
    import akshare as ak

    sina = _sina_symbol(code)
    if not sina:
        return None
    df = ak.stock_financial_report_sina(stock=sina, symbol="现金流量表")
    if df is None or getattr(df, "empty", True):
        return None

    columns = [str(c) for c in df.columns]
    date_col = "报告日" if "报告日" in columns else columns[0]
    op_col = next((c for c in columns if "经营活动产生的现金流量净额" in c), None)
    capex_col = next((c for c in columns if "购建固定资产" in c), None)
    if op_col is None:
        return None

    by_year: Dict[int, float] = {}
    for row in df.to_dict(orient="records"):
        date_str = str(row.get(date_col))
        digits = "".join(ch for ch in date_str if ch.isdigit())
        if len(digits) < 8 or digits[4:8] != "1231":
            continue  # 只取年报
        year = int(digits[:4])
        try:
            operate = float(row.get(op_col))
        except (TypeError, ValueError):
            continue
        if math.isnan(operate):
            continue
        capex = 0.0
        if capex_col is not None:
            try:
                capex_val = float(row.get(capex_col))
                if not math.isnan(capex_val):
                    capex = capex_val
            except (TypeError, ValueError):
                capex = 0.0
        by_year[year] = operate - capex

    if not by_year:
        return None

    years_sorted = sorted(by_year)
    recent = years_sorted[-5:]
    vals = [by_year[y] for y in recent]
    base = by_year[years_sorted[-1]]
    low = min(vals)
    high = max(vals)
    if low == high:
        low, high = base * 0.8, base * 1.2

    factor = _amount_to_yi_factor([abs(v) for v in (low, base, high)]) or 1.0
    return {
        "bear": round(low / factor, 2),
        "base": round(base / factor, 2),
        "bull": round(high / factor, 2),
    }


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _validate_scenario(obj: Any, lo: float, hi: float, integer: bool = False) -> Optional[Dict[str, float]]:
    if not isinstance(obj, dict):
        return None
    out: Dict[str, float] = {}
    for key in ("bear", "base", "bull"):
        try:
            num = float(obj.get(key))
        except (TypeError, ValueError):
            return None
        if math.isnan(num) or math.isinf(num):
            return None
        num = _clamp(num, lo, hi)
        out[key] = round(num) if integer else round(num, 2)
    return out


def _latest_metric_value(metrics: Dict[str, List[Tuple[str, float]]], key: str) -> Optional[float]:
    series = metrics.get(key)
    if not series:
        return None
    return series[-1][1]


def _llm_dcf_scenarios(name: str, code: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """调用配置的 LLM，基于公司财务数据给出 DCF 三档参数与依据。失败返回 None。"""
    try:
        from src.analyzer import get_analyzer
    except Exception:  # noqa: BLE001
        return None

    analyzer = get_analyzer()
    try:
        if not analyzer.is_available():
            return None
    except Exception:  # noqa: BLE001
        return None

    def _fmt(v: Any) -> str:
        return "未知" if v is None else str(v)

    fcf = data.get("fcf") or {}
    prompt = (
        "你是资深证券分析师。请基于以下 A 股公司的历史财务数据，为「两阶段自由现金流折现(DCF)」估值"
        "给出悲观/中等/乐观三档参数建议，并用一句话说明依据。\n\n"
        f"公司：{name}（{code}）\n"
        f"最近一年自由现金流：{_fmt(fcf.get('base'))} 亿元"
        f"（近5年区间 {_fmt(fcf.get('bear'))}~{_fmt(fcf.get('bull'))} 亿元）\n"
        f"近5年营收CAGR：{_fmt(data.get('cagr'))}%\n"
        f"最新毛利率：{_fmt(data.get('gross_margin'))}%，ROE：{_fmt(data.get('roe'))}%，"
        f"资产负债率：{_fmt(data.get('debt_ratio'))}%\n"
        f"当前总市值：{_fmt(data.get('market_cap'))} 亿元\n\n"
        "只输出严格 JSON（不要任何多余文字或解释），结构与单位如下：\n"
        "{\n"
        '  "fcf": {"bear": 数, "base": 数, "bull": 数},        // 基准自由现金流，单位：亿元\n'
        '  "discount": {"bear": 数, "base": 数, "bull": 数},   // 折现率(%)，悲观应更高\n'
        '  "growth": {"bear": 数, "base": 数, "bull": 数},     // 前 N 年每年增长率(%)\n'
        '  "years": {"bear": 整数, "base": 整数, "bull": 整数},// 高速增长年数\n'
        '  "perpetual": {"bear": 数, "base": 数, "bull": 数},  // 永续增长率(%)\n'
        '  "rationale": "一句话依据（40字以内）"\n'
        "}\n"
        "约束：discount 在 6~12；growth 在 -5~40；years 在 3~15；perpetual 在 0~4。"
        "三档需满足 悲观<中等<乐观（folding 折现率相反：悲观折现率最高）。"
    )

    # 部分模型（如带思考的 deepseek-v4-flash）在 max_tokens 偏小时会把额度
    # 耗在推理上、正文为空；这里放宽额度并做一次重试以应对空返回/网关抖动。
    text: Optional[str] = None
    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            text = analyzer.generate_text(prompt, max_tokens=1500, temperature=0.3)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            text = None
            logger.warning(
                "[Valuation] dcf llm call failed for %s (attempt %d/2): %s",
                code, attempt + 1, exc,
            )
        if text and text.strip():
            break
    if not text or not text.strip():
        logger.warning("[Valuation] dcf llm empty after retries for %s: %s", code, last_exc)
        return None

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned[:4].lower() == "json":
            cleaned = cleaned[4:]

    parsed: Any = None
    try:
        import json_repair

        parsed = json_repair.loads(cleaned)
    except Exception:  # noqa: BLE001
        try:
            import json

            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start >= 0 and end > start:
                parsed = json.loads(cleaned[start : end + 1])
        except Exception:  # noqa: BLE001
            parsed = None
    if not isinstance(parsed, dict):
        logger.warning("[Valuation] dcf llm non-dict result for %s; head=%s", code, cleaned[:160])
        return None

    result: Dict[str, Any] = {}
    fcf_sc = _validate_scenario(parsed.get("fcf"), -1e6, 1e6)
    if fcf_sc:
        result["fcf"] = fcf_sc
    discount_sc = _validate_scenario(parsed.get("discount"), 6.0, 12.0)
    if discount_sc:
        result["discount"] = discount_sc
    growth_sc = _validate_scenario(parsed.get("growth"), -5.0, 40.0)
    if growth_sc:
        result["growth"] = growth_sc
    years_sc = _validate_scenario(parsed.get("years"), 3.0, 15.0, integer=True)
    if years_sc:
        result["years"] = years_sc
    perpetual_sc = _validate_scenario(parsed.get("perpetual"), 0.0, 4.0)
    if perpetual_sc:
        result["perpetual"] = perpetual_sc

    rationale = parsed.get("rationale")
    result["rationale"] = str(rationale).strip()[:120] if rationale else None

    # 至少要有一个核心参数才算成功（部分成功也用）
    if not any(k in result for k in ("discount", "growth", "years", "perpetual")):
        logger.warning("[Valuation] dcf llm produced no usable fields for %s; head=%s", code, cleaned[:160])
        return None

    logger.info("[Valuation] dcf llm ok for %s: fields=%s", code, [k for k in result if k != "rationale"])
    return result


def _load_dcf_reference(market: str, code: str, use_llm: bool = False) -> Dict[str, Any]:
    """带缓存地加载 DCF 参考值。

    use_llm=False：仅按历史数据推算（快，默认，页面搜索时用）。
    use_llm=True：在数据推算基础上再调用 LLM 给三档参数（慢，点按钮时用）。
    两种结果分开缓存。
    """
    cache_key = f"dcfref:{'llm' if use_llm else 'base'}:{market}:{normalize_stock_code(code).upper()}"
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]["ref"]

    market_cap = None
    price = None
    fcf_scn: Optional[Dict[str, float]] = None
    cagr: Optional[float] = None
    gross_margin = roe = debt_ratio = None

    try:
        market_cap = _latest_market_cap_yi(market, code)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Valuation] dcf market_cap failed for %s: %s", code, exc)

    if market == "cn":
        try:
            price = _latest_price_sina(code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Valuation] dcf price failed for %s: %s", code, exc)
        try:
            fcf_scn = _fcf_scenarios_sina(code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Valuation] dcf fcf ref failed for %s: %s", code, exc)
        try:
            cagr = _revenue_cagr_pct(code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Valuation] dcf cagr failed for %s: %s", code, exc)
        # 毛利率/ROE/负债率仅供 LLM prompt 使用，非 LLM 时跳过以加快
        if use_llm:
            try:
                metrics = _load_metrics(market, code)
                gross_margin = _latest_metric_value(metrics, "gross_margin")
                roe = _latest_metric_value(metrics, "roe")
                debt_ratio = _latest_metric_value(metrics, "debt_ratio")
            except Exception as exc:  # noqa: BLE001
                logger.warning("[Valuation] dcf metrics failed for %s: %s", code, exc)

    # ---- 数据推算的兜底三档 ----
    heuristic: Dict[str, Any] = {
        "fcf": fcf_scn,
        "discount": {"bear": 10.0, "base": 8.0, "bull": 7.0},
        "growth": None,
        "years": {"bear": 3.0, "base": 5.0, "bull": 10.0},
        "perpetual": {"bear": 2.0, "base": 3.0, "bull": 4.0},
    }
    if cagr is not None:
        heuristic["growth"] = {
            "bear": round(max(0.0, cagr * 0.5), 1),
            "base": round(cagr, 1),
            "bull": round(min(30.0, cagr * 1.5), 1),
        }

    # ---- LLM 推理（仅在 use_llm 且 A 股时）----
    if use_llm and market == "cn":
        # AI 版：只返回 LLM 真正推理出来的字段，其余保持 None，
        # 前端对应指标就不显示 AI 行（“没推理出来就不给值”）。
        ref: Dict[str, Any] = {
            "market_cap": market_cap,
            "price": price,
            "source": "heuristic",
            "rationale": None,
            "fcf": None,
            "discount": None,
            "growth": None,
            "years": None,
            "perpetual": None,
        }
        llm = None
        try:
            llm = _llm_dcf_scenarios(
                name=code,
                code=code,
                data={
                    "fcf": fcf_scn,
                    "cagr": cagr,
                    "gross_margin": gross_margin,
                    "roe": roe,
                    "debt_ratio": debt_ratio,
                    "market_cap": market_cap,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Valuation] dcf llm scenarios failed for %s: %s", code, exc)
        if llm:
            ref["source"] = "llm"
            ref["rationale"] = llm.get("rationale")
            for key in ("fcf", "discount", "growth", "years", "perpetual"):
                if llm.get(key):
                    ref[key] = llm[key]
    else:
        # 历史版：按数据推算给出全部字段（历史行始终完整）。
        ref = {
            "market_cap": market_cap,
            "price": price,
            "source": "heuristic",
            "rationale": None,
            **heuristic,
        }

    with _CACHE_LOCK:
        _CACHE[cache_key] = (now, {"ref": ref})
    return ref


@router.get(
    "/dcf-reference",
    response_model=DcfReferenceResponse,
    summary="DCF 估值的按公司参考值（当前市值 / FCF / 增长率 等）",
)
def get_dcf_reference(
    code: str = Query(..., description="股票代码或名称对应的代码"),
    use_llm: bool = Query(False, description="是否用 LLM 推理三档参数（默认 False，仅历史推算）"),
) -> DcfReferenceResponse:
    raw_code = (code or "").strip()
    if not raw_code:
        raise HTTPException(status_code=422, detail="请提供股票代码")

    normalized = normalize_stock_code(raw_code)
    market = _market_tag(normalized)
    currency = _CURRENCY_BY_MARKET.get(market, "")

    try:
        ref = _load_dcf_reference(market, raw_code, use_llm=use_llm)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Valuation] dcf reference failed for %s: %s", raw_code, exc)
        raise HTTPException(status_code=502, detail="获取 DCF 参考值失败，请稍后重试") from exc

    market_cap = ref.get("market_cap")
    message = None
    if market_cap is None:
        message = "暂无法获取该股票当前市值，DCF 结论对比可能不可用"

    return DcfReferenceResponse(
        code=normalized,
        display_code=raw_code,
        market=market,
        supported=market_cap is not None,
        currency=currency,
        market_cap=market_cap,
        price=ref.get("price"),
        fcf=ref.get("fcf"),
        discount=ref["discount"],
        growth=ref.get("growth"),
        years=ref["years"],
        perpetual=ref["perpetual"],
        source=ref.get("source", "heuristic"),
        rationale=ref.get("rationale"),
        message=message,
    )
