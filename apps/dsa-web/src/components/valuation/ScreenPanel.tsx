import React, { useState } from 'react';
import { Filter, Plus, Trash2, Check, X, HelpCircle, ListChecks } from 'lucide-react';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { cn } from '../../utils/cn';
import type {
  FundamentalsResponse,
  MetricsResponse,
  PeHistoryResponse,
} from '../../api/valuation';
import {
  CONDITION_NEEDS_THRESHOLD,
  CONDITION_NEEDS_YEARS,
  CONDITION_TYPES,
  evaluateAll,
  newCondition,
  type ConditionStatus,
  type ScreenCondition,
  type ScreenConditionType,
} from '../../utils/valuationScreen';
import { BatchScreenModal } from './BatchScreenModal';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const STATUS_STYLE: Record<ConditionStatus, string> = {
  pass: 'text-success',
  fail: 'text-danger',
  nodata: 'text-secondary-text',
};

const StatusIcon: React.FC<{ status: ConditionStatus }> = ({ status }) => {
  if (status === 'pass') {
    return <Check className="h-3.5 w-3.5" />;
  }
  if (status === 'fail') {
    return <X className="h-3.5 w-3.5" />;
  }
  return <HelpCircle className="h-3.5 w-3.5" />;
};

export const ScreenPanel: React.FC<{
  pe: PeHistoryResponse | null;
  metrics: MetricsResponse | null;
  fundamentals: FundamentalsResponse | null;
  hasStock: boolean;
}> = ({ pe, metrics, fundamentals, hasStock }) => {
  const { t } = useUiLanguage() as { t: Translate };
  const [conditions, setConditions] = useState<ScreenCondition[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);

  const add = () => setConditions((prev) => [...prev, newCondition()]);
  const remove = (id: string) => setConditions((prev) => prev.filter((c) => c.id !== id));
  const patch = (id: string, next: Partial<ScreenCondition>) =>
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...next } : c)));
  const changeType = (id: string, type: ScreenConditionType) =>
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...newCondition(type), id: c.id } : c)));

  const results = hasStock ? evaluateAll(conditions, { pe, metrics, fundamentals }) : [];
  const resultById = new Map(results.map((r) => [r.conditionId, r]));
  const passCount = results.filter((r) => r.status === 'pass').length;
  const overallPass = results.length > 0 && passCount === results.length;

  return (
    <Card className="rounded-2xl" padding="md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-cyan" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('screen.title')}</h3>
            <p className="text-xs text-secondary-text/80">{t('screen.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={add} className="btn-secondary inline-flex items-center gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />
            {t('screen.addCondition')}
          </button>
          <button
            type="button"
            onClick={() => setBatchOpen(true)}
            disabled={conditions.length === 0}
            className="btn-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            <ListChecks className="h-3.5 w-3.5" />
            {t('screen.batch')}
          </button>
        </div>
      </div>

      {conditions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 bg-card/40 px-4 py-6 text-center text-xs text-secondary-text">
          {t('screen.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {conditions.map((c) => {
            const res = resultById.get(c.id);
            return (
              <li key={c.id} className="rounded-xl border border-border/60 bg-card/50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={c.type}
                    onChange={(e) => changeType(c.id, e.target.value as ScreenConditionType)}
                    className="rounded-lg border border-border/70 bg-card/70 px-2 py-1 text-xs text-foreground focus:border-cyan focus:outline-none"
                  >
                    {CONDITION_TYPES.map((tp) => (
                      <option key={tp} value={tp}>
                        {t(`screen.type.${tp}` as UiTextKey)}
                      </option>
                    ))}
                  </select>
                  {CONDITION_NEEDS_YEARS[c.type] ? (
                    <label className="inline-flex items-center gap-1 text-xs text-secondary-text">
                      {t('screen.years')}
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={c.years}
                        onChange={(e) => patch(c.id, { years: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-14 rounded-lg border border-border/70 bg-card/70 px-2 py-1 text-xs text-foreground focus:border-cyan focus:outline-none"
                      />
                    </label>
                  ) : null}
                  {CONDITION_NEEDS_THRESHOLD[c.type] ? (
                    <label className="inline-flex items-center gap-1 text-xs text-secondary-text">
                      {t('screen.threshold')}
                      <input
                        type="number"
                        value={c.threshold}
                        onChange={(e) => patch(c.id, { threshold: Number(e.target.value) || 0 })}
                        className="w-16 rounded-lg border border-border/70 bg-card/70 px-2 py-1 text-xs text-foreground focus:border-cyan focus:outline-none"
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="ml-auto rounded-lg p-1 text-secondary-text hover:bg-hover hover:text-danger"
                    aria-label={t('screen.remove')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {hasStock && res ? (
                  <div className={cn('mt-1.5 flex items-center gap-1.5 text-xs', STATUS_STYLE[res.status])}>
                    <StatusIcon status={res.status} />
                    <span>{res.status === 'nodata' ? t('screen.nodata') : res.actual}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {conditions.length > 0 ? (
        !hasStock ? (
          <p className="mt-3 text-xs text-secondary-text/80">{t('screen.noStock')}</p>
        ) : (
          <div
            className={cn(
              'mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
              overallPass ? 'border-success/40 bg-success/10 text-success' : 'border-border/60 bg-card/50 text-secondary-text',
            )}
          >
            {overallPass ? <Check className="h-4 w-4" /> : null}
            <span>{overallPass ? t('screen.allPass') : t('screen.notAllPass', { pass: passCount, total: results.length })}</span>
          </div>
        )
      ) : null}

      {batchOpen ? <BatchScreenModal conditions={conditions} onClose={() => setBatchOpen(false)} /> : null}
    </Card>
  );
};

export default ScreenPanel;
