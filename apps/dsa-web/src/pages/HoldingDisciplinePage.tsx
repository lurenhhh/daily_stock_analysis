import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ChevronRight, AlertTriangle } from 'lucide-react';
import { AppPage, Card, EmptyState, PageHeader } from '../components/common';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../i18n/uiText';
import { cn } from '../utils/cn';
import {
  HOLDINGS_CHANGED_EVENT,
  addHolding,
  getHoldingSummary,
  listHoldings,
} from '../utils/holdingDiscipline';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const HoldingDisciplinePage: React.FC = () => {
  const { t } = useUiLanguage() as { t: Translate };
  const [inputValue, setInputValue] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick((v) => v + 1);
    window.addEventListener(HOLDINGS_CHANGED_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(HOLDINGS_CHANGED_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const holdings = useMemo(() => {
    const all = listHoldings();
    return [...all].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'holding' ? -1 : 1;
      }
      return b.updatedAt - a.updatedAt;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick 作为存储变更刷新信号
  }, [tick]);

  const handleAdd = (
    code: string,
    name?: string,
    _source?: 'manual' | 'autocomplete',
    metadata?: { market?: string; displayCode?: string },
  ) => {
    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }
    addHolding({
      code: trimmed,
      displayCode: metadata?.displayCode ?? trimmed,
      name: name ?? null,
      market: metadata?.market ?? '',
    });
    setInputValue('');
  };

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader eyebrow={t('discipline.eyebrow')} title={t('discipline.title')} description={t('discipline.description')} />

        <Card className="rounded-2xl" padding="md">
          <label className="label-uppercase" htmlFor="discipline-search">
            {t('discipline.addHolding')}
          </label>
          <div className="mt-2">
            <StockAutocomplete
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleAdd}
              placeholder={t('discipline.addPlaceholder')}
              ariaLabel={t('discipline.addHolding')}
            />
          </div>
          <p className="mt-2 text-xs text-secondary-text/70">{t('discipline.addHint')}</p>
        </Card>

        {holdings.length === 0 ? (
          <EmptyState
            title={t('discipline.emptyTitle')}
            description={t('discipline.emptyDesc')}
            icon={<ShieldCheck className="h-8 w-8" />}
          />
        ) : (
          <div className="space-y-2">
            {holdings.map((h) => {
              const s = getHoldingSummary(h.id);
              const closed = h.status === 'closed';
              return (
                <Link
                  key={h.id}
                  to={`/discipline/${h.id}`}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3 transition-colors hover:border-cyan/40 hover:bg-hover',
                    closed ? 'opacity-70' : '',
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {h.name ? `${h.name} · ` : ''}{h.displayCode}
                      {closed ? (
                        <span className="ml-2 rounded-full border border-border/60 bg-card/60 px-2 py-0.5 text-[0.7rem] text-secondary-text">
                          {t('discipline.closed')}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-secondary-text">
                      <span>{t('discipline.completeness', { filled: s.filledLayers, total: s.totalLayers })}</span>
                      {s.hasBrokenReason ? (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <AlertTriangle className="h-3 w-3" />
                          {t('discipline.hasBroken')}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-secondary-text" />
                </Link>
              );
            })}
            <p className="pt-1 text-xs text-secondary-text/70">{t('discipline.disclaimer')}</p>
          </div>
        )}
      </div>
    </AppPage>
  );
};

export default HoldingDisciplinePage;
