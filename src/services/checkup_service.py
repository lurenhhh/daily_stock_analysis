# -*- coding: utf-8 -*-
"""个股体检卡 - 未来大事编排 + 缓存（12h）。"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict

from data_provider.base import _market_tag, normalize_stock_code
from data_provider.checkup_fetcher import fetch_upcoming_events

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Any] = {}
_TTL_SECONDS = 12 * 3600
_LOCK = threading.Lock()


class CheckupService:
    def get_events(self, code: str, refresh: bool = False) -> Dict[str, Any]:
        market = _market_tag(normalize_stock_code(code))
        if market != "cn":
            return {"market": market, "supported": False, "message": "当前仅支持 A 股", "events": []}

        key = "checkup_events:" + normalize_stock_code(code).upper()
        now = time.time()
        if not refresh:
            with _LOCK:
                cached = _CACHE.get(key)
            if cached and now - cached[0] < _TTL_SECONDS:
                return {"market": "cn", "supported": True, "message": None, "events": cached[1]}

        try:
            events = fetch_upcoming_events(code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Checkup] events failed for %s: %s", code, exc)
            with _LOCK:
                cached = _CACHE.get(key)
            if cached:
                return {"market": "cn", "supported": True, "message": "数据源暂时不可用，返回缓存", "events": cached[1]}
            return {"market": "cn", "supported": True, "message": "数据源暂时不可用，请稍后重试", "events": []}

        with _LOCK:
            _CACHE[key] = (now, events)
        return {
            "market": "cn",
            "supported": True,
            "message": None if events else "近期暂无可获取的公开日程",
            "events": events,
        }
