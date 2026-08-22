# -*- coding: utf-8 -*-
"""历史 PE 估值接口的响应模型。"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class PePoint(BaseModel):
    """单个交易日的 PE 采样点。"""

    date: str = Field(..., description="交易日期 YYYY-MM-DD")
    pe: float = Field(..., description="市盈率")


class PeStats(BaseModel):
    """基于正态分布（均值 ± 标准差）的估值统计。"""

    count: int = Field(..., description="参与统计的交易日数量")
    mean: float = Field(..., description="历史 PE 均值 μ（平均线）")
    std: float = Field(..., description="历史 PE 标准差 σ")
    overvalued: float = Field(..., description="高估线 μ + σ")
    undervalued: float = Field(..., description="低估线 μ - σ")
    current: float = Field(..., description="最新一个交易日的 PE")
    current_date: str = Field(..., description="最新交易日日期")
    min: float = Field(..., description="区间内 PE 最小值")
    max: float = Field(..., description="区间内 PE 最大值")
    zone: str = Field(..., description="当前估值区间：high / fair / low")


class PeHistoryResponse(BaseModel):
    """历史 PE 估值响应。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="用于展示的原始/精简代码")
    market: str = Field(..., description="市场标签：cn / hk / us / jp / kr / tw")
    metric: str = Field(..., description="估值指标：pe_ttm / pe")
    supported: bool = Field(..., description="该市场是否支持历史 PE 数据")
    message: Optional[str] = Field(None, description="补充说明（如不支持原因）")
    series: List[PePoint] = Field(default_factory=list, description="历史 PE 折线数据")
    stats: Optional[PeStats] = Field(None, description="估值统计与三条参考线")
