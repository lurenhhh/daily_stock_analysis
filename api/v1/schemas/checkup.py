# -*- coding: utf-8 -*-
"""个股体检卡 - 事件日历（未来大事）响应模型。"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class EventItem(BaseModel):
    """一条客观日程事件。"""

    date: str = Field(..., description="发生日期 YYYY-MM-DD")
    type: str = Field(..., description="unlock=限售解禁 / exright=除权除息 / other")
    title: str = Field(..., description="事件标题")
    detail: str = Field("", description="一句话说明")
    source: str = Field("", description="来源")


class CheckupEventsResponse(BaseModel):
    """未来大事（按日期升序）。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="展示代码")
    market: str = Field(..., description="市场标签")
    supported: bool = Field(..., description="该市场是否支持")
    message: Optional[str] = Field(None, description="补充说明")
    events: List[EventItem] = Field(default_factory=list, description="未来事件列表")
