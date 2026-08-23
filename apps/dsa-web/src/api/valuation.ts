import apiClient from './index';
import { toCamelCase } from './utils';

export type ValuationMetric = 'pe_ttm' | 'pe';

export type ValuationZone = 'high' | 'fair' | 'low';

export interface PePoint {
  date: string;
  pe: number;
}

export interface PeStats {
  count: number;
  mean: number;
  std: number;
  overvalued: number;
  undervalued: number;
  current: number;
  currentDate: string;
  min: number;
  max: number;
  zone: ValuationZone;
}

export interface PeHistoryResponse {
  code: string;
  displayCode: string;
  market: string;
  metric: ValuationMetric;
  supported: boolean;
  message: string | null;
  series: PePoint[];
  stats: PeStats | null;
}

export interface GetPeHistoryParams {
  years?: number;
  metric?: ValuationMetric;
}

export interface GetPeHistoryOptions {
  signal?: AbortSignal;
}

export interface MarketCapPoint {
  date: string;
  value: number;
}

export interface RevenuePoint {
  date: string;
  year: string;
  value: number;
}

export interface FundamentalsResponse {
  code: string;
  displayCode: string;
  market: string;
  supported: boolean;
  currency: string;
  unit: string;
  message: string | null;
  marketCap: MarketCapPoint[];
  revenue: RevenuePoint[];
}

export interface GetFundamentalsParams {
  years?: number;
}

// 注意：后端返回 snake_case，经 toCamelCase(deep) 后这些键会变为驼峰形式。
export type MetricKey =
  | 'grossMargin'
  | 'debtRatio'
  | 'dividendYield'
  | 'roe'
  | 'deductedNetProfit'
  | 'freeCashFlow';

export interface MetricPoint {
  year: string;
  value: number;
}

export interface MetricSeries {
  kind: 'line' | 'bar';
  unit: string;
  points: MetricPoint[];
}

export interface MetricsResponse {
  code: string;
  displayCode: string;
  market: string;
  supported: boolean;
  currency: string;
  message: string | null;
  metrics: Partial<Record<MetricKey, MetricSeries>>;
}

export interface DcfScenario {
  bear: number;
  base: number;
  bull: number;
}

export interface DcfReferenceResponse {
  code: string;
  displayCode: string;
  market: string;
  supported: boolean;
  currency: string;
  marketCap: number | null;
  price: number | null;
  fcf: DcfScenario | null;
  discount: DcfScenario | null;
  growth: DcfScenario | null;
  years: DcfScenario | null;
  perpetual: DcfScenario | null;
  source: string;
  rationale: string | null;
  message: string | null;
}

export const valuationApi = {
  /**
   * 获取个股历史 PE 走势与正态分布估值参考线。
   * @param code 股票代码（或自动补全给出的规范代码）
   */
  getPeHistory: async (
    code: string,
    params: GetPeHistoryParams = {},
    options: GetPeHistoryOptions = {},
  ): Promise<PeHistoryResponse> => {
    const { years = 20, metric = 'pe_ttm' } = params;
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/valuation/pe-history', {
      params: { code, years, metric },
      signal: options.signal,
    });
    return toCamelCase<PeHistoryResponse>(response.data);
  },

  /**
   * 获取总营收（年度）与总市值（日频）组合数据。
   */
  getFundamentals: async (
    code: string,
    params: GetFundamentalsParams = {},
    options: GetPeHistoryOptions = {},
  ): Promise<FundamentalsResponse> => {
    const { years = 20 } = params;
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/valuation/fundamentals', {
      params: { code, years },
      signal: options.signal,
    });
    return toCamelCase<FundamentalsResponse>(response.data);
  },

  /**
   * 获取扩展财务指标（毛利率/资产负债率/股息率/ROE/扣非净利润/自由现金流，年度）。
   */
  getMetrics: async (
    code: string,
    params: GetFundamentalsParams = {},
    options: GetPeHistoryOptions = {},
  ): Promise<MetricsResponse> => {
    const { years = 20 } = params;
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/valuation/metrics', {
      params: { code, years },
      signal: options.signal,
    });
    return toCamelCase<MetricsResponse>(response.data);
  },

  /**
   * 获取 DCF 估值的按公司参考值（当前市值、FCF、增长率等）。
   */
  getDcfReference: async (
    code: string,
    params: { useLlm?: boolean } = {},
    options: GetPeHistoryOptions = {},
  ): Promise<DcfReferenceResponse> => {
    const useLlm = params.useLlm ?? false;
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/valuation/dcf-reference', {
      params: { code, use_llm: useLlm },
      signal: options.signal,
      timeout: useLlm ? 120000 : 30000, // LLM 推理慢，放宽到 120s；历史推算用默认
    });
    return toCamelCase<DcfReferenceResponse>(response.data);
  },
};
