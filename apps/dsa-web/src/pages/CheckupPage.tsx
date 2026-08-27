import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Stethoscope,
  TrendingUp,
  LineChart as LineChartIcon,
  FileText,
  CalendarClock,
  Lock,
  Coins,
  ChevronRight,
} from 'lucide-react';
import {
  valuationApi,
  type FundamentalsResponse,
  type MetricKey,
  type MetricsResponse,
  type PeHistoryResponse,
  type SegmentRevenueResponse,
} from '../api/valuation';
import { checkupApi, type CheckupEventsResponse, type EventItem } from '../api/checkup';
import { AppPage, Card, EmptyState, PageHeader } from '../components/common';
import { PeChart, FundChart } from '../components/valuation/charts';
import { SegmentRevenueChart } from '../components/valuation/SegmentRevenueChart';
import { LeadersPanel } from '../components/valuation/LeadersPanel';
import { MilestoneTimeline } from '../components/valuation/MilestoneTimeline';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { buildFundData, fmtNumber, fundHasData } from '../components/valuation/chartUtils';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type { UiLanguage, UiTextKey, UiTextParams } from '../i18n/uiText';
import { cn } from '../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const ZONE_BADGE: Record<string, string> = {
  high: 'border-danger/30 bg-danger/10 text-danger',
  fair: 'border-warning/30 bg-warning/10 text-warning',
  low: 'border-success/30 bg-success/10 text-success',
};

const QUALITY_KEYS: MetricKey[] = ['roe', 'grossMargin', 'debtRatio', 'dividendYield'];

const SectionCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  source?: string;
  detailTo?: string;
  detailLabel?: string;
  children: React.ReactNode;
}> = ({ icon, title, source, detailTo, detailLabel, children }) => (
  <Card className="rounded-2xl" padding="md">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-cyan">{icon}</span>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <div className="flex items-center gap-3">
        {source ? <span className="text-[0.7rem] text-secondary-text/70">{source}</span> : null}
        {detailTo ? (
          <Link to={detailTo} className="inline-flex items-center gap-0.5 text-xs text-cyan hover:underline">
            {detailLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    </div>
    {children}
  </Card>
);

const EVENT_META: Record<string, { icon: React.FC<{ className?: string }>; tone: string }> = {
  unlock: { icon: Lock, tone: 'border-warning/40 bg-warning/10 text-warning' },
  exright: { icon: Coins, tone: 'border-cyan/40 bg-cyan/10 text-cyan' },
  other: { icon: CalendarClock, tone: 'border-border/60 bg-card/60 text-secondary-text' },
};

const EventsView: React.FC<{ events: EventItem[]; t: Translate }> = ({ events, t }) => {
  if (events.length === 0) {
    return <p className="text-sm text-secondary-text">{t('checkup.noEvents')}</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((e, i) => {
        const meta = EVENT_META[e.type] ?? EVENT_META.other;
        const Icon = meta.icon;
        return (
          <li key={`${e.date}-${i}`} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/50 px-3 py-2">
            <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', meta.tone)}>
              <Icon className="h-3 w-3" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <time className="text-xs font-semibold text-cyan">{e.date}</time>
                <span className="text-sm font-medium text-foreground">{e.title}</span>
              </div>
              {e.detail ? <p className="text-xs text-secondary-text">{e.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

const CheckupPage: React.FC = () => {
  const { language, t } = useUiLanguage() as { language: UiLanguage; t: Translate };
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCode = searchParams.get('code') ?? '';
  const [inputValue, setInputValue] = useState(initialCode);
  const [activeCode, setActiveCode] = useState<string | null>(initialCode || null);
  const [stockName, setStockName] = useState<string | null>(null);
  const [pe, setPe] = useState<PeHistoryResponse | null>(null);
  const [fund, setFund] = useState<FundamentalsResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [segment, setSegment] = useState<SegmentRevenueResponse | null>(null);
  const [events, setEvents] = useState<CheckupEventsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const initedRef = useRef(false);

  const runQuery = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoading(true);
    const opts = { signal: controller.signal };
    const [peR, fundR, metricsR, segR, evR] = await Promise.allSettled([
      valuationApi.getPeHistory(trimmed, { years: 20 }, opts),
      valuationApi.getFundamentals(trimmed, { years: 20 }, opts),
      valuationApi.getMetrics(trimmed, { years: 20 }, opts),
      valuationApi.getSegmentRevenue(trimmed, { years: 20 }, opts),
      checkupApi.getEvents(trimmed, opts),
    ]);
    if (seq !== seqRef.current) {
      return;
    }
    setPe(peR.status === 'fulfilled' ? peR.value : null);
    setFund(fundR.status === 'fulfilled' ? fundR.value : null);
    setMetrics(metricsR.status === 'fulfilled' ? metricsR.value : null);
    setSegment(segR.status === 'fulfilled' ? segR.value : null);
    setEvents(evR.status === 'fulfilled' ? evR.value : null);
    setLoading(false);
  }, []);

  const handleSubmit = useCallback(
    (code: string, name?: string) => {
      const trimmed = code.trim();
      if (!trimmed) {
        return;
      }
      setActiveCode(trimmed);
      setStockName(name ?? null);
      setSearchParams({ code: trimmed });
      void runQuery(trimmed);
    },
    [runQuery, setSearchParams],
  );

  useEffect(() => {
    if (initedRef.current || !initialCode) {
      return undefined;
    }
    initedRef.current = true;
    // 延后到下一个宏任务再触发查询，避免在 effect 同步体内间接 setState。
    const id = window.setTimeout(() => {
      void runQuery(initialCode);
    }, 0);
    return () => window.clearTimeout(id);
  }, [initialCode, runQuery]);

  const dashCode = pe?.code ?? metrics?.code ?? activeCode ?? '';
  const dashDisplay = pe?.displayCode ?? metrics?.displayCode ?? activeCode ?? '';
  const valuationLink = `/valuation?code=${encodeURIComponent(dashDisplay || dashCode)}`;
  const filingsLink = `/filings?code=${encodeURIComponent(dashDisplay || dashCode)}`;

  const marketCapText = useMemo(() => {
    const last = fund?.marketCap?.[fund.marketCap.length - 1];
    return last ? `${fmtNumber(last.value, language, 0)} ${t('valuation.unitYi')}` : '—';
  }, [fund, language, t]);

  const fundData = useMemo(() => buildFundData(fund), [fund]);

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader eyebrow={t('checkup.eyebrow')} title={t('checkup.title')} description={t('checkup.description')} />

        <Card className="rounded-2xl" padding="md">
          <label className="label-uppercase" htmlFor="checkup-search">
            {t('checkup.searchLabel')}
          </label>
          <div className="mt-2">
            <StockAutocomplete
              value={inputValue}
              onChange={setInputValue}
              onSubmit={(code, name) => handleSubmit(code, name)}
              placeholder={t('checkup.searchPlaceholder')}
              ariaLabel={t('checkup.searchLabel')}
            />
          </div>
        </Card>

        {!activeCode ? (
          <EmptyState
            title={t('checkup.emptyTitle')}
            description={t('checkup.emptyDesc')}
            icon={<Stethoscope className="h-8 w-8" />}
          />
        ) : (
          <div className="space-y-4">
            {/* 公司概览 */}
            <SectionCard icon={<Stethoscope className="h-5 w-5" />} title={t('checkup.section.overview')} source={t('checkup.source.market')}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div>
                  <p className="text-xs text-secondary-text">{t('checkup.name')}</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {stockName ? `${stockName} · ` : ''}{dashDisplay || dashCode || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-secondary-text">{t('checkup.currentPe')}</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {pe?.stats ? fmtNumber(pe.stats.current, language) : '—'}
                    {pe?.stats ? (
                      <span className={cn('ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs', ZONE_BADGE[pe.stats.zone])}>
                        {t(`valuation.zone.${pe.stats.zone}` as UiTextKey)}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-secondary-text">{t('checkup.marketCap')}</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{marketCapText}</p>
                </div>
              </div>
            </SectionCard>

            {/* 估值分位 */}
            <SectionCard
              icon={<TrendingUp className="h-5 w-5" />}
              title={t('checkup.section.valuation')}
              source={t('checkup.source.baidu')}
              detailTo={valuationLink}
              detailLabel={t('checkup.viewDetail')}
            >
              {pe && pe.supported && pe.stats ? (
                <div className="h-[240px]">
                  <PeChart data={pe} language={language} t={t} />
                </div>
              ) : (
                <p className="text-sm text-secondary-text">{t('checkup.blockNoData')}</p>
              )}
            </SectionCard>

            {/* 十年财务概览 */}
            <SectionCard
              icon={<LineChartIcon className="h-5 w-5" />}
              title={t('checkup.section.finance')}
              source={t('checkup.source.mixed')}
              detailTo={valuationLink}
              detailLabel={t('checkup.viewDetail')}
            >
              {fund && fund.supported && fundHasData(fundData) ? (
                <div className="h-[260px]">
                  <FundChart fundamentals={fund} language={language} t={t} />
                </div>
              ) : (
                <p className="text-sm text-secondary-text">{t('checkup.blockNoData')}</p>
              )}
            </SectionCard>

            {/* 盈利质量 */}
            <SectionCard
              icon={<TrendingUp className="h-5 w-5" />}
              title={t('checkup.section.quality')}
              source={t('checkup.source.ths')}
              detailTo={valuationLink}
              detailLabel={t('checkup.viewDetail')}
            >
              {metrics && metrics.supported ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {QUALITY_KEYS.map((key) => {
                    const series = metrics.metrics[key];
                    const last = series?.points?.[series.points.length - 1];
                    return (
                      <div key={key} className="rounded-xl border border-border/60 bg-card/50 px-3 py-2">
                        <p className="text-xs text-secondary-text">{t(`valuation.metricName.${key}` as UiTextKey)}</p>
                        <p className="mt-1 text-lg font-semibold text-foreground">
                          {last ? `${fmtNumber(last.value, language, 2)}%` : '—'}
                        </p>
                        {last ? <p className="text-[0.7rem] text-secondary-text/70">{last.year}</p> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-secondary-text">{t('checkup.blockNoData')}</p>
              )}
            </SectionCard>

            {/* 分部收入 */}
            <SectionCard
              icon={<LineChartIcon className="h-5 w-5" />}
              title={t('checkup.section.segment')}
              source={t('checkup.source.em')}
              detailTo={valuationLink}
              detailLabel={t('checkup.viewDetail')}
            >
              {segment && segment.supported && segment.points.length > 0 ? (
                <SegmentRevenueChart data={segment} language={language} t={t} />
              ) : (
                <p className="text-sm text-secondary-text">{segment?.message ?? t('checkup.blockNoData')}</p>
              )}
            </SectionCard>

            {/* 未来大事 */}
            <SectionCard icon={<CalendarClock className="h-5 w-5" />} title={t('checkup.section.events')} source={t('checkup.source.events')}>
              {events && events.supported ? (
                <EventsView events={events.events} t={t} />
              ) : (
                <p className="text-sm text-secondary-text">{events?.message ?? t('checkup.blockNoData')}</p>
              )}
            </SectionCard>

            {/* 财报原文入口 */}
            <SectionCard
              icon={<FileText className="h-5 w-5" />}
              title={t('checkup.section.filings')}
              detailTo={filingsLink}
              detailLabel={t('checkup.viewFilings')}
            >
              <p className="text-sm text-secondary-text">{t('checkup.filingsHint')}</p>
            </SectionCard>

            {/* 管理层（AI 整理，默认折叠） */}
            <details className="group rounded-2xl border border-border/60 bg-card/40 p-2">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-foreground">
                {t('checkup.section.leaders')}
                <span className="ml-2 text-[0.7rem] font-normal text-secondary-text/70">{t('checkup.aiTag')}</span>
              </summary>
              <div className="mt-2">
                <LeadersPanel code={dashCode} displayCode={dashDisplay} name={stockName} />
              </div>
            </details>

            {/* 里程碑（AI 整理，默认折叠） */}
            <details className="group rounded-2xl border border-border/60 bg-card/40 p-2">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-foreground">
                {t('checkup.section.milestones')}
                <span className="ml-2 text-[0.7rem] font-normal text-secondary-text/70">{t('checkup.aiTag')}</span>
              </summary>
              <div className="mt-2">
                <MilestoneTimeline code={dashCode} displayCode={dashDisplay} name={stockName} />
              </div>
            </details>

            <p className="pt-1 text-xs text-secondary-text/70">{t('checkup.disclaimer')}</p>
            {loading ? <p className="text-xs text-secondary-text/60">{t('checkup.loading')}</p> : null}
          </div>
        )}
      </div>
    </AppPage>
  );
};

export default CheckupPage;
