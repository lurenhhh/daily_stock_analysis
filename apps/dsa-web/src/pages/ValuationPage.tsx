import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, FileText, LineChart as LineChartIcon, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import {
  valuationApi,
  type FundamentalsResponse,
  type MetricsResponse,
  type PeHistoryResponse,
  type SegmentRevenueResponse,
  type ValuationMetric,
  type ValuationZone,
} from '../api/valuation';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { ApiErrorAlert, AppPage, Card, EmptyState, PageHeader, StatCard } from '../components/common';
import { DraggableChartGrid, type ChartPanelSpec } from '../components/common/DraggableChartGrid';
import { DcfCalculator } from '../components/valuation/DcfCalculator';
import { MilestoneTimeline } from '../components/valuation/MilestoneTimeline';
import { LeadersPanel } from '../components/valuation/LeadersPanel';
import { FundChart, MetricChartView, PeChart } from '../components/valuation/charts';
import { SegmentRevenueChart } from '../components/valuation/SegmentRevenueChart';
import {
  METRIC_CONFIG,
  buildFundData,
  fmtNumber,
  fundHasData,
  getPeMetricLabel,
} from '../components/valuation/chartUtils';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../i18n/uiText';
import {
  addDashboardItem,
  isInDashboard,
  loadDashboardItems,
  type DashboardChartKind,
} from '../utils/myDashboard';
import { cn } from '../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const METRIC_OPTIONS: ValuationMetric[] = ['pe_ttm', 'pe'];
const YEAR_OPTIONS = [10, 20] as const;

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

function getMarketLabel(market: string, t: Translate): string {
  const key = `valuation.market.${market}` as UiTextKey;
  const label = t(key);
  return label === key ? market.toUpperCase() : label;
}

const AddToDashboardButton: React.FC<{
  code: string;
  displayCode: string;
  name: string | null;
  chart: DashboardChartKind;
  metric?: ValuationMetric;
  years: number;
  t: Translate;
}> = ({ code, displayCode, name, chart, metric, years, t }) => {
  const [added, setAdded] = useState(() => isInDashboard(loadDashboardItems(), code, chart, metric));

  const handleClick = () => {
    addDashboardItem({ code, displayCode, name, chart, metric, years });
    setAdded(true);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={added}
      title={added ? t('valuation.added') : t('valuation.addToDashboard')}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors',
        added
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-border/70 bg-card/70 text-secondary-text hover:bg-hover hover:text-foreground',
      )}
    >
      {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      {added ? t('valuation.added') : t('valuation.addToDashboard')}
    </button>
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
  const [segments, setSegments] = useState<SegmentRevenueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);

  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const runQuery = useCallback(async (code: string, nextMetric: ValuationMetric, nextYears: number) => {
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
      const [peResult, fundResult, metricsResult, segResult] = await Promise.allSettled([
        valuationApi.getPeHistory(trimmed, { metric: nextMetric, years: nextYears }, { signal: controller.signal }),
        valuationApi.getFundamentals(trimmed, { years: nextYears }, { signal: controller.signal }),
        valuationApi.getMetrics(trimmed, { years: nextYears }, { signal: controller.signal }),
        valuationApi.getSegmentRevenue(trimmed, { years: nextYears }, { signal: controller.signal }),
      ]);
      if (seq !== requestSeqRef.current) {
        return;
      }
      setFundamentals(fundResult.status === 'fulfilled' ? fundResult.value : null);
      setMetrics(metricsResult.status === 'fulfilled' ? metricsResult.value : null);
      setSegments(segResult.status === 'fulfilled' ? segResult.value : null);
      if (peResult.status === 'fulfilled') {
        setData(peResult.value);
      } else {
        throw peResult.reason;
      }
    } catch (err) {
      if (controller.signal.aborted || seq !== requestSeqRef.current) {
        return;
      }
      setError(getParsedApiError(err));
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

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

  const [searchParams] = useSearchParams();
  const deepLinkRef = useRef(false);
  useEffect(() => {
    if (deepLinkRef.current) {
      return;
    }
    deepLinkRef.current = true;
    const qCode = searchParams.get('code');
    if (qCode) {
      setInputValue(qCode);
      handleSubmit(qCode);
    }
  }, [searchParams, handleSubmit]);

  const stats = data?.stats ?? null;

  const headerTitle = useMemo(() => {
    if (!data) {
      return null;
    }
    const codeText = data.displayCode || data.code;
    return stockName ? `${stockName} · ${codeText}` : codeText;
  }, [data, stockName]);

  const fundData = useMemo(() => buildFundData(fundamentals), [fundamentals]);
  const hasFundData = fundHasData(fundData);

  const dashCode = data?.code ?? fundamentals?.code ?? metrics?.code ?? activeCode ?? '';
  const dashDisplay = data?.displayCode ?? fundamentals?.displayCode ?? metrics?.displayCode ?? activeCode ?? '';

  const chartPanels: ChartPanelSpec[] = [];
  if (data && data.supported && stats) {
    chartPanels.push({
      id: 'pe',
      title: t('valuation.chartTitle'),
      actions: (
        <AddToDashboardButton
          code={dashCode}
          displayCode={dashDisplay}
          name={stockName}
          chart="pe"
          metric={data.metric}
          years={years}
          t={t}
        />
      ),
      content: <PeChart data={data} language={language} t={t} />,
    });
  }
  if (fundamentals && fundamentals.supported && hasFundData) {
    chartPanels.push({
      id: 'fund',
      title: t('valuation.fundTitle'),
      actions: (
        <AddToDashboardButton
          code={dashCode}
          displayCode={dashDisplay}
          name={stockName}
          chart="fund"
          years={years}
          t={t}
        />
      ),
      content: <FundChart fundamentals={fundamentals} language={language} t={t} />,
    });
  }
  if (metrics && metrics.supported) {
    for (const cfg of METRIC_CONFIG) {
      const series = metrics.metrics[cfg.key];
      if (!series || series.points.length === 0) {
        continue;
      }
      chartPanels.push({
        id: `metric:${cfg.key}`,
        title: t(cfg.labelKey),
        defaultSpan: 1,
        actions: (
          <AddToDashboardButton
            code={dashCode}
            displayCode={dashDisplay}
            name={stockName}
            chart={cfg.key}
            years={years}
            t={t}
          />
        ),
        content: (
          <MetricChartView metricKey={cfg.key} series={series} currency={metrics.currency} language={language} t={t} />
        ),
      });
    }
  }
  if (segments && segments.supported && segments.points.length > 0) {
    chartPanels.push({
      id: 'segment',
      title: t('valuation.segmentTitle'),
      defaultSpan: 2,
      content: <SegmentRevenueChart data={segments} language={language} t={t} />,
    });
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
                    {getPeMetricLabel(option, t)}
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
              {activeCode ? (
                <Link
                  to={`/filings?code=${encodeURIComponent(activeCode)}`}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  <FileText className="h-4 w-4" />
                  {t('valuation.viewFilings')}
                </Link>
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
                    metric: getPeMetricLabel(data.metric, t),
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
                value={fmtNumber(stats.current, language)}
                hint={stats.currentDate}
                tone={ZONE_TONE[stats.zone]}
                icon={<TrendingUp className="h-5 w-5" />}
              />
              <StatCard label={t('valuation.stat.overvalued')} value={fmtNumber(stats.overvalued, language)} hint={t('valuation.stat.overvaluedHint')} tone="danger" />
              <StatCard label={t('valuation.stat.mean')} value={fmtNumber(stats.mean, language)} hint={t('valuation.stat.meanHint', { std: fmtNumber(stats.std, language) })} tone="primary" />
              <StatCard label={t('valuation.stat.undervalued')} value={fmtNumber(stats.undervalued, language)} hint={t('valuation.stat.undervaluedHint')} tone="success" />
            </div>
          </div>
        ) : null}

        {!loading && data && data.supported ? (
          <DcfCalculator code={dashCode} displayCode={dashDisplay} name={stockName} />
        ) : null}

        {!loading && data && data.supported ? (
          <MilestoneTimeline code={dashCode} displayCode={dashDisplay} name={stockName} />
        ) : null}

        {!loading && data && data.supported ? (
          <LeadersPanel code={dashCode} displayCode={dashDisplay} name={stockName} />
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

export default ValuationPage;
