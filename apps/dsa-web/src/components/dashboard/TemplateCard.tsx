import React from 'react';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { getChartKindLabel } from '../valuation/chartUtils';
import type { LensTemplate } from '../../data/lensTemplates';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

export const TemplateCard: React.FC<{ template: LensTemplate; onApply: () => void; onView: () => void }> = ({
  template,
  onApply,
  onView,
}) => {
  const { t } = useUiLanguage() as { t: Translate };
  return (
    <Card className="flex h-full flex-col rounded-2xl" padding="md">
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none">{template.icon}</span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{t(template.nameKey as UiTextKey)}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-secondary-text">{t(template.taglineKey as UiTextKey)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {template.lenses.map((lens, i) => (
          <span
            key={i}
            className="rounded-md border border-border/60 bg-card/60 px-1.5 py-0.5 text-[0.7rem] text-secondary-text"
          >
            {getChartKindLabel(lens.chart, t)}
          </span>
        ))}
      </div>
      <div className="mt-auto flex gap-2 pt-4">
        <button
          type="button"
          onClick={onView}
          className="btn-secondary inline-flex flex-1 items-center justify-center text-sm"
        >
          {t('myDashboard.templates.view')}
        </button>
        <button
          type="button"
          onClick={onApply}
          className="btn-primary inline-flex flex-1 items-center justify-center text-sm"
        >
          {t('myDashboard.templates.apply')}
        </button>
      </div>
    </Card>
  );
};

export default TemplateCard;
