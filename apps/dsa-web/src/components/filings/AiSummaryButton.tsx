import React from 'react';
import { Sparkles } from 'lucide-react';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

/**
 * AI 摘要按钮位（本期灰置占位，为 L5 铺路）。
 * 预留 filingId / officialUrl，将来接后端摘要接口即可点亮。
 */
export const AiSummaryButton: React.FC<{ filingId: string; officialUrl: string }> = ({
  filingId,
  officialUrl,
}) => {
  const { t } = useUiLanguage() as { t: Translate };
  // 预留 props（L5 使用），当前不消费。
  void filingId;
  void officialUrl;
  return (
    <button
      type="button"
      disabled
      title={t('filings.aiSoon')}
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1 text-xs text-secondary-text/60"
    >
      <Sparkles className="h-3.5 w-3.5" />
      {t('filings.aiSummary')}
    </button>
  );
};

export default AiSummaryButton;
