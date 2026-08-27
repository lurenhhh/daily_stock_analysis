import React, { useState } from 'react';
import { Trash2, Plus, Scale, Archive, RotateCcw, History } from 'lucide-react';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { cn } from '../../utils/cn';
import {
  addReason,
  removeHolding,
  removeReason,
  setHoldingStatus,
  setReasonStatus,
  type Holding,
  type HoldingReason,
  type ReasonCategory,
  type SellReviewLog,
} from '../../utils/holdingDiscipline';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const CATEGORIES: ReasonCategory[] = ['valuation', 'growth', 'dividend', 'moat', 'management', 'catalyst', 'other'];

const DECISION_TONE: Record<string, string> = {
  sold: 'border-danger/40 bg-danger/10 text-danger',
  keep: 'border-success/40 bg-success/10 text-success',
  thinking: 'border-warning/40 bg-warning/10 text-warning',
};

export const HoldingCard: React.FC<{
  holding: Holding;
  reasons: HoldingReason[];
  logs: SellReviewLog[];
  onSell: (holding: Holding) => void;
}> = ({ holding, reasons, logs, onSell }) => {
  const { t } = useUiLanguage() as { t: Translate };
  const [text, setText] = useState('');
  const [cat, setCat] = useState<ReasonCategory | ''>('');
  const [showLogs, setShowLogs] = useState(false);

  const closed = holding.status === 'closed';

  const submitReason = () => {
    if (!text.trim()) {
      return;
    }
    addReason(holding.id, text, cat || undefined);
    setText('');
    setCat('');
  };

  return (
    <Card className={cn('rounded-2xl', closed ? 'opacity-70' : '')} padding="md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {holding.name ? `${holding.name} · ` : ''}{holding.displayCode}
            {closed ? (
              <span className="ml-2 inline-flex items-center rounded-full border border-border/60 bg-card/60 px-2 py-0.5 text-[0.7rem] text-secondary-text">
                {t('discipline.closed')}
              </span>
            ) : null}
          </h3>
          {holding.cost || holding.quantity || holding.buyDate ? (
            <p className="mt-0.5 text-xs text-secondary-text">
              {holding.cost ? `${t('discipline.cost')} ${holding.cost} · ` : ''}
              {holding.quantity ? `${t('discipline.quantity')} ${holding.quantity} · ` : ''}
              {holding.buyDate ? `${t('discipline.buyDate')} ${holding.buyDate}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!closed ? (
            <button
              type="button"
              onClick={() => onSell(holding)}
              className="btn-primary inline-flex items-center gap-1.5 text-xs"
            >
              <Scale className="h-3.5 w-3.5" />
              {t('discipline.wantSell')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setHoldingStatus(holding.id, closed ? 'holding' : 'closed')}
            className="btn-secondary inline-flex items-center gap-1.5 text-xs"
          >
            {closed ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            {closed ? t('discipline.reopen') : t('discipline.archive')}
          </button>
          <button
            type="button"
            onClick={() => removeHolding(holding.id)}
            title={t('discipline.removeHolding')}
            className="inline-flex items-center rounded-lg border border-border/70 bg-card/70 p-1.5 text-secondary-text transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 理由列表 */}
      <div className="space-y-2">
        {reasons.length === 0 ? (
          <p className="text-sm text-secondary-text">{t('discipline.noReasonsYet')}</p>
        ) : (
          reasons.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-2 rounded-xl border border-border/60 bg-card/50 px-3 py-2">
              <div className="min-w-0">
                <p className={cn('text-sm', r.status === 'broken' ? 'text-secondary-text line-through' : 'text-foreground')}>
                  {r.category ? (
                    <span className="mr-1.5 rounded border border-cyan/30 bg-cyan/10 px-1 py-px text-[0.65rem] text-cyan">
                      {t(`discipline.cat.${r.category}` as UiTextKey)}
                    </span>
                  ) : null}
                  {r.text}
                </p>
                {r.status === 'broken' ? (
                  <p className="mt-0.5 text-[0.7rem] text-danger">
                    {t('discipline.reasonBroken')}
                    {r.brokenNote ? ` · ${r.brokenNote}` : ''}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setReasonStatus(r.id, r.status === 'active' ? 'broken' : 'active')}
                  className="rounded-lg border border-border/60 bg-card/60 px-2 py-0.5 text-[0.7rem] text-secondary-text hover:text-foreground"
                >
                  {r.status === 'active' ? t('discipline.markBroken') : t('discipline.restore')}
                </button>
                <button
                  type="button"
                  onClick={() => removeReason(r.id)}
                  className="rounded-lg p-1 text-secondary-text hover:text-danger"
                  title={t('discipline.removeReason')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 添加理由 */}
      {!closed ? (
        <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-card/40 p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat((prev) => (prev === c ? '' : c))}
                className={cn(
                  'rounded-md border px-1.5 py-0.5 text-[0.7rem] transition-colors',
                  cat === c
                    ? 'border-cyan/60 bg-cyan/15 text-cyan'
                    : 'border-border/60 bg-card/60 text-secondary-text hover:text-foreground',
                )}
              >
                {t(`discipline.cat.${c}` as UiTextKey)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  submitReason();
                }
              }}
              placeholder={t('discipline.reasonPlaceholder')}
              className="h-9 flex-1 rounded-xl border border-border/70 bg-card/70 px-3 text-sm text-foreground focus:border-cyan focus:outline-none"
            />
            <button
              type="button"
              onClick={submitReason}
              disabled={!text.trim()}
              className="btn-secondary inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {t('discipline.addReason')}
            </button>
          </div>
        </div>
      ) : null}

      {/* 决策日志 */}
      {logs.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-secondary-text hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" />
            {t('discipline.logs', { n: logs.length })}
          </button>
          {showLogs ? (
            <ul className="mt-2 space-y-2">
              {logs.map((log) => {
                const broken = log.checks.filter((c) => !c.stillHolds).length;
                return (
                  <li key={log.id} className="rounded-lg border border-border/60 bg-surface-2/30 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-full border px-2 py-0.5', DECISION_TONE[log.decision])}>
                        {t(`discipline.decision.${log.decision}` as UiTextKey)}
                      </span>
                      <span className="text-secondary-text">
                        {t('discipline.logSummary', { total: log.checks.length, broken })}
                      </span>
                    </div>
                    {log.sellReason ? <p className="mt-1 text-secondary-text">{log.sellReason}</p> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};

export default HoldingCard;
