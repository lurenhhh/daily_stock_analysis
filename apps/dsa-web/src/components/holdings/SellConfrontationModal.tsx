import React, { useMemo, useState } from 'react';
import { X, Scale } from 'lucide-react';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { cn } from '../../utils/cn';
import {
  addSellReviewLog,
  setReasonStatus,
  type Holding,
  type HoldingReason,
} from '../../utils/holdingDiscipline';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;
type Decision = 'keep' | 'sold' | 'thinking';

export const SellConfrontationModal: React.FC<{
  holding: Holding;
  reasons: HoldingReason[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ holding, reasons, onClose, onSaved }) => {
  const { t } = useUiLanguage() as { t: Translate };
  const [holds, setHolds] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(reasons.map((r) => [r.id, true])),
  );
  const [sellReason, setSellReason] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);

  const anyBroken = useMemo(() => reasons.some((r) => holds[r.id] === false), [reasons, holds]);

  const save = () => {
    if (!decision) {
      return;
    }
    const checks = reasons.map((r) => ({ reasonId: r.id, text: r.text, stillHolds: holds[r.id] !== false }));
    addSellReviewLog({ holdingId: holding.id, checks, sellReason: sellReason.trim() || undefined, decision });
    // 把被标为"不成立"的理由同步为 broken，如实反映。
    reasons.forEach((r) => {
      if (holds[r.id] === false) {
        setReasonStatus(r.id, 'broken', sellReason.trim() || undefined);
      }
    });
    onSaved();
  };

  const decisions: { key: Decision; label: string }[] = [
    { key: 'keep', label: t('discipline.decision.keep') },
    { key: 'sold', label: t('discipline.decision.sold') },
    { key: 'thinking', label: t('discipline.decision.thinking') },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <Card className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl" padding="md">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-cyan" />
            <h3 className="text-base font-semibold text-foreground">{t('discipline.confront.title')}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-secondary-text transition-colors hover:bg-hover hover:text-foreground"
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-secondary-text">
          {holding.name ? `${holding.name} · ` : ''}{holding.displayCode}
        </p>

        {reasons.length > 0 ? (
          <>
            <p className="mb-2 text-sm text-foreground">{t('discipline.confront.yourReasons')}</p>
            <ul className="space-y-2">
              {reasons.map((r, i) => {
                const stillHolds = holds[r.id] !== false;
                return (
                  <li key={r.id} className="rounded-xl border border-border/60 bg-card/50 px-3 py-2">
                    <p className="text-sm text-foreground">
                      <span className="mr-1 text-secondary-text">{i + 1}.</span>
                      {r.text}
                    </p>
                    <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-border/60">
                      <button
                        type="button"
                        onClick={() => setHolds((prev) => ({ ...prev, [r.id]: true }))}
                        className={cn('px-3 py-1 text-xs', stillHolds ? 'bg-success/20 text-success' : 'text-secondary-text')}
                      >
                        {t('discipline.confront.stillHolds')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setHolds((prev) => ({ ...prev, [r.id]: false }))}
                        className={cn('px-3 py-1 text-xs', !stillHolds ? 'bg-danger/20 text-danger' : 'text-secondary-text')}
                      >
                        {t('discipline.confront.broken')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-secondary-text">{t('discipline.confront.noReasons')}</p>
        )}

        <div className="mt-4">
          {anyBroken ? (
            <p className="mb-1 text-sm text-warning">{t('discipline.confront.someBroken')}</p>
          ) : reasons.length > 0 ? (
            <p className="mb-1 text-sm text-secondary-text">{t('discipline.confront.allHold')}</p>
          ) : null}
          <label className="mb-1 block text-xs text-secondary-text">{t('discipline.confront.sellReasonLabel')}</label>
          <textarea
            value={sellReason}
            onChange={(e) => setSellReason(e.target.value)}
            rows={2}
            placeholder={t('discipline.confront.sellReasonPlaceholder')}
            className="w-full rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm text-foreground focus:border-cyan focus:outline-none"
          />
        </div>

        <div className="mt-3">
          <p className="mb-1 text-xs text-secondary-text">{t('discipline.confront.yourDecision')}</p>
          <div className="flex flex-wrap gap-2">
            {decisions.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDecision(d.key)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  decision === d.key
                    ? 'border-cyan/60 bg-cyan/15 text-cyan'
                    : 'border-border/60 bg-card/60 text-secondary-text hover:bg-hover hover:text-foreground',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={!decision}
          className="btn-primary mt-4 inline-flex w-full items-center justify-center text-sm disabled:opacity-50"
        >
          {t('discipline.confront.save')}
        </button>
        <p className="mt-2 text-center text-[0.7rem] text-secondary-text/70">{t('discipline.disclaimer')}</p>
      </Card>
    </div>
  );
};

export default SellConfrontationModal;
