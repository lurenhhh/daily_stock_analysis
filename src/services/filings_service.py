# -*- coding: utf-8 -*-
"""定期报告清单编排 + 缓存（12h）。"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, List, Optional

from data_provider.base import _market_tag, normalize_stock_code
from data_provider.filings_fetcher import fetch_ashare_filings

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {}
_TTL_SECONDS = 12 * 3600
_LOCK = threading.Lock()


class FilingsService:
    def resolve_market(self, code: str, market: Optional[str]) -> str:
        if market in ("ashare", "hk"):
            return market
        tag = _market_tag(normalize_stock_code(code))
        if tag == "cn":
            return "ashare"
        if tag == "hk":
            return "hk"
        return tag  # us / jp -> unsupported

    def _filter_year(self, items: List[Dict], year: Optional[str]) -> List[Dict]:
        if not year or year == "all":
            return items
        y = str(year)
        return [
            it
            for it in items
            if y in (it.get("report_period") or "") or (it.get("publish_date") or "")[:4] == y
        ]

    def get_filings(
        self,
        code: str,
        market: Optional[str] = None,
        report_type: str = "all",
        year: str = "all",
        refresh: bool = False,
    ) -> Dict[str, Any]:
        m = self.resolve_market(code, market)
        if m == "hk":
            return {"market": "hk", "supported": False, "message": "港股财报清单即将支持", "items": []}
        if m != "ashare":
            return {"market": m, "supported": False, "message": "该市场暂不支持财报查询", "items": []}

        key = "filings:ashare:" + normalize_stock_code(code).upper() + ":" + (report_type or "all")
        now = time.time()
        if not refresh:
            with _LOCK:
                cached = _CACHE.get(key)
            if cached and now - cached[0] < _TTL_SECONDS:
                return {
                    "market": "ashare",
                    "supported": True,
                    "message": None,
                    "items": self._filter_year(cached[1], year),
                }

        try:
            items = fetch_ashare_filings(code, report_type)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Filings] fetch failed for %s: %s", code, exc)
            with _LOCK:
                cached = _CACHE.get(key)
            if cached:
                return {
                    "market": "ashare",
                    "supported": True,
                    "message": "数据源暂时不可用，返回缓存",
                    "items": self._filter_year(cached[1], year),
                }
            return {"market": "ashare", "supported": True, "message": "数据源暂时不可用，请稍后重试", "items": []}

        with _LOCK:
            _CACHE[key] = (now, items)
        return {
            "market": "ashare",
            "supported": True,
            "message": None if items else "未查询到定期报告",
            "items": self._filter_year(items, year),
        }
