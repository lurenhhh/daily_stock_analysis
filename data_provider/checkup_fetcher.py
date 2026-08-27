# -*- coding: utf-8 -*-
"""个股体检卡 - 未来大事抓取（客观日程）。

限售解禁：新浪财经（含未来解禁日期，per-stock，轻量）。
除权除息：巨潮资讯网 stock_dividend_cninfo（未来除权日/派息日）。
两者均为免费、可达源；东财相关（股东户数/回购）暂不纳入。
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Dict, List

logger = logging.getLogger(__name__)


def _digits6(code: str) -> str:
    return "".join(ch for ch in str(code) if ch.isdigit())[:6]


def _sina_symbol(code: str) -> str:
    d = _digits6(code)
    if len(d) < 6:
        return ""
    head = d[0]
    if head in ("6", "9"):
        return "sh" + d
    if head in ("0", "2", "3"):
        return "sz" + d
    if head in ("4", "8"):
        return "bj" + d
    return "sh" + d


def _to_date_str(value) -> str:
    if value is None:
        return ""
    try:
        if isinstance(value, str):
            return value[:10]
        return str(value)[:10]
    except Exception:  # noqa: BLE001
        return ""


def _fmt_yi(num: float) -> str:
    try:
        return f"{num / 1e8:.2f}"
    except Exception:  # noqa: BLE001
        return ""


def fetch_upcoming_events(code: str) -> List[Dict]:
    """A股未来大事：限售解禁 + 除权除息（仅取今日及以后）。"""
    import akshare as ak

    code6 = _digits6(code)
    if len(code6) < 6:
        return []
    today = date.today().strftime("%Y-%m-%d")
    out: List[Dict] = []

    # 限售解禁（新浪）
    try:
        sym = _sina_symbol(code6)
        df = ak.stock_restricted_release_queue_sina(symbol=sym)
        if df is not None and not getattr(df, "empty", True):
            for _, r in df.iterrows():
                d = _to_date_str(r.get("解禁日期"))
                if not d or d < today:
                    continue
                qty = r.get("解禁数量")
                cap = r.get("解禁股流通市值")
                bits = []
                try:
                    if qty is not None and float(qty) > 0:
                        bits.append(f"解禁 {float(qty) / 1e8:.2f} 亿股")
                except Exception:  # noqa: BLE001
                    pass
                try:
                    if cap is not None and float(cap) > 0:
                        bits.append(f"流通市值约 {_fmt_yi(float(cap))} 亿")
                except Exception:  # noqa: BLE001
                    pass
                out.append(
                    {
                        "date": d,
                        "type": "unlock",
                        "title": "限售解禁",
                        "detail": " · ".join(bits),
                        "source": "新浪财经",
                    }
                )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Checkup] restricted release failed for %s: %s", code6, exc)

    # 除权除息（巨潮）
    try:
        df = ak.stock_dividend_cninfo(symbol=code6)
        if df is not None and not getattr(df, "empty", True):
            for _, r in df.iterrows():
                d = _to_date_str(r.get("除权日")) or _to_date_str(r.get("股权登记日"))
                if not d or d < today:
                    continue
                note = str(r.get("实施方案分红说明") or "").strip()
                out.append(
                    {
                        "date": d,
                        "type": "exright",
                        "title": "除权除息",
                        "detail": note[:60],
                        "source": "巨潮资讯网",
                    }
                )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Checkup] dividend cninfo failed for %s: %s", code6, exc)

    out.sort(key=lambda x: x["date"])
    return out[:30]
