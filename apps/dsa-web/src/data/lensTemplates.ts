import type { DashboardChartKind } from '../utils/myDashboard';
import type { ValuationMetric } from '../api/valuation';

/** 模版里的单个镜头：与股票无关，只描述"看哪个指标、怎么看"。 */
export interface LensSpec {
  chart: DashboardChartKind; // 'pe' | 'fund' | MetricKey
  metric?: ValuationMetric; // 仅 chart==='pe' 时使用
  years?: number; // 缺省用模版 defaultYears
  noteKey: string; // i18n key：该镜头在本模版里的说明
  referenceHintKey?: string; // i18n key：客观参考提示（非买卖建议）
}

/** 投资人视角模版：一组有序镜头 + 方法论说明。 */
export interface LensTemplate {
  id: string; // 'moat' | 'contrarian' | 'dividend'
  icon: string; // 展示用 emoji
  nameKey: string;
  taglineKey: string;
  philosophyKey: string;
  referenceKey?: string;
  lenses: LensSpec[];
  defaultYears: number; // 10 | 20
}

export const LENS_TEMPLATES: LensTemplate[] = [
  {
    id: 'moat',
    icon: '🏰',
    nameKey: 'lens.moat.name',
    taglineKey: 'lens.moat.tagline',
    philosophyKey: 'lens.moat.philosophy',
    referenceKey: 'lens.moat.reference',
    defaultYears: 20,
    lenses: [
      { chart: 'roe', noteKey: 'lens.moat.note.roe', referenceHintKey: 'lens.moat.hint.roe' },
      { chart: 'grossMargin', noteKey: 'lens.moat.note.gm' },
      { chart: 'freeCashFlow', noteKey: 'lens.moat.note.fcf' },
      { chart: 'fund', noteKey: 'lens.moat.note.fund' },
      { chart: 'pe', metric: 'pe_ttm', noteKey: 'lens.moat.note.pe' },
    ],
  },
  {
    id: 'contrarian',
    icon: '🔄',
    nameKey: 'lens.contrarian.name',
    taglineKey: 'lens.contrarian.tagline',
    philosophyKey: 'lens.contrarian.philosophy',
    defaultYears: 20,
    lenses: [
      { chart: 'pe', metric: 'pe_ttm', years: 20, noteKey: 'lens.contrarian.note.pe' },
      { chart: 'deductedNetProfit', noteKey: 'lens.contrarian.note.dnp' },
      { chart: 'debtRatio', noteKey: 'lens.contrarian.note.debt' },
      { chart: 'dividendYield', noteKey: 'lens.contrarian.note.div' },
    ],
  },
  {
    id: 'dividend',
    icon: '💰',
    nameKey: 'lens.dividend.name',
    taglineKey: 'lens.dividend.tagline',
    philosophyKey: 'lens.dividend.philosophy',
    defaultYears: 20,
    lenses: [
      { chart: 'dividendYield', noteKey: 'lens.dividend.note.div' },
      { chart: 'freeCashFlow', noteKey: 'lens.dividend.note.fcf' },
      { chart: 'debtRatio', noteKey: 'lens.dividend.note.debt' },
      { chart: 'roe', noteKey: 'lens.dividend.note.roe' },
      { chart: 'pe', metric: 'pe_ttm', noteKey: 'lens.dividend.note.pe' },
    ],
  },
];
