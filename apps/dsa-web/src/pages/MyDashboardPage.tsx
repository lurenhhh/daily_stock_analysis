import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  valuationApi,
  type FundamentalsResponse,
  type MetricKey,
  type MetricsResponse,
  type PeHistoryResponse,
} from '../api/valuation';
import { AppPage, PageHeader } from '../components/common';
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
import { AccountPanel } from '../components/account/AccountPanel';
import { TemplateGallery } from '../components/dashboard/TemplateGallery';
import { TemplateDetail } from '../components/dashboard/TemplateDetail';
import { ApplyTemplateModal } from '../components/dashboard/ApplyTemplateModal';
import type { LensTemplate } from '../data/lensTemplates';
import type { ApplyResult } from '../utils/applyLensTemplate';

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
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [viewingTemplate, setViewingTemplate] = useState<LensTemplate | null>(null);
  const [applyingTemplate, setApplyingTemplate] = useState<LensTemplate | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);

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

  // 应用模版后的轻提示，自动消失。
  useEffect(() => {
    if (!applied) {
      return undefined;
    }
    const timer = window.setTimeout(() => setApplied(null), 4000);
    return () => window.clearTimeout(timer);
  }, [applied]);

  const handleView = (tpl: LensTemplate) => {
    setGalleryOpen(false);
    setViewingTemplate(tpl);
  };
  const handleApply = (tpl: LensTemplate) => {
    setGalleryOpen(false);
    setViewingTemplate(null);
    setApplyingTemplate(tpl);
  };
  const handleApplied = (result: ApplyResult) => {
    setApplyingTemplate(null);
    setGalleryOpen(false);
    setApplied(result);
  };

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
              <>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2"
                  onClick={() => setGalleryOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  {t('myDashboard.templates.addFromTemplate')}
                </button>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2"
                  onClick={() => setReloadKey((key) => key + 1)}
                  disabled={loading}
                >
                  <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
                  {t('myDashboard.refresh')}
                </button>
              </>
            ) : undefined
          }
        />

        <AccountPanel />

        {items.length === 0 ? (
          <TemplateGallery onApply={handleApply} onView={handleView} />
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

        {galleryOpen ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setGalleryOpen(false)} aria-hidden="true" />
            <div className="relative z-10 my-8 w-full max-w-4xl rounded-2xl border border-border/70 bg-card/95 p-5 shadow-2xl">
              <button
                type="button"
                onClick={() => setGalleryOpen(false)}
                className="absolute right-3 top-3 rounded-lg p-1 text-secondary-text transition-colors hover:bg-hover hover:text-foreground"
                aria-label="close"
              >
                <X className="h-4 w-4" />
              </button>
              <TemplateGallery onApply={handleApply} onView={handleView} />
            </div>
          </div>
        ) : null}

        <TemplateDetail template={viewingTemplate} onClose={() => setViewingTemplate(null)} onApply={handleApply} />
        <ApplyTemplateModal key={applyingTemplate?.id ?? 'none'} template={applyingTemplate} onClose={() => setApplyingTemplate(null)} onApplied={handleApplied} />

        {applied ? (
          <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-cyan/40 bg-card/95 px-4 py-2 text-sm text-foreground shadow-2xl">
            {t('myDashboard.templates.applied', { added: applied.added, skipped: applied.skipped })}
          </div>
        ) : null}
      </div>
    </AppPage>
  );
};

export default MyDashboardPage;
