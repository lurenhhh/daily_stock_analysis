import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LineChart as LineChartIcon, RefreshCw, TrendingUp } from 'lucide-react';
import {
  valuationApi,
  type FundamentalsResponse,
  type MetricKey,
  type MetricSeries,
  type MetricsResponse,
  type PeHistoryResponse,
  type ValuationMetric,
  type ValuationZone,
} from '../api/valuation';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { ApiErrorAlert, AppPage, Card, EmptyState, PageHeader, StatCard } from '../components/common';
import { DraggableChartGrid, type ChartPanelSpec } from '../components/common/DraggableChartGrid';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type { UiLanguage, UiTextKey, UiTextParams } from '../i18n/uiText';
import { cn } from '../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const METRIC_OPTIONS: ValuationMetric[] = ['pe_ttm', 'pe'];
const YEAR_OPTIONS = [10, 20] as const;

const COLORS = {
  pe: 'hsl(var(--primary))',
  overvalued: '#f87171',
  mean: '#94a3b8',
  undervalued: '#34d399',
  revenue: '#f59e0b',
  marketCap: 'hsl(var(--primary))',
  grid: 'rgba(148, 163, 184, 0.16)',
  axis: '#94a3b8',
};

const ZONE_TONE: Record<ValuationZone, 'success' | 'warning' | 'danger'> = {
  high: 'danger',
  fair: 'warning',
  low: 'success',
};

const ZONE_BADGE_CLASS: Record<ValuationZone, string> = {
  high: 'border-danger/30 bg-danger/10 text-danger',
  fair: 'border-warning/30 bg-warning/10 text-warning',
  low: 'border-success/30 bg-success/10 text-success',
};

function getLocale(language: UiLanguage): string {
  return language === 'en' ? 'en-US' : 'zh-CN';
}

function formatNumber(value: number | null | undefined, language: UiLanguage, digits = 2): string {
  return new Intl.NumberFormat(getLocale(language), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value ?? 0);
}

function getMetricLabel(metric: string, t: Translate): string {
  return metric === 'pe' ? t('valuation.metric.pe') : t('valuation.metric.pe_ttm');
}

function getMarketLabel(market: string, t: Translate): string {
  const key = `valuation.market.${market}` as UiTextKey;
  const label = t(key);
  // 未命中的市场键会原样返回 key 字符串，退回展示原始 market 值
  return label === key ? market.toUpperCase() : label;
}

function buildParsedError(error: unknown): ParsedApiError {
  return getParsedApiError(error);
}

interface ChartTooltipPayloadItem {
  value?: number | string;
  payload?: { date?: string; pe?: number };
}

const ChartTooltip: React.FC<{
  active?: boolean;
  payload?: ChartTooltipPayloadItem[];
  language: UiLanguage;
  t: Translate;
}> = ({ active, payload, language, t }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }
  return (
    <div className="rounded-xl border border-border/70 bg-card/95 px-3 py-2 text-xs shadow-soft-card backdrop-blur">
      <p className="text-secondary-text">{point.date}</p>
      <p className="mt-1 font-semibold text-foreground">
        {t('valuation.tooltip.pe')}: {formatNumber(point.pe, language)}
      </p>
    </div>
  );
};

interface FundPoint {
  year: string;
  marketCap?: number;
  revenue?: number;
}

const FundTooltip: React.FC<{
  active?: boolean;
  payload?: { payload?: FundPoint }[];
  language: UiLanguage;
  unit: string;
  t: Translate;
}> = ({ active, payload, language, unit, t }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }
  return (
    <div className="rounded-xl border border-border/70 bg-card/95 px-3 py-2 text-xs shadow-soft-card backdrop-blur">
      <p className="text-secondary-text">{point.year}</p>
      {typeof point.revenue === 'number' ? (
        <p className="mt-1 font-medium" style={{ color: COLORS.revenue }}>
          {t('valuation.tooltip.revenue')}: {formatNumber(point.revenue, language)} {unit}
        </p>
      ) : null}
      {typeof point.marketCap === 'number' ? (
        <p className="mt-1 font-medium" style={{ color: COLORS.marketCap }}>
          {t('valuation.tooltip.marketCap')}: {formatNumber(point.marketCap, language)} {unit}
        </p>
      ) : null}
    </div>
  );
};

const METRIC_CONFIG: { key: MetricKey; labelKey: UiTextKey; color: string }[] = [
  { key: 'grossMargin', labelKey: 'valuation.metricName.grossMargin', color: '#34d399' },
  { key: 'debtRatio', labelKey: 'valuation.metricName.debtRatio', color: '#f87171' },
  { key: 'dividendYield', labelKey: 'valuation.metricName.dividendYield', color: '#22d3ee' },
  { key: 'roe', labelKey: 'valuation.metricName.roe', color: '#a78bfa' },
  { key: 'deductedNetProfit', labelKey: 'valuation.metricName.deductedNetProfit', color: '#f59e0b' },
  { key: 'freeCashFlow', labelKey: 'valuation.metricName.freeCashFlow', color: '#38bdf8' },
];

const MetricTooltip: React.FC<{
  active?: boolean;
  payload?: { payload?: { year?: string; value?: number } }[];
  color: string;
  unit: string;
  label: string;
  language: UiLanguage;
}> = ({ active, payload, color, unit, label, language }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point || typeof point.value !== 'number') {
    return null;
  }
  return (
    <div className="rounded-xl border border-border/70 bg-card/95 px-3 py-2 text-xs shadow-soft-card backdrop-blur">
      <p className="text-secondary-text">{point.year}</p>
      <p className="mt-1 font-medium" style={{ color }}>
        {label}: {formatNumber(point.value, language, unit === '%' ? 2 : 2)} {unit}
      </p>
    </div>
  );
};

const MetricChart: React.FC<{
  series: MetricSeries;
  color: string;
  label: string;
  amountUnit: string;
  language: UiLanguage;
}> = ({ series, color, label, amountUnit, language }) => {
  const unit = series.unit === '%' ? '%' : amountUnit;
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series.points} margin={{ top: 10, right: 8, bottom: 8, left: 4 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="year"
            type="category"
            tick={{ fill: COLORS.axis, fontSize: 11 }}
            minTickGap={16}
            tickLine={false}
            axisLine={{ stroke: COLORS.grid }}
          />
          <YAxis
            tick={{ fill: COLORS.axis, fontSize: 11 }}
            tickFormatter={(value: number) => formatNumber(value, language, 0)}
            width={48}
            tickLine={false}
            axisLine={{ stroke: COLORS.grid }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
            content={<MetricTooltip color={color} unit={unit} label={label} language={language} />}
          />
          {series.kind === 'bar' ? (
            <Bar dataKey="value" fill={color} maxBarSize={72} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          ) : (
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.8}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

const ValuationPage: React.FC = () => {
  const { language, t } = useUiLanguage();
  const [inputValue, setInputValue] = useState('');
  const [stockName, setStockName] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [metric, setMetric] = useState<ValuationMetric>('pe_ttm');
  const [years, setYears] = useState<number>(20);
  const [data, setData] = useState<PeHistoryResponse | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);

  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const runQuery = useCallback(
    async (code: string, nextMetric: ValuationMetric, nextYears: number) => {
      const trimmed = code.trim();
      if (!trimmed) {
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      setLoading(true);
      setError(null);

      try {
        const [peResult, fundResult, metricsResult] = await Promise.allSettled([
          valuationApi.getPeHistory(
            trimmed,
            { metric: nextMetric, years: nextYears },
            { signal: controller.signal },
          ),
          valuationApi.getFundamentals(
            trimmed,
            { years: nextYears },
            { signal: controller.signal },
          ),
          valuationApi.getMetrics(
            trimmed,
            { years: nextYears },
            { signal: controller.signal },
          ),
        ]);
        if (seq !== requestSeqRef.current) {
          return;
        }
        setFundamentals(fundResult.status === 'fulfilled' ? fundResult.value : null);
        setMetrics(metricsResult.status === 'fulfilled' ? metricsResult.value : null);
        if (peResult.status === 'fulfilled') {
          setData(peResult.value);
        } else {
          throw peResult.reason;
        }
      } catch (err) {
        if (controller.signal.aborted || seq !== requestSeqRef.current) {
          return;
        }
        setError(buildParsedError(err));
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    (code: string, name?: string) => {
      const trimmed = code.trim();
      if (!trimmed) {
        return;
      }
      setStockName(name ?? null);
      setActiveCode(trimmed);
      void runQuery(trimmed, metric, years);
    },
    [metric, years, runQuery],
  );

  const handleMetricChange = useCallback(
    (nextMetric: ValuationMetric) => {
      setMetric(nextMetric);
      if (activeCode) {
        void runQuery(activeCode, nextMetric, years);
      }
    },
    [activeCode, years, runQuery],
  );

  const handleYearsChange = useCallback(
    (nextYears: number) => {
      setYears(nextYears);
      if (activeCode) {
        void runQuery(activeCode, metric, nextYears);
      }
    },
    [activeCode, metric, runQuery],
  );

  const stats = data?.stats ?? null;

  const yDomain = useMemo<[number, number] | undefined>(() => {
    if (!data || !stats || data.series.length === 0) {
      return undefined;
    }
    const lo = Math.min(stats.min, stats.undervalued);
    const hi = Math.max(stats.max, stats.overvalued);
    const pad = Math.max((hi - lo) * 0.05, 0.5);
    return [Math.max(0, lo - pad), hi + pad];
  }, [data, stats]);

  const headerTitle = useMemo(() => {
    if (!data) {
      return null;
    }
    const codeText = data.displayCode || data.code;
    return stockName ? `${stockName} · ${codeText}` : codeText;
  }, [data, stockName]);

  const fundData = useMemo<FundPoint[]>(() => {
    if (!fundamentals) {
      return [];
    }
    // 营收：按年度取值
    const revByYear = new Map<string, number>();
    for (const point of fundamentals.revenue) {
      if (point.year) {
        revByYear.set(point.year, point.value);
      }
    }
    // 总市值：按年取「年末（该年最后一个交易日）」值。marketCap 已按日期升序。
    const capByYear = new Map<string, number>();
    for (const point of fundamentals.marketCap) {
      const year = String(point.date).slice(0, 4);
      if (year) {
        capByYear.set(year, point.value); // 升序遍历，最后写入的即年末值
      }
    }
    const years = Array.from(new Set([...revByYear.keys(), ...capByYear.keys()]))
      .filter((year) => /^\d{4}$/.test(year))
      .sort();
    return years.map((year) => ({
      year,
      revenue: revByYear.get(year),
      marketCap: capByYear.get(year),
    }));
  }, [fundamentals]);

  const fundUnit = useMemo(() => {
    if (!fundamentals) {
      return t('valuation.unitYi');
    }
    return `${fundamentals.unit || '亿'}${fundamentals.currency ? ` ${fundamentals.currency}` : ''}`;
  }, [fundamentals, t]);

  const hasFundData = fundData.some((point) => typeof point.marketCap === 'number' || typeof point.revenue === 'number');

  const chartPanels: ChartPanelSpec[] = [];
  if (data && data.supported && stats) {
    chartPanels.push({
      id: 'pe',
      title: t('valuation.chartTitle'),
      content: (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-secondary-text">
            <LegendItem color={COLORS.pe} label={getMetricLabel(data.metric, t)} />
            <LegendItem color={COLORS.overvalued} label={t('valuation.band.high')} dashed />
            <LegendItem color={COLORS.mean} label={t('valuation.band.mean')} dashed />
            <LegendItem color={COLORS.undervalued} label={t('valuation.band.low')} dashed />
          </div>
          <div className="h-[420px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series} margin={{ top: 10, right: 16, bottom: 8, left: 4 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: COLORS.axis, fontSize: 11 }}
                  tickFormatter={(value: string) => (typeof value === 'string' ? value.slice(0, 4) : String(value))}
                  minTickGap={48}
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={{ stroke: COLORS.grid }}
                />
                <YAxis
                  domain={yDomain ?? ['auto', 'auto']}
                  tick={{ fill: COLORS.axis, fontSize: 11 }}
                  tickFormatter={(value: number) => formatNumber(value, language, 0)}
                  width={48}
                  tickLine={false}
                  axisLine={{ stroke: COLORS.grid }}
                />
                <Tooltip content={<ChartTooltip language={language} t={t} />} />
                <ReferenceLine
                  y={stats.overvalued}
                  stroke={COLORS.overvalued}
                  strokeDasharray="5 4"
                  label={{ value: t('valuation.band.high'), position: 'insideTopRight', fill: COLORS.overvalued, fontSize: 11 }}
                />
                <ReferenceLine
                  y={stats.mean}
                  stroke={COLORS.mean}
                  strokeDasharray="5 4"
                  label={{ value: t('valuation.band.mean'), position: 'insideTopRight', fill: COLORS.mean, fontSize: 11 }}
                />
                <ReferenceLine
                  y={stats.undervalued}
                  stroke={COLORS.undervalued}
                  strokeDasharray="5 4"
                  label={{ value: t('valuation.band.low'), position: 'insideBottomRight', fill: COLORS.undervalued, fontSize: 11 }}
                />
                <Line
                  type="monotone"
                  dataKey="pe"
                  stroke={COLORS.pe}
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-secondary-text">{t('valuation.chartFootnote')}</p>
        </>
      ),
    });
  }
  if (fundamentals && fundamentals.supported && hasFundData) {
    chartPanels.push({
      id: 'fund',
      title: t('valuation.fundTitle'),
      content: (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-secondary-text">
            <LegendItem color={COLORS.revenue} label={t('valuation.legend.revenue')} filled />
            <LegendItem color={COLORS.marketCap} label={t('valuation.legend.marketCap')} />
            <span>· {t('valuation.unitLabel', { unit: fundUnit })}</span>
          </div>
          <div className="h-[420px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={fundData} margin={{ top: 10, right: 8, bottom: 8, left: 4 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis
                  dataKey="year"
                  type="category"
                  tick={{ fill: COLORS.axis, fontSize: 11 }}
                  minTickGap={16}
                  tickLine={false}
                  axisLine={{ stroke: COLORS.grid }}
                />
                <YAxis
                  yAxisId="revenue"
                  orientation="left"
                  tick={{ fill: COLORS.revenue, fontSize: 11 }}
                  tickFormatter={(value: number) => formatNumber(value, language, 0)}
                  width={52}
                  tickLine={false}
                  axisLine={{ stroke: COLORS.grid }}
                />
                <YAxis
                  yAxisId="cap"
                  orientation="right"
                  tick={{ fill: COLORS.marketCap, fontSize: 11 }}
                  tickFormatter={(value: number) => formatNumber(value, language, 0)}
                  width={56}
                  tickLine={false}
                  axisLine={{ stroke: COLORS.grid }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                  content={<FundTooltip language={language} unit={fundUnit} t={t} />}
                />
                <Bar
                  yAxisId="revenue"
                  dataKey="revenue"
                  fill={COLORS.revenue}
                  maxBarSize={72}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="cap"
                  type="monotone"
                  dataKey="marketCap"
                  stroke={COLORS.marketCap}
                  strokeWidth={1.8}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-secondary-text">{t('valuation.fundFootnote')}</p>
        </>
      ),
    });
  }
  if (metrics && metrics.supported) {
    const amountUnit = `${'亿'}${metrics.currency ? ` ${metrics.currency}` : ''}`;
    for (const cfg of METRIC_CONFIG) {
      const series = metrics.metrics[cfg.key];
      if (!series || series.points.length === 0) {
        continue;
      }
      const label = t(cfg.labelKey);
      const unitText = series.unit === '%' ? '%' : amountUnit;
      chartPanels.push({
        id: `metric:${cfg.key}`,
        title: label,
        defaultSpan: 1,
        content: (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary-text">
              <LegendItem color={cfg.color} label={label} filled={series.kind === 'bar'} />
              <span>· {t('valuation.unitLabel', { unit: unitText })}</span>
            </div>
            <MetricChart series={series} color={cfg.color} label={label} amountUnit={amountUnit} language={language} />
          </>
        ),
      });
    }
  }

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader
          eyebrow={t('valuation.eyebrow')}
          title={t('valuation.title')}
          description={t('valuation.description')}
        />

        <Card className="rounded-2xl" padding="md">
          <label className="label-uppercase" htmlFor="valuation-search">
            {t('valuation.searchLabel')}
          </label>
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex-1">
              <StockAutocomplete
                value={inputValue}
                onChange={setInputValue}
                onSubmit={(code, name) => handleSubmit(code, name)}
                placeholder={t('valuation.searchPlaceholder')}
                ariaLabel={t('valuation.searchLabel')}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-border/70 bg-card/70 p-1">
                {METRIC_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleMetricChange(option)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm transition-colors',
                      metric === option
                        ? 'bg-cyan text-background shadow-soft-card'
                        : 'text-secondary-text hover:bg-hover hover:text-foreground',
                    )}
                  >
                    {getMetricLabel(option, t)}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-xl border border-border/70 bg-card/70 p-1">
                {YEAR_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleYearsChange(option)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm transition-colors',
                      years === option
                        ? 'bg-cyan text-background shadow-soft-card'
                        : 'text-secondary-text hover:bg-hover hover:text-foreground',
                    )}
                  >
                    {t('valuation.rangeYears', { years: option })}
                  </button>
                ))}
              </div>
              {activeCode ? (
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2"
                  onClick={() => void runQuery(activeCode, metric, years)}
                  disabled={loading}
                >
                  <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
                  {t('valuation.refresh')}
                </button>
              ) : null}
            </div>
          </div>
        </Card>

        {error ? (
          <ApiErrorAlert
            error={error}
            actionLabel={t('common.retry')}
            onAction={() => (activeCode ? void runQuery(activeCode, metric, years) : undefined)}
          />
        ) : null}

        {loading ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-2xl border border-border/70 bg-card/60" />
              ))}
            </div>
            <div className="h-[420px] animate-pulse rounded-2xl border border-border/70 bg-card/60" />
          </div>
        ) : null}

        {!loading && !activeCode ? (
          <EmptyState
            title={t('valuation.emptyTitle')}
            description={t('valuation.emptyDescription')}
            icon={<TrendingUp className="h-8 w-8" />}
          />
        ) : null}

        {!loading && data && !data.supported ? (
          <EmptyState
            title={t('valuation.unsupportedTitle')}
            description={t('valuation.unsupported', { market: getMarketLabel(data.market, t) })}
            icon={<LineChartIcon className="h-8 w-8" />}
          />
        ) : null}

        {!loading && data && data.supported && !stats ? (
          <EmptyState
            title={t('valuation.noDataTitle')}
            description={data.message ?? t('valuation.noDataDescription')}
            icon={<LineChartIcon className="h-8 w-8" />}
          />
        ) : null}

        {!loading && data && data.supported && stats ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{headerTitle}</h2>
                <p className="mt-1 text-sm text-secondary-text">
                  {t('valuation.chartSubtitle', {
                    metric: getMetricLabel(data.metric, t),
                    from: data.series[0]?.date ?? '-',
                    to: stats.currentDate,
                    count: stats.count,
                  })}
                </p>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium',
                  ZONE_BADGE_CLASS[stats.zone],
                )}
              >
                {t('valuation.zoneLabel')}: {t(`valuation.zone.${stats.zone}` as UiTextKey)}
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t('valuation.stat.current')}
                value={formatNumber(stats.current, language)}
                hint={stats.currentDate}
                tone={ZONE_TONE[stats.zone]}
                icon={<TrendingUp className="h-5 w-5" />}
              />
              <StatCard label={t('valuation.stat.overvalued')} value={formatNumber(stats.overvalued, language)} hint={t('valuation.stat.overvaluedHint')} tone="danger" />
              <StatCard label={t('valuation.stat.mean')} value={formatNumber(stats.mean, language)} hint={t('valuation.stat.meanHint', { std: formatNumber(stats.std, language) })} tone="primary" />
              <StatCard label={t('valuation.stat.undervalued')} value={formatNumber(stats.undervalued, language)} hint={t('valuation.stat.undervaluedHint')} tone="success" />
            </div>
          </div>
        ) : null}

        {!loading && chartPanels.length > 0 ? (
          <DraggableChartGrid
            panels={chartPanels}
            storageKey="valuation"
            labels={{
              half: t('valuation.layout.half'),
              full: t('valuation.layout.full'),
              dragHint: t('valuation.layout.dragHint'),
            }}
          />
        ) : null}
      </div>
    </AppPage>
  );
};

const LegendItem: React.FC<{ color: string; label: string; dashed?: boolean; filled?: boolean }> = ({
  color,
  label,
  dashed,
  filled,
}) => (
  <span className="inline-flex items-center gap-2">
    {filled ? (
      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
    ) : (
      <span
        className="inline-block h-0 w-5 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
      />
    )}
    {label}
  </span>
);

export default ValuationPage;
