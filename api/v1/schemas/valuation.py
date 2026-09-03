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


class DcfScenario(BaseModel):
    """某个参数的三档情景参考值：悲观 / 中等 / 乐观。"""

    bear: float = Field(..., description="悲观")
    base: float = Field(..., description="中等")
    bull: float = Field(..., description="乐观")


class DcfReferenceResponse(BaseModel):
    """DCF（现金流折现）估值的「按公司」参考值（每个参数含三档情景）。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="用于展示的原始/精简代码")
    market: str = Field(..., description="市场标签")
    supported: bool = Field(..., description="是否可提供参考（至少有当前市值）")
    currency: str = Field(..., description="计价货币")
    market_cap: Optional[float] = Field(None, description="当前总市值（亿，用于对比）")
    price: Optional[float] = Field(None, description="当前股价（本币/股）")
    fcf: Optional[DcfScenario] = Field(None, description="自由现金流参考（亿）")
    discount: Optional[DcfScenario] = Field(None, description="折现率参考（%）")
    growth: Optional[DcfScenario] = Field(None, description="高速增长率参考（%）")
    years: Optional[DcfScenario] = Field(None, description="高速增长年数参考")
    perpetual: Optional[DcfScenario] = Field(None, description="永续增长率参考（%）")
    source: str = Field("heuristic", description="参考值来源：llm / heuristic")
    rationale: Optional[str] = Field(None, description="LLM 给出的简短依据")
    message: Optional[str] = Field(None, description="补充说明")


class MilestoneItem(BaseModel):
    """公司发展史上的一个重要节点。"""

    date: str = Field(..., description="发生时间（YYYY 或 YYYY-MM）")
    title: str = Field(..., description="节点标题（简短）")
    detail: str = Field("", description="一句话说明")
    kind: str = Field("other", description="类别：ipo/ma/product/capital/policy/price/other")
    impact: str = Field("", description="仅股价类：up=大涨 / down=大跌 / 空")


class MilestonesResponse(BaseModel):
    """公司里程碑时间轴（由 LLM 生成，参考性质）。三列：发展 / 战略 / 股价波动。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="用于展示的原始/精简代码")
    market: str = Field(..., description="市场标签")
    supported: bool = Field(..., description="是否成功生成里程碑")
    source: str = Field("llm", description="来源：llm / none")
    message: Optional[str] = Field(None, description="补充说明")
    general: List[MilestoneItem] = Field(default_factory=list, description="发展/重要节点（时间升序）")
    strategy: List[MilestoneItem] = Field(default_factory=list, description="战略里程碑（时间升序）")
    price: List[MilestoneItem] = Field(default_factory=list, description="引发股价大幅波动的事件（时间升序）")


class LeaderEvent(BaseModel):
    """领导人生平中的一个重要节点（岗位变动/重要事迹）。"""

    date: str = Field(..., description="时间（YYYY 或 YYYY-MM）")
    event: str = Field(..., description="事件（岗位变动或重要事迹）")
    kind: str = Field("other", description="类别：role=岗位变动 / deed=重要事迹 / other")


class Leader(BaseModel):
    """公司一位主要领导人的资料（LLM 生成，参考性质）。"""

    name: str = Field(..., description="姓名")
    title: str = Field(..., description="职务")
    tenure: str = Field("", description="任期（可空）")
    intro: str = Field("", description="一句话背景介绍")
    timeline: List[LeaderEvent] = Field(default_factory=list, description="生平重要节点（岗位变动/重要事迹，时间升序）")
    achievements: List[str] = Field(default_factory=list, description="重要成就")
    controversies: List[str] = Field(default_factory=list, description="公开报道的争议/历史污点（无则为空）")


class LeadersResponse(BaseModel):
    """公司主要领导人列表（LLM 生成，参考性质）。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="用于展示的原始/精简代码")
    market: str = Field(..., description="市场标签")
    supported: bool = Field(..., description="是否成功生成")
    source: str = Field("llm", description="来源：llm / none")
    message: Optional[str] = Field(None, description="补充说明")
    leaders: List[Leader] = Field(default_factory=list, description="主要领导人列表")


class SegmentRevenuePoint(BaseModel):
    """某个报告期各业务的营收（单位：亿，本币）。"""

    date: str = Field(..., description="报告期 YYYY-MM-DD")
    revenues: List[float] = Field(default_factory=list, description="与 segments 顺序对齐的营收（亿），缺失记 0")


class SegmentRevenueResponse(BaseModel):
    """公司各业务（主营构成）营收时间序列。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="用于展示的原始/精简代码")
    market: str = Field(..., description="市场标签")
    supported: bool = Field(..., description="是否有可用的主营构成数据")
    currency: str = Field("CNY", description="计价货币")
    unit: str = Field("亿", description="金额单位")
    classify: str = Field("", description="分类口径：按产品分类 / 按行业分类 / 按地区分类")
    message: Optional[str] = Field(None, description="补充说明")
    segments: List[str] = Field(default_factory=list, description="业务名列表")
    points: List[SegmentRevenuePoint] = Field(default_factory=list, description="按报告期升序")


class KlinePoint(BaseModel):
    """单个交易日 K 线（前复权）。"""

    date: str = Field(..., description="交易日 YYYY-MM-DD")
    open: float = Field(..., description="开盘")
    high: float = Field(..., description="最高")
    low: float = Field(..., description="最低")
    close: float = Field(..., description="收盘")
    volume: float = Field(0, description="成交量")


class KlineResponse(BaseModel):
    """个股日 K 线响应。"""

    code: str = Field(..., description="规范化后的股票代码")
    display_code: str = Field(..., description="展示代码")
    market: str = Field(..., description="市场标签")
    supported: bool = Field(..., description="该市场是否支持 K 线")
    message: Optional[str] = Field(None, description="补充说明")
    items: List[KlinePoint] = Field(default_factory=list, description="按日期升序")


class ScreenPoolItem(BaseModel):
    """筛选池中的单只股票。"""

    code: str = Field(..., description="6 位股票代码")
    name: str = Field("", description="股票名称")


class ScreenPoolResponse(BaseModel):
    """预置筛选池（指数成分股 / 自选）响应。"""

    pool: str = Field(..., description="池标识：sse50 / hs300 / zz500 / watchlist")
    name: str = Field(..., description="池名称")
    count: int = Field(0, description="成分数量")
    supported: bool = Field(True, description="是否成功取到成分股")
    message: Optional[str] = Field(None, description="补充说明")
    items: List[ScreenPoolItem] = Field(default_factory=list, description="成分股列表")
