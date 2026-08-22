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
};
