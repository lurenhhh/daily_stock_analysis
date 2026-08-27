import { addDashboardItem } from './myDashboard';
import type { LensTemplate } from '../data/lensTemplates';

export interface ApplyTarget {
  code: string; // 规范化代码（StockAutocomplete 提供）
  displayCode: string; // 展示代码；无则回退用 code
  name: string | null;
}

export interface ApplyResult {
  added: number;
  skipped: number; // 因去重跳过的数量
}

/** 将模版套到一只股票上，批量写入现有看板（localStorage）。 */
export function applyLensTemplate(template: LensTemplate, target: ApplyTarget): ApplyResult {
  let added = 0;
  let skipped = 0;
  for (const lens of template.lenses) {
    const { added: ok } = addDashboardItem({
      code: target.code,
      displayCode: target.displayCode || target.code,
      name: target.name,
      chart: lens.chart,
      metric: lens.chart === 'pe' ? lens.metric ?? 'pe_ttm' : undefined,
      years: lens.years ?? template.defaultYears,
    });
    if (ok) {
      added += 1;
    } else {
      skipped += 1;
    }
  }
  return { added, skipped };
}
