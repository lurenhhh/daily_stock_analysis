import axios from 'axios';
import { API_BASE_URL } from '../utils/constants';
import type { DashboardItem } from '../utils/myDashboard';

// 独立的 axios 实例：不挂全局 401 → /login 跳转拦截器，
// 这样匿名用户查会话（getMe 返回 401）不会被强制跳转登录页。
const accountClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

export interface AccountUser {
  id: string;
  email: string;
  nickname: string | null;
}

export interface DashboardSyncResponse {
  items: DashboardItem[];
  updatedAt: string | null;
}

export const accountApi = {
  register: async (email: string, password: string, nickname?: string): Promise<AccountUser> => {
    const { data } = await accountClient.post<{ user: AccountUser }>('/api/v1/account/register', {
      email,
      password,
      nickname,
    });
    return data.user;
  },

  login: async (email: string, password: string): Promise<AccountUser> => {
    const { data } = await accountClient.post<{ user: AccountUser }>('/api/v1/account/login', {
      email,
      password,
    });
    return data.user;
  },

  logout: async (): Promise<void> => {
    await accountClient.post('/api/v1/account/logout');
  },

  getMe: async (): Promise<AccountUser | null> => {
    try {
      const { data } = await accountClient.get<{ user: AccountUser }>('/api/v1/account/me');
      return data.user;
    } catch {
      return null;
    }
  },

  getDashboard: async (): Promise<DashboardSyncResponse> => {
    const { data } = await accountClient.get<DashboardSyncResponse>('/api/v1/account/dashboard');
    return data;
  },

  putDashboard: async (items: DashboardItem[]): Promise<{ ok: boolean; updatedAt: string }> => {
    const { data } = await accountClient.put<{ ok: boolean; updatedAt: string }>(
      '/api/v1/account/dashboard',
      { items },
    );
    return data;
  },

  getDossier: async (): Promise<{ data: unknown; updatedAt: string | null }> => {
    const { data } = await accountClient.get<{ data: unknown; updatedAt: string | null }>(
      '/api/v1/account/dossier',
    );
    return data;
  },

  putDossier: async (data: unknown): Promise<{ ok: boolean; updatedAt: string }> => {
    const { data: res } = await accountClient.put<{ ok: boolean; updatedAt: string }>(
      '/api/v1/account/dossier',
      { data },
    );
    return res;
  },
};
