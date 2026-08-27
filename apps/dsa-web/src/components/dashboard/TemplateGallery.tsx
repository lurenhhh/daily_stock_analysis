import React from 'react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { LENS_TEMPLATES, type LensTemplate } from '../../data/lensTemplates';
import { TemplateCard } from './TemplateCard';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

export const TemplateGallery: React.FC<{
  onApply: (template: LensTemplate) => void;
  onView: (template: LensTemplate) => void;
}> = ({ onApply, onView }) => {
  const { t } = useUiLanguage() as { t: Translate };
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">{t('myDashboard.templates.title')}</h2>
        <p className="mt-1 text-sm text-secondary-text">{t('myDashboard.templates.subtitle')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {LENS_TEMPLATES.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            template={tpl}
            onApply={() => onApply(tpl)}
            onView={() => onView(tpl)}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-secondary-text/70">{t('myDashboard.templates.disclaimer')}</p>
    </div>
  );
};

export default TemplateGallery;
