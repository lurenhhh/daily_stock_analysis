import apiClient from './index';
import { toCamelCase } from './utils';

export type EventType = 'unlock' | 'exright' | 'other';

export interface EventItem {
  date: string;
  type: EventType;
  title: string;
  detail: string;
  source: string;
}

export interface CheckupEventsResponse {
  code: string;
  displayCode: string;
  market: string;
  supported: boolean;
  message: string | null;
  events: EventItem[];
}

export const checkupApi = {
  getEvents: async (
    code: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<CheckupEventsResponse> => {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/checkup/events', {
      params: { code },
      signal: options.signal,
    });
    return toCamelCase<CheckupEventsResponse>(response.data);
  },
};
