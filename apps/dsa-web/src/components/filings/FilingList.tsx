import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { FilingItem } from '../../api/filings';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { AiSummaryButton } from './AiSummaryButton';
import { cn } from '../../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const TYPE_TONE: Record<string, string> = {
  annual: 'border-cyan/40 bg-cyan/10 text-cyan',
  interim: 'border-primary/40 bg-primary/10 text-[hsl(var(--primary))]',
  q1: 'border-success/40 bg-success/10 text-success',
  q3: 'border-warning/40 bg-warning/10 text-warning',
  other: 'border-border/60 bg-card/60 text-secondary-text',
};

export const FilingList: React.FC<{ items: FilingItem[]; t: Translate }> = ({ items, t }) => {
  return (
    <div className="space-y-2">
      {items.map((f) => {
        const hasUrl = !!f.officialUrl;
        return (
          <div
            key={f.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'shrink-0 rounded-md border px-1.5 py-0.5 text-[0.7rem]',
                    TYPE_TONE[f.reportType] ?? TYPE_TONE.other,
                  )}
                >
                  {t(`filings.type.${f.reportType}` as UiTextKey)}
                </span>
                <h4 className="text-sm font-medium text-foreground">{f.title}</h4>
              </div>
              <p className="mt-1 text-xs text-secondary-text">
                {f.reportPeriod ? `${f.reportPeriod} · ` : ''}
                {t('filings.publishedOn')} {f.publishDate || '—'} · {t('filings.source')}: {f.source || '—'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {hasUrl ? (
                <a
                  href={f.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary inline-flex items-center gap-1.5 text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('filings.viewOriginal')}
                </a>
              ) : (
                <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1 text-xs text-secondary-text/60">
                  {t('filings.noUrl')}
                </span>
              )}
              <AiSummaryButton filingId={f.id} officialUrl={f.officialUrl} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FilingList;
