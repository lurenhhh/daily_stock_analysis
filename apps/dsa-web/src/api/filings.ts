import apiClient from './index';
import { toCamelCase } from './utils';

export type FilingType = 'annual' | 'interim' | 'q1' | 'q3' | 'other';

export interface FilingItem {
  id: string;
  code: string;
  displayCode: string;
  market: string;
  title: string;
  reportType: FilingType;
  reportPeriod: string;
  publishDate: string;
  officialUrl: string;
  source: string;
}

export interface FilingsResponse {
  code: string;
  displayCode: string;
  market: string;
  supported: boolean;
  message: string | null;
  items: FilingItem[];
}

export interface GetFilingsParams {
  market?: string;
  type?: string;
  year?: string;
  refresh?: boolean;
}

export const filingsApi = {
  getFilings: async (
    code: string,
    params: GetFilingsParams = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<FilingsResponse> => {
    const { market, type = 'all', year = 'all', refresh } = params;
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/filings', {
      params: {
        code,
        market: market ?? '',
        type,
        year,
        refresh: refresh ? true : undefined,
      },
      signal: options.signal,
    });
    return toCamelCase<FilingsResponse>(response.data);
  },
};
