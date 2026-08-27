import React from 'react';
import { Drawer } from '../common/Drawer';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { getChartKindLabel } from '../valuation/chartUtils';
import type { LensTemplate } from '../../data/lensTemplates';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

export const TemplateDetail: React.FC<{
  template: LensTemplate | null;
  onClose: () => void;
  onApply: (template: LensTemplate) => void;
}> = ({ template, onClose, onApply }) => {
  const { t } = useUiLanguage() as { t: Translate };
  return (
    <Drawer
      isOpen={!!template}
      onClose={onClose}
      title={template ? `${template.icon} ${t(template.nameKey as UiTextKey)}` : ''}
    >
      {template ? (
        <div className="flex h-full flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <p className="text-sm text-secondary-text">{t(template.taglineKey as UiTextKey)}</p>
            <div className="rounded-xl border border-border/60 bg-surface-2/30 p-4">
              <p className="text-sm leading-relaxed text-foreground">{t(template.philosophyKey as UiTextKey)}</p>
              {template.referenceKey ? (
                <p className="mt-2 text-xs text-secondary-text">{t(template.referenceKey as UiTextKey)}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              {template.lenses.map((lens, i) => (
                <div key={i} className="rounded-lg border border-border/60 bg-card/50 p-3">
                  <span className="inline-flex rounded-md border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 text-[0.7rem] text-cyan">
                    {getChartKindLabel(lens.chart, t)}
                  </span>
                  <p className="mt-1.5 text-sm text-foreground">{t(lens.noteKey as UiTextKey)}</p>
                  {lens.referenceHintKey ? (
                    <p className="mt-1 text-xs text-secondary-text">{t(lens.referenceHintKey as UiTextKey)}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => onApply(template)}
              className="btn-primary inline-flex w-full items-center justify-center gap-2 text-sm"
            >
              {t('myDashboard.templates.apply')}
            </button>
            <p className="mt-2 text-center text-[0.7rem] text-secondary-text/70">
              {t('myDashboard.templates.disclaimer')}
            </p>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
};

export default TemplateDetail;
