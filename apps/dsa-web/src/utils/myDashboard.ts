import type { MetricKey, ValuationMetric } from '../api/valuation';

/** 看板条目的图表类型：pe / fund / 或某个财务指标键 */
export type DashboardChartKind = 'pe' | 'fund' | MetricKey;

export interface DashboardItem {
  id: string;
  code: string; // 用于请求的规范化代码
  displayCode: string;
  name: string | null;
  chart: DashboardChartKind;
  metric?: ValuationMetric; // 仅 pe 使用
  years: number;
  addedAt: number;
}

const STORAGE_KEY = 'dsa:myDashboard';
export const MY_DASHBOARD_CHANGED_EVENT = 'dsa:myDashboardChanged';

function emitChange(): void {
  try {
    window.dispatchEvent(new Event(MY_DASHBOARD_CHANGED_EVENT));
  } catch {
    /* SSR/无 window 时忽略 */
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadDashboardItems(): DashboardItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is DashboardItem =>
        item &&
        typeof item.id === 'string' &&
        typeof item.code === 'string' &&
        typeof item.chart === 'string',
    );
  } catch {
    return [];
  }
}

function saveDashboardItems(items: DashboardItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* 隐私模式/存储不可用时忽略 */
  }
  emitChange();
}

export function dashboardItemKey(code: string, chart: DashboardChartKind, metric?: ValuationMetric): string {
  return `${code.toUpperCase()}|${chart}|${chart === 'pe' ? metric ?? 'pe_ttm' : ''}`;
}

export function isInDashboard(
  items: DashboardItem[],
  code: string,
  chart: DashboardChartKind,
  metric?: ValuationMetric,
): boolean {
  const key = dashboardItemKey(code, chart, metric);
  return items.some((item) => dashboardItemKey(item.code, item.chart, item.metric) === key);
}

/** 添加一个看板条目（同一股票+同一图表去重）。返回是否新增。 */
export function addDashboardItem(item: Omit<DashboardItem, 'id' | 'addedAt'>): { added: boolean } {
  const items = loadDashboardItems();
  if (isInDashboard(items, item.code, item.chart, item.metric)) {
    return { added: false };
  }
  const next: DashboardItem[] = [...items, { ...item, id: newId(), addedAt: Date.now() }];
  saveDashboardItems(next);
  return { added: true };
}

export function removeDashboardItem(id: string): void {
  saveDashboardItems(loadDashboardItems().filter((item) => item.id !== id));
}

export function clearDashboard(): void {
  saveDashboardItems([]);
}
