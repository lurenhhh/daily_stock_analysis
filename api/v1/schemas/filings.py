# -*- coding: utf-8 -*-
"""原始财报查询（定期报告清单）响应模型。"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class FilingItem(BaseModel):
    """一条定期报告（指向官方原文）。"""

    id: str = Field(..., description="稳定标识（hash(url)）")
    code: str = Field(..., description="股票代码")
    display_code: str = Field(..., description="展示代码")
    market: str = Field(..., description="市场：ashare / hk")
    title: str = Field(..., description="报告标题")
    report_type: str = Field(..., description="annual / interim / q1 / q3 / other")
    report_period: str = Field("", description="报告期，如 2025 / 2025H1 / 2025Q3")
    publish_date: str = Field("", description="披露日期 YYYY-MM-DD")
    official_url: str = Field(..., description="官方原文链接（详情页或 PDF 直链）")
    source: str = Field("", description="来源，如 巨潮资讯网")


class FilingsResponse(BaseModel):
    """定期报告清单响应。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="展示代码")
    market: str = Field(..., description="市场：ashare / hk / 其它")
    supported: bool = Field(..., description="该市场是否支持财报查询")
    message: Optional[str] = Field(None, description="补充说明")
    items: List[FilingItem] = Field(default_factory=list, description="定期报告列表（按披露日期倒序）")
