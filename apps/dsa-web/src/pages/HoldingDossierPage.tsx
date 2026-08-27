import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Archive, RotateCcw, Trash2, Scale, ChevronDown } from 'lucide-react';
import { valuationApi, type MetricsResponse } from '../api/valuation';
import { AppPage, EmptyState, PageHeader } from '../components/common';
import { SellConfrontationModal } from '../components/holdings/SellConfrontationModal';
import {
  BusinessModelLayer,
  MoatLayer,
  ManagementLayer,
  MetricsLayer,
  ReasonsLayer,
} from '../components/holdings/DossierLayers';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type { UiLanguage, UiTextKey, UiTextParams } from '../i18n/uiText';
import { cn } from '../utils/cn';
import {
  HOLDINGS_CHANGED_EVENT,
  getHolding,
  listReasons,
  removeHolding,
  setHoldingStatus,
  type Holding,
} from '../utils/holdingDiscipline';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const Section: React.FC<{ index: number; title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  index,
  title,
  defaultOpen,
  children,
}) => (
  <details open={defaultOpen} className="group rounded-2xl border border-border/70 bg-card/60">
    <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3">
      <span className="text-base font-semibold text-foreground">
        <span className="mr-2 text-cyan">{index}</span>
        {title}
      </span>
      <ChevronDown className="h-4 w-4 text-secondary-text transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-border/60 px-5 py-4">{children}</div>
  </details>
);

const HoldingDossierPage: React.FC = () => {
  const { language, t } = useUiLanguage() as { language: UiLanguage; t: Translate };
  const { holdingId = '' } = useParams();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [sellOpen, setSellOpen] = useState(false);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const metricsFetched = useRef(false);

  useEffect(() => {
    const handler = () => setTick((v) => v + 1);
    window.addEventListener(HOLDINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(HOLDINGS_CHANGED_EVENT, handler);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick 作为存储变更刷新信号
  const holding: Holding | undefined = useMemo(() => getHolding(holdingId), [holdingId, tick]);

  // 拉一次财务指标，供第四层内置指标的迷你趋势用。
  useEffect(() => {
    if (metricsFetched.current || !holding) {
      return;
    }
    metricsFetched.current = true;
    const controller = new AbortController();
    valuationApi
      .getMetrics(holding.code, { years: 20 }, { signal: controller.signal })
      .then((res) => setMetrics(res))
      .catch(() => setMetrics(null));
    return () => controller.abort();
  }, [holding]);

  if (!holding) {
    return (
      <AppPage>
        <div className="space-y-5">
          <EmptyState title={t('discipline.notFound')} description={t('discipline.notFoundDesc')} />
          <Link to="/discipline" className="btn-secondary inline-flex items-center gap-2 text-sm">
            <ArrowLeft className="h-4 w-4" />
            {t('discipline.backToList')}
          </Link>
        </div>
      </AppPage>
    );
  }

  const closed = holding.status === 'closed';
  const activeBuyReasons = listReasons(holding.id, 'buy').filter((r) => r.status === 'active');

  return (
    <AppPage>
      <div className="space-y-4">
        <Link to="/discipline" className="inline-flex items-center gap-1.5 text-sm text-secondary-text hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t('discipline.backToList')}
        </Link>

        <PageHeader
          eyebrow={t('discipline.dossierEyebrow')}
          title={`${holding.name ? `${holding.name} · ` : ''}${holding.displayCode}`}
          description={t('discipline.dossierDesc')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {!closed ? (
                <button type="button" onClick={() => setSellOpen(true)} className="btn-primary inline-flex items-center gap-2">
                  <Scale className="h-4 w-4" />
                  {t('discipline.wantSell')}
                </button>
              ) : null}
              <button type="button" onClick={() => setHoldingStatus(holding.id, closed ? 'holding' : 'closed')} className="btn-secondary inline-flex items-center gap-2">
                {closed ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                {closed ? t('discipline.reopen') : t('discipline.archive')}
              </button>
              <button
                type="button"
                onClick={() => {
                  removeHolding(holding.id);
                  navigate('/discipline');
                }}
                className="inline-flex items-center rounded-lg border border-border/70 bg-card/70 p-2 text-secondary-text transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
                title={t('discipline.removeHolding')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          }
        />

        {closed ? (
          <p className={cn('rounded-xl border border-border/60 bg-card/50 px-4 py-2 text-sm text-secondary-text')}>
            {t('discipline.closedNote')}
          </p>
        ) : null}

        <Section index={1} title={t('discipline.layer.business')} defaultOpen>
          <BusinessModelLayer holdingId={holding.id} t={t} />
        </Section>
        <Section index={2} title={t('discipline.layer.moat')}>
          <MoatLayer holdingId={holding.id} t={t} />
        </Section>
        <Section index={3} title={t('discipline.layer.management')}>
          <ManagementLayer holdingId={holding.id} code={holding.code} displayCode={holding.displayCode} name={holding.name} t={t} />
        </Section>
        <Section index={4} title={t('discipline.layer.metrics')}>
          <MetricsLayer holdingId={holding.id} metrics={metrics} language={language} t={t} />
        </Section>
        <Section index={5} title={t('discipline.layer.reasons')} defaultOpen>
          <ReasonsLayer holdingId={holding.id} t={t} />
        </Section>

        <p className="pt-1 text-xs text-secondary-text/70">{t('discipline.disclaimer')}</p>
      </div>

      {sellOpen ? (
        <SellConfrontationModal
          holding={holding}
          reasons={activeBuyReasons}
          onClose={() => setSellOpen(false)}
          onSaved={() => setSellOpen(false)}
        />
      ) : null}
    </AppPage>
  );
};

export default HoldingDossierPage;
