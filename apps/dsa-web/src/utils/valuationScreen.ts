import type {
  FundamentalsResponse,
  MetricsResponse,
  PeHistoryResponse,
} from '../api/valuation';

export type ScreenConditionType =
  | 'peYearsGt' // 最近 N 年 PE 都 > X
  | 'peBelowUnder' // 现价 PE 低于低估线
  | 'divYearsGt' // 最近 N 年 股息率 都 > X(%)
  | 'revenueGrowth' // 最近 N 年 营收 都增长 ≥ X(%)
  | 'roeYearsGt'; // 最近 N 年 ROE 都 > X(%)

export const CONDITION_TYPES: ScreenConditionType[] = [
  'peYearsGt',
  'peBelowUnder',
  'divYearsGt',
  'revenueGrowth',
  'roeYearsGt',
];

export const CONDITION_NEEDS_YEARS: Record<ScreenConditionType, boolean> = {
  peYearsGt: true,
  peBelowUnder: false,
  divYearsGt: true,
  revenueGrowth: true,
  roeYearsGt: true,
};
export const CONDITION_NEEDS_THRESHOLD: Record<ScreenConditionType, boolean> = {
  peYearsGt: true,
  peBelowUnder: false,
  divYearsGt: true,
  revenueGrowth: true,
  roeYearsGt: true,
};

export interface ScreenCondition {
  id: string;
  type: ScreenConditionType;
  years: number;
  threshold: number;
}

export interface ScreenData {
  pe: PeHistoryResponse | null;
  metrics: MetricsResponse | null;
  fundamentals: FundamentalsResponse | null;
}

export type ConditionStatus = 'pass' | 'fail' | 'nodata';
export interface ConditionResult {
  conditionId: string;
  status: ConditionStatus;
  actual: string;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULTS: Record<ScreenConditionType, { years: number; threshold: number }> = {
  peYearsGt: { years: 5, threshold: 10 },
  peBelowUnder: { years: 0, threshold: 0 },
  divYearsGt: { years: 5, threshold: 3 },
  revenueGrowth: { years: 3, threshold: 10 },
  roeYearsGt: { years: 5, threshold: 15 },
};

export function newCondition(type: ScreenConditionType = 'roeYearsGt'): ScreenCondition {
  return { id: uid(), type, ...DEFAULTS[type] };
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

// 取年度序列最近 N 年的值（按 year 升序取尾部 N 个）。
function lastNAnnual(points: { year: string; value: number }[] | undefined, n: number): number[] {
  if (!points || points.length === 0) {
    return [];
  }
  const sorted = [...points].sort((a, b) => a.year.localeCompare(b.year));
  return sorted.slice(-n).map((p) => p.value);
}

export function evaluateCondition(c: ScreenCondition, data: ScreenData): ConditionResult {
  const r = (status: ConditionStatus, actual: string): ConditionResult => ({ conditionId: c.id, status, actual });

  if (c.type === 'peBelowUnder') {
    const stats = data.pe?.stats;
    if (!stats) {
      return r('nodata', '—');
    }
    const pass = stats.current < stats.undervalued;
    return r(pass ? 'pass' : 'fail', `PE ${fmt(stats.current)} / 低估 ${fmt(stats.undervalued)}`);
  }

  if (c.type === 'peYearsGt') {
    const series = data.pe?.series ?? [];
    if (series.length === 0) {
      return r('nodata', '—');
    }
    const latestYear = Number(series[series.length - 1].date.slice(0, 4));
    const cutoff = latestYear - c.years + 1;
    const windowPts = series.filter((p) => Number(p.date.slice(0, 4)) >= cutoff).map((p) => p.pe);
    if (windowPts.length === 0) {
      return r('nodata', '—');
    }
    const minPe = Math.min(...windowPts);
    return r(minPe > c.threshold ? 'pass' : 'fail', `近${c.years}年最低 PE ${fmt(minPe)}`);
  }

  if (c.type === 'divYearsGt' || c.type === 'roeYearsGt') {
    const key = c.type === 'divYearsGt' ? 'dividendYield' : 'roe';
    const vals = lastNAnnual(data.metrics?.metrics?.[key]?.points, c.years);
    if (vals.length === 0) {
      return r('nodata', '—');
    }
    const mn = Math.min(...vals);
    return r(mn > c.threshold ? 'pass' : 'fail', `近${vals.length}年最低 ${fmt(mn)}%`);
  }

  if (c.type === 'revenueGrowth') {
    const rev = data.fundamentals?.revenue ?? [];
    if (rev.length < 2) {
      return r('nodata', '—');
    }
    const sorted = [...rev].sort((a, b) => a.year.localeCompare(b.year));
    // 需要最近 N 个增长率 -> 最近 N+1 个营收点
    const window = sorted.slice(-(c.years + 1));
    if (window.length < 2) {
      return r('nodata', '—');
    }
    const growths: number[] = [];
    for (let i = 1; i < window.length; i += 1) {
      const prev = window[i - 1].value;
      const cur = window[i].value;
      if (!prev) {
        continue;
      }
      growths.push(((cur - prev) / Math.abs(prev)) * 100);
    }
    if (growths.length === 0) {
      return r('nodata', '—');
    }
    const mn = Math.min(...growths);
    return r(mn >= c.threshold ? 'pass' : 'fail', `近${growths.length}年最低增速 ${fmt(mn, 1)}%`);
  }

  return r('nodata', '—');
}

export function evaluateAll(conditions: ScreenCondition[], data: ScreenData): ConditionResult[] {
  return conditions.map((c) => evaluateCondition(c, data));
}

export function allPass(results: ConditionResult[]): boolean {
  return results.length > 0 && results.every((r) => r.status === 'pass');
}
