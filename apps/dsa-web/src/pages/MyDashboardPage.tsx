import React, { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, RefreshCw, Trash2 } from 'lucide-react';
import {
  valuationApi,
  type FundamentalsResponse,
  type MetricKey,
  type MetricsResponse,
  type PeHistoryResponse,
} from '../api/valuation';
import { AppPage, EmptyState, PageHeader } from '../components/common';
import { DraggableChartGrid, type ChartPanelSpec } from '../components/common/DraggableChartGrid';
import { FundChart, MetricChartView, PeChart } from '../components/valuation/charts';
import {
  METRIC_CONFIG_BY_KEY,
  buildFundData,
  fundHasData,
  getPeMetricLabel,
} from '../components/valuation/chartUtils';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../i18n/uiText';
import {
  MY_DASHBOARD_CHANGED_EVENT,
  loadDashboardItems,
  removeDashboardItem,
  type DashboardItem,
} from '../utils/myDashboard';
import { cn } from '../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

interface ItemData {
  pe?: PeHistoryResponse;
  fund?: FundamentalsResponse;
  metrics?: MetricsResponse;
  error?: boolean;
}

function chartLabel(item: DashboardItem, t: Translate): string {
  if (item.chart === 'pe') {
    return getPeMetricLabel(item.metric ?? 'pe_ttm', t);
  }
  if (item.chart === 'fund') {
    return t('valuation.fundTitle');
  }
  const cfg = METRIC_CONFIG_BY_KEY[item.chart as MetricKey];
  return cfg ? t(cfg.labelKey) : item.chart;
}

const NoData: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex h-[240px] items-center justify-center text-sm text-secondary-text">{text}</div>
);

const Skeleton: React.FC = () => (
  <div className="h-[300px] w-full animate-pulse rounded-xl border border-border/60 bg-card/50" />
);

const MyDashboardPage: React.FC = () => {
  const { language, t } = useUiLanguage();
  const [items, setItems] = useState<DashboardItem[]>(() => loadDashboardItems());
  const [dataById, setDataById] = useState<Record<string, ItemData>>({});
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 监听看板变更（来自估值页「加入看板」或本页「移除」）
  useEffect(() => {
    const handler = () => setItems(loadDashboardItems());
    window.addEventListener(MY_DASHBOARD_CHANGED_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(MY_DASHBOARD_CHANGED_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const itemsKey = useMemo(
    () => items.map((item) => `${item.id}:${item.code}:${item.chart}:${item.metric ?? ''}:${item.years}`).join('|'),
    [items],
  );

  useEffect(() => {
    if (items.length === 0) {
      setDataById({});
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      const entries = await Promise.all(
        items.map(async (item): Promise<[string, ItemData]> => {
          try {
            if (item.chart === 'pe') {
              const pe = await valuationApi.getPeHistory(
                item.code,
                { metric: item.metric, years: item.years },
                { signal: controller.signal },
              );
              return [item.id, { pe }];
            }
            if (item.chart === 'fund') {
              const fund = await valuationApi.getFundamentals(
                item.code,
                { years: item.years },
                { signal: controller.signal },
              );
              return [item.id, { fund }];
            }
            const metrics = await valuationApi.getMetrics(
              item.code,
              { years: item.years },
              { signal: controller.signal },
            );
            return [item.id, { metrics }];
          } catch {
            return [item.id, { error: true }];
          }
        }),
      );
      if (!cancelled) {
        setDataById(Object.fromEntries(entries));
        setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 itemsKey/reloadKey 作为稳定触发条件
  }, [itemsKey, reloadKey]);

  const panels: ChartPanelSpec[] = items.map((item) => {
    const entry = dataById[item.id];
    const label = chartLabel(item, t);
    const title = `${item.name ? `${item.name} · ` : ''}${item.displayCode} · ${label}`;

    let content: React.ReactNode;
    if (!entry) {
      content = <Skeleton />;
    } else if (entry.error) {
      content = <NoData text={t('myDashboard.itemError')} />;
    } else if (item.chart === 'pe') {
      content = entry.pe && entry.pe.supported && entry.pe.stats
        ? <PeChart data={entry.pe} language={language} t={t} />
        : <NoData text={t('myDashboard.itemNoData')} />;
    } else if (item.chart === 'fund') {
      content = entry.fund && entry.fund.supported && fundHasData(buildFundData(entry.fund))
        ? <FundChart fundamentals={entry.fund} language={language} t={t} />
        : <NoData text={t('myDashboard.itemNoData')} />;
    } else {
      const series = entry.metrics?.metrics[item.chart as MetricKey];
      content = series && series.points.length > 0
        ? (
          <MetricChartView
            metricKey={item.chart as MetricKey}
            series={series}
            currency={entry.metrics?.currency ?? ''}
            language={language}
            t={t}
          />
        )
        : <NoData text={t('myDashboard.itemNoData')} />;
    }

    return {
      id: item.id,
      title,
      defaultSpan: item.chart === 'pe' || item.chart === 'fund' ? 2 : 1,
      actions: (
        <button
          type="button"
          onClick={() => removeDashboardItem(item.id)}
          title={t('myDashboard.remove')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-card/70 px-2.5 py-1 text-xs text-secondary-text transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('myDashboard.remove')}
        </button>
      ),
      content,
    };
  });

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader
          eyebrow={t('myDashboard.eyebrow')}
          title={t('myDashboard.title')}
          description={t('myDashboard.description')}
          actions={
            items.length > 0 ? (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => setReloadKey((key) => key + 1)}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
                {t('myDashboard.refresh')}
              </button>
            ) : undefined
          }
        />

        {items.length === 0 ? (
          <EmptyState
            title={t('myDashboard.emptyTitle')}
            description={t('myDashboard.emptyDescription')}
            icon={<LayoutDashboard className="h-8 w-8" />}
          />
        ) : (
          <DraggableChartGrid
            panels={panels}
            storageKey="myDashboard"
            labels={{
              half: t('valuation.layout.half'),
              full: t('valuation.layout.full'),
              dragHint: t('valuation.layout.dragHint'),
            }}
          />
        )}
      </div>
    </AppPage>
  );
};

export default MyDashboardPage;
