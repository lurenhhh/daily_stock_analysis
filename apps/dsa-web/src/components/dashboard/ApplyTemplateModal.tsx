import React, { useState } from 'react';
import { X } from 'lucide-react';
import { StockAutocomplete } from '../StockAutocomplete';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import type { LensTemplate } from '../../data/lensTemplates';
import { applyLensTemplate, type ApplyResult } from '../../utils/applyLensTemplate';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

export const ApplyTemplateModal: React.FC<{
  template: LensTemplate | null;
  onClose: () => void;
  onApplied: (result: ApplyResult) => void;
}> = ({ template, onClose, onApplied }) => {
  const { t } = useUiLanguage() as { t: Translate };
  const [value, setValue] = useState('');

  if (!template) {
    return null;
  }

  const handleSubmit = (
    code: string,
    name?: string,
    _source?: 'manual' | 'autocomplete',
    metadata?: { displayCode?: string },
  ) => {
    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }
    const result = applyLensTemplate(template, {
      code: trimmed,
      displayCode: metadata?.displayCode ?? trimmed,
      name: name ?? null,
    });
    onApplied(result);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <Card className="relative z-10 w-full max-w-md rounded-2xl" padding="md">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground">
            {template.icon} {t(template.nameKey as UiTextKey)} · {t('myDashboard.templates.pickStock')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-secondary-text transition-colors hover:bg-hover hover:text-foreground"
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <StockAutocomplete
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={t('valuation.searchPlaceholder')}
          ariaLabel={t('myDashboard.templates.pickStock')}
        />
        <p className="mt-3 text-[0.7rem] text-secondary-text/70">{t('myDashboard.templates.disclaimer')}</p>
      </Card>
    </div>
  );
};

export default ApplyTemplateModal;
