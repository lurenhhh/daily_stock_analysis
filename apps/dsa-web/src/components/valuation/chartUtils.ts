import type {
  FundamentalsResponse,
  MetricKey,
} from '../../api/valuation';
import type { DashboardChartKind } from '../../utils/myDashboard';
import type { UiLanguage, UiTextKey, UiTextParams } from '../../i18n/uiText';

export type Translate = (key: UiTextKey, params?: UiTextParams) => string;

export const CHART_COLORS = {
  pe: 'hsl(var(--primary))',
  overvalued: '#f87171',
  mean: '#94a3b8',
  undervalued: '#34d399',
  revenue: '#f59e0b',
  marketCap: 'hsl(var(--primary))',
  grid: 'rgba(148, 163, 184, 0.16)',
  axis: '#94a3b8',
};

export function getLocale(language: UiLanguage): string {
  return language === 'en' ? 'en-US' : 'zh-CN';
}

export function fmtNumber(value: number | null | undefined, language: UiLanguage, digits = 2): string {
  return new Intl.NumberFormat(getLocale(language), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value ?? 0);
}

export function getPeMetricLabel(metric: string, t: Translate): string {
  return metric === 'pe' ? t('valuation.metric.pe') : t('valuation.metric.pe_ttm');
}

export const METRIC_CONFIG: { key: MetricKey; labelKey: UiTextKey; color: string }[] = [
  { key: 'grossMargin', labelKey: 'valuation.metricName.grossMargin', color: '#34d399' },
  { key: 'debtRatio', labelKey: 'valuation.metricName.debtRatio', color: '#f87171' },
  { key: 'dividendYield', labelKey: 'valuation.metricName.dividendYield', color: '#22d3ee' },
  { key: 'roe', labelKey: 'valuation.metricName.roe', color: '#a78bfa' },
  { key: 'deductedNetProfit', labelKey: 'valuation.metricName.deductedNetProfit', color: '#f59e0b' },
  { key: 'freeCashFlow', labelKey: 'valuation.metricName.freeCashFlow', color: '#38bdf8' },
];

export const METRIC_CONFIG_BY_KEY: Record<MetricKey, { labelKey: UiTextKey; color: string }> =
  METRIC_CONFIG.reduce(
    (acc, cfg) => {
      acc[cfg.key] = { labelKey: cfg.labelKey, color: cfg.color };
      return acc;
    },
    {} as Record<MetricKey, { labelKey: UiTextKey; color: string }>,
  );

export interface FundPoint {
  year: string;
  marketCap?: number;
  revenue?: number;
}

/** 将后端返回的营收(年度) + 市值(日频) 归并为「按年度」的组合数据 */
export function buildFundData(fundamentals: FundamentalsResponse | null): FundPoint[] {
  if (!fundamentals) {
    return [];
  }
  const revByYear = new Map<string, number>();
  for (const point of fundamentals.revenue) {
    if (point.year) {
      revByYear.set(point.year, point.value);
    }
  }
  const capByYear = new Map<string, number>();
  for (const point of fundamentals.marketCap) {
    const year = String(point.date).slice(0, 4);
    if (year) {
      capByYear.set(year, point.value); // 升序遍历，最后写入即年末值
    }
  }
  return Array.from(new Set([...revByYear.keys(), ...capByYear.keys()]))
    .filter((year) => /^\d{4}$/.test(year))
    .sort()
    .map((year) => ({ year, revenue: revByYear.get(year), marketCap: capByYear.get(year) }));
}

export function fundHasData(fundData: FundPoint[]): boolean {
  return fundData.some((point) => typeof point.marketCap === 'number' || typeof point.revenue === 'number');
}

export function fundUnitText(fundamentals: FundamentalsResponse | null, t: Translate): string {
  if (!fundamentals) {
    return t('valuation.unitYi');
  }
  return `${fundamentals.unit || '亿'}${fundamentals.currency ? ` ${fundamentals.currency}` : ''}`;
}

/** 看板图表类型的展示标签（PE / 营收市值 / 各财务指标）。 */
export function getChartKindLabel(chart: DashboardChartKind, t: Translate): string {
  if (chart === 'pe') {
    return getPeMetricLabel('pe_ttm', t);
  }
  if (chart === 'fund') {
    return t('valuation.fundTitle');
  }
  const cfg = METRIC_CONFIG_BY_KEY[chart as MetricKey];
  return cfg ? t(cfg.labelKey) : chart;
}
