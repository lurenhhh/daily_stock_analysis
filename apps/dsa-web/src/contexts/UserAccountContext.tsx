import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { accountApi, type AccountUser } from '../api/account';
import {
  MY_DASHBOARD_CHANGED_EVENT,
  clearDashboard,
  loadDashboardItems,
  replaceAllDashboardItems,
} from '../utils/myDashboard';
import {
  HOLDINGS_CHANGED_EVENT,
  clearDiscipline,
  exportStore,
  replaceStoreFromCloud,
  storeHasContent,
} from '../utils/holdingDiscipline';

interface UserAccountValue {
  user: AccountUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const UserAccountContext = createContext<UserAccountValue | null>(null);

export function UserAccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const pushTimer = useRef<number | null>(null);
  const dossierTimer = useRef<number | null>(null);

  // 登录后：拉服务端看板；服务端非空则覆盖本地，服务端为空而本地非空则把本地迁移上去。
  const syncOnLogin = useCallback(async () => {
    try {
      const server = await accountApi.getDashboard();
      const serverItems = server.items ?? [];
      if (serverItems.length > 0) {
        replaceAllDashboardItems(serverItems);
      } else {
        const local = loadDashboardItems();
        if (local.length > 0) {
          await accountApi.putDashboard(local);
        }
      }
    } catch {
      /* MVP：同步失败静默，保持本地可用 */
    }
    try {
      const serverDossier = await accountApi.getDossier();
      const d = serverDossier.data as { holdings?: unknown[] } | null;
      const serverHas = !!d && Array.isArray(d.holdings) && d.holdings.length > 0;
      if (serverHas) {
        replaceStoreFromCloud(d);
      } else {
        const localStore = exportStore();
        if (storeHasContent(localStore)) {
          await accountApi.putDossier(localStore);
        }
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  // 初始：查会话
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const current = await accountApi.getMe();
      if (cancelled) {
        return;
      }
      setUser(current);
      setLoading(false);
      if (current) {
        void syncOnLogin();
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [syncOnLogin]);

  // 登录后订阅本地看板变更，去抖后覆盖保存到服务端（last-write-wins）。
  useEffect(() => {
    if (!user) {
      return undefined;
    }
    const handler = () => {
      if (pushTimer.current) {
        window.clearTimeout(pushTimer.current);
      }
      pushTimer.current = window.setTimeout(() => {
        accountApi.putDashboard(loadDashboardItems()).catch(() => {
          /* 忽略（如登出后 cookie 失效导致的 401） */
        });
      }, 1500);
    };
    const dossierHandler = () => {
      if (dossierTimer.current) {
        window.clearTimeout(dossierTimer.current);
      }
      dossierTimer.current = window.setTimeout(() => {
        accountApi.putDossier(exportStore()).catch(() => {
          /* 忽略（如登出后 401） */
        });
      }, 1500);
    };
    window.addEventListener(MY_DASHBOARD_CHANGED_EVENT, handler);
    window.addEventListener(HOLDINGS_CHANGED_EVENT, dossierHandler);
    return () => {
      window.removeEventListener(MY_DASHBOARD_CHANGED_EVENT, handler);
      window.removeEventListener(HOLDINGS_CHANGED_EVENT, dossierHandler);
      if (pushTimer.current) {
        window.clearTimeout(pushTimer.current);
      }
      if (dossierTimer.current) {
        window.clearTimeout(dossierTimer.current);
      }
    };
  }, [user]);

  const login = useCallback(
    async (email: string, password: string) => {
      const current = await accountApi.login(email, password);
      setUser(current);
      await syncOnLogin();
    },
    [syncOnLogin],
  );

  const register = useCallback(
    async (email: string, password: string, nickname?: string) => {
      const current = await accountApi.register(email, password, nickname);
      setUser(current);
      await syncOnLogin();
    },
    [syncOnLogin],
  );

  const logout = useCallback(async () => {
    try {
      await accountApi.logout();
    } catch {
      /* 忽略网络错误 */
    }
    setUser(null);
    // 回到本地态，清空以避免与下一位登录用户串号（服务端已保留其数据）。
    clearDashboard();
    clearDiscipline();
  }, []);

  return (
    <UserAccountContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </UserAccountContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- useUserAccount is a hook, co-located for context access
export function useUserAccount(): UserAccountValue {
  const ctx = useContext(UserAccountContext);
  if (!ctx) {
    throw new Error('useUserAccount must be used within UserAccountProvider');
  }
  return ctx;
}
