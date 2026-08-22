# -*- coding: utf-8 -*-
"""历史 PE 估值接口的响应模型。"""

from __future__ import annotations

from typing import Dict, List, Optional

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


class MarketCapPoint(BaseModel):
    """单个交易日的总市值采样点（单位：亿元/本币）。"""

    date: str = Field(..., description="日期 YYYY-MM-DD")
    value: float = Field(..., description="总市值（亿，本币）")


class RevenuePoint(BaseModel):
    """单个会计年度的总营收（单位：亿元/本币）。"""

    date: str = Field(..., description="报告期 YYYY-12-31")
    year: str = Field(..., description="会计年度")
    value: float = Field(..., description="营业总收入（亿，本币）")


class FundamentalsResponse(BaseModel):
    """总营收（年度柱）+ 总市值（日频线）组合数据。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="用于展示的原始/精简代码")
    market: str = Field(..., description="市场标签：cn / hk / us / ...")
    supported: bool = Field(..., description="该市场是否支持基本面数据")
    currency: str = Field(..., description="计价货币：CNY / HKD / USD")
    unit: str = Field("亿", description="金额单位")
    message: Optional[str] = Field(None, description="补充说明")
    market_cap: List[MarketCapPoint] = Field(default_factory=list, description="总市值日频序列")
    revenue: List[RevenuePoint] = Field(default_factory=list, description="总营收年度序列")


class MetricPoint(BaseModel):
    """单个会计年度的指标值。"""

    year: str = Field(..., description="会计年度")
    value: float = Field(..., description="指标值（百分比或亿元）")


class MetricSeries(BaseModel):
    """一个财务指标的年度序列。"""

    kind: str = Field(..., description="图形：line / bar")
    unit: str = Field(..., description="单位：% 或 亿")
    points: List[MetricPoint] = Field(default_factory=list, description="年度序列")


class MetricsResponse(BaseModel):
    """扩展财务指标（每个指标一条年度序列）。

    line: gross_margin(毛利率) / debt_ratio(资产负债率) / dividend_yield(股息率) / roe(ROE)
    bar:  deducted_net_profit(扣非净利润) / free_cash_flow(自由现金流)
    """

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="用于展示的原始/精简代码")
    market: str = Field(..., description="市场标签")
    supported: bool = Field(..., description="该市场是否支持扩展财务指标")
    currency: str = Field(..., description="计价货币")
    message: Optional[str] = Field(None, description="补充说明")
    metrics: Dict[str, MetricSeries] = Field(default_factory=dict, description="指标键 -> 年度序列")
