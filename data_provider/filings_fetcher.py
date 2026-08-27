# -*- coding: utf-8 -*-
"""定期报告清单抓取（巨潮资讯网 / cninfo）。

只做「目录 + 指路」：聚合官方定期报告清单并给出官方原文链接，不托管、不加工、不代理 PDF。
A股走巨潮（AkShare stock_zh_a_disclosure_report_cninfo）；港股当前 AkShare 覆盖不稳，暂缓（见 service）。
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import date
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# 我们的类型 -> 巨潮 category
_CATEGORY_MAP = {
    "annual": "年报",
    "interim": "半年报",
    "q1": "一季报",
    "q3": "三季报",
}
_SOURCE_CNINFO = "巨潮资讯网"


def _digits6(code: str) -> str:
    return "".join(ch for ch in str(code) if ch.isdigit())[:6]


def _norm_period(report_type: str, title: str) -> str:
    m = re.search(r"(?:19|20)\d{2}", title or "")
    year = m.group(0) if m else ""
    if not year:
        return ""
    if report_type == "annual":
        return year
    if report_type == "interim":
        return year + "H1"
    if report_type == "q1":
        return year + "Q1"
    if report_type == "q3":
        return year + "Q3"
    return year


def fetch_ashare_filings(
    code: str,
    report_type: str = "all",
    start_date: str = "20050101",
    end_date: Optional[str] = None,
) -> List[Dict]:
    """A股定期报告清单（巨潮）。report_type: all/annual/interim/q1/q3。"""
    import akshare as ak

    code6 = _digits6(code)
    if len(code6) < 6:
        return []
    if end_date is None:
        end_date = date.today().strftime("%Y%m%d")

    types = [report_type] if report_type in _CATEGORY_MAP else list(_CATEGORY_MAP.keys())
    seen = set()
    out: List[Dict] = []
    for t in types:
        try:
            df = ak.stock_zh_a_disclosure_report_cninfo(
                symbol=code6,
                market="沪深京",
                category=_CATEGORY_MAP[t],
                start_date=start_date,
                end_date=end_date,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Filings] cninfo %s %s failed: %s", code6, t, exc)
            continue
        if df is None or getattr(df, "empty", True):
            continue
        for _, r in df.iterrows():
            title = str(r.get("公告标题") or "").strip()
            url = str(r.get("公告链接") or "").strip()
            pub = str(r.get("公告时间") or "")[:10]
            if not title or not url:
                continue
            fid = hashlib.md5(url.encode("utf-8")).hexdigest()[:16]
            if fid in seen:
                continue
            seen.add(fid)
            out.append(
                {
                    "id": fid,
                    "code": code6,
                    "display_code": code6,
                    "market": "ashare",
                    "title": title,
                    "report_type": t,
                    "report_period": _norm_period(t, title),
                    "publish_date": pub,
                    "official_url": url,
                    "source": _SOURCE_CNINFO,
                }
            )
    out.sort(key=lambda x: x["publish_date"], reverse=True)
    return out
