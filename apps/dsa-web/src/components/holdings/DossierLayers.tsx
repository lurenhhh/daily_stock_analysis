import React, { useState } from 'react';
import { Plus, Trash2, Sparkles, X } from 'lucide-react';
import { valuationApi, type MetricKey, type MetricsResponse } from '../../api/valuation';
import { MetricChartView } from '../valuation/charts';
import type { UiLanguage, UiTextKey, UiTextParams } from '../../i18n/uiText';
import { cn } from '../../utils/cn';
import {
  DEFAULT_MGMT_CRITERIA,
  DEFAULT_MOAT_TYPES,
  addMember,
  addMetric,
  addMgmtCustomCriterion,
  addMoatCustomType,
  addReason,
  getBusinessModel,
  getMoat,
  listMembers,
  listMetrics,
  listMgmtCustomCriteria,
  listReasons,
  removeMember,
  removeMetric,
  removeMgmtCustomCriterion,
  removeMoatCustomType,
  removeReason,
  saveBusinessModel,
  saveMoat,
  setMemberVerdict,
  setMoatVerdict,
  setReasonStatus,
  type ReasonCategory,
  type TriState,
} from '../../utils/holdingDiscipline';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const BUILTIN_METRICS: MetricKey[] = [
  'roe',
  'grossMargin',
  'debtRatio',
  'dividendYield',
  'deductedNetProfit',
  'freeCashFlow',
];
const CATEGORIES: ReasonCategory[] = ['valuation', 'growth', 'dividend', 'moat', 'management', 'catalyst', 'other'];

const TriStateButtons: React.FC<{
  value?: TriState;
  labels: { yes: string; no: string; unsure: string };
  onPick: (v: TriState) => void;
}> = ({ value, labels, onPick }) => {
  const opts: { key: TriState; label: string; active: string }[] = [
    { key: 'yes', label: labels.yes, active: 'bg-success/20 text-success' },
    { key: 'no', label: labels.no, active: 'bg-danger/20 text-danger' },
    { key: 'unsure', label: labels.unsure, active: 'bg-warning/20 text-warning' },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border/60">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onPick(o.key)}
          className={cn('px-2.5 py-1 text-xs', value === o.key ? o.active : 'text-secondary-text hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
};

const StringListEditor: React.FC<{
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
}> = ({ items, onChange, placeholder, addLabel }) => {
  const [text, setText] = useState('');
  const add = () => {
    if (!text.trim()) {
      return;
    }
    onChange([...items, text.trim()]);
    setText('');
  };
  return (
    <div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-2.5 py-1 text-sm text-foreground">
            <span className="min-w-0 break-words">{it}</span>
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="shrink-0 text-secondary-text hover:text-danger">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={placeholder}
          className="h-8 flex-1 rounded-lg border border-border/70 bg-card/70 px-2.5 text-sm text-foreground focus:border-cyan focus:outline-none"
        />
        <button type="button" onClick={add} disabled={!text.trim()} className="btn-secondary inline-flex items-center gap-1 text-xs disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </button>
      </div>
    </div>
  );
};

// ===== 第一层：商业模式 =====
export const BusinessModelLayer: React.FC<{ holdingId: string; t: Translate }> = ({ holdingId, t }) => {
  const bm = getBusinessModel(holdingId);
  const [summary, setSummary] = useState(bm.summary ?? '');
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs text-secondary-text">{t('discipline.bm.summary')}</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => saveBusinessModel(holdingId, { summary: summary.trim() })}
          rows={2}
          placeholder={t('discipline.bm.summaryPlaceholder')}
          className="w-full rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm text-foreground focus:border-cyan focus:outline-none"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-success">{t('discipline.bm.pros')}</p>
          <StringListEditor
            items={bm.pros}
            onChange={(next) => saveBusinessModel(holdingId, { pros: next })}
            placeholder={t('discipline.bm.prosPlaceholder')}
            addLabel={t('discipline.add')}
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-danger">{t('discipline.bm.cons')}</p>
          <StringListEditor
            items={bm.cons}
            onChange={(next) => saveBusinessModel(holdingId, { cons: next })}
            placeholder={t('discipline.bm.consPlaceholder')}
            addLabel={t('discipline.add')}
          />
        </div>
      </div>
    </div>
  );
};

// ===== 第二层：护城河 =====
export const MoatLayer: React.FC<{ holdingId: string; t: Translate }> = ({ holdingId, t }) => {
  const moat = getMoat(holdingId);
  const [custom, setCustom] = useState('');
  const triLabels = { yes: t('discipline.moat.tri.yes'), no: t('discipline.moat.tri.no'), unsure: t('discipline.moat.tri.unsure') };
  const widthOpts = ['wide', 'narrow', 'none'] as const;
  const trendOpts = ['widening', 'stable', 'narrowing'] as const;
  const rows: { id: string; label: string; custom: boolean }[] = [
    ...DEFAULT_MOAT_TYPES.map((id) => ({ id, label: t(`discipline.moat.type.${id}` as UiTextKey), custom: false })),
    ...moat.customTypes.map((c) => ({ id: c.id, label: c.label, custom: true })),
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <div>
          <p className="mb-1 text-xs text-secondary-text">{t('discipline.moat.width')}</p>
          <div className="inline-flex overflow-hidden rounded-lg border border-border/60">
            {widthOpts.map((w) => (
              <button key={w} type="button" onClick={() => saveMoat(holdingId, { width: w })} className={cn('px-2.5 py-1 text-xs', moat.width === w ? 'bg-cyan/20 text-cyan' : 'text-secondary-text hover:text-foreground')}>
                {t(`discipline.moat.widthOpt.${w}` as UiTextKey)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-secondary-text">{t('discipline.moat.trend')}</p>
          <div className="inline-flex overflow-hidden rounded-lg border border-border/60">
            {trendOpts.map((tr) => (
              <button key={tr} type="button" onClick={() => saveMoat(holdingId, { trend: tr })} className={cn('px-2.5 py-1 text-xs', moat.trend === tr ? 'bg-cyan/20 text-cyan' : 'text-secondary-text hover:text-foreground')}>
                {t(`discipline.moat.trendOpt.${tr}` as UiTextKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/50 px-3 py-2">
            <span className="text-sm text-foreground">{row.label}</span>
            <div className="flex items-center gap-2">
              <TriStateButtons value={moat.verdicts[row.id]?.verdict} labels={triLabels} onPick={(v) => setMoatVerdict(holdingId, row.id, v)} />
              {row.custom ? (
                <button type="button" onClick={() => removeMoatCustomType(holdingId, row.id)} className="text-secondary-text hover:text-danger">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { addMoatCustomType(holdingId, custom); setCustom(''); } }} placeholder={t('discipline.moat.customPlaceholder')} className="h-8 flex-1 rounded-lg border border-border/70 bg-card/70 px-2.5 text-sm text-foreground focus:border-cyan focus:outline-none" />
        <button type="button" onClick={() => { if (custom.trim()) { addMoatCustomType(holdingId, custom); setCustom(''); } }} disabled={!custom.trim()} className="btn-secondary inline-flex items-center gap-1 text-xs disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" />{t('discipline.moat.addType')}
        </button>
      </div>
    </div>
  );
};

// ===== 第三层：管理层 =====
export const ManagementLayer: React.FC<{ holdingId: string; code: string; displayCode: string; name: string | null; t: Translate }> = ({ holdingId, code, displayCode, name, t }) => {
  const members = listMembers(holdingId);
  const customCriteria = listMgmtCustomCriteria(holdingId);
  const [newName, setNewName] = useState('');
  const [newCrit, setNewCrit] = useState('');
  const [autoLoading, setAutoLoading] = useState(false);
  const triLabels = { yes: t('discipline.mgmt.tri.yes'), no: t('discipline.mgmt.tri.no'), unsure: t('discipline.mgmt.tri.unsure') };
  const criteria: { id: string; label: string; custom: boolean }[] = [
    ...DEFAULT_MGMT_CRITERIA.map((id) => ({ id, label: t(`discipline.mgmt.crit.${id}` as UiTextKey), custom: false })),
    ...customCriteria.map((c) => ({ id: c.id, label: c.label, custom: true })),
  ];

  const autoFill = async () => {
    if (!code || autoLoading) {
      return;
    }
    setAutoLoading(true);
    try {
      const res = await valuationApi.getLeaders(code, { name: name ?? '' });
      if (res.supported) {
        res.leaders.forEach((l) => addMember(holdingId, l.name, l.title, 'auto'));
      }
    } catch {
      /* 降级为手动添加 */
    } finally {
      setAutoLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void autoFill()} disabled={autoLoading} className="btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-50">
          <Sparkles className={cn('h-3.5 w-3.5', autoLoading ? 'animate-pulse' : '')} />
          {autoLoading ? t('discipline.mgmt.autoLoading') : t('discipline.mgmt.autoFill')}
        </button>
        <span className="text-[0.7rem] text-secondary-text/70">{t('discipline.mgmt.aiTag')}</span>
        <span className="text-[0.7rem] text-secondary-text/50">· {displayCode}</span>
      </div>

      {members.map((m) => (
        <div key={m.id} className="rounded-xl border border-border/60 bg-card/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              {m.name}
              {m.title ? <span className="ml-1.5 text-xs text-cyan">{m.title}</span> : null}
              {m.source === 'auto' ? <span className="ml-1.5 text-[0.65rem] text-secondary-text/60">AI</span> : null}
            </p>
            <button type="button" onClick={() => removeMember(m.id)} className="text-secondary-text hover:text-danger">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="space-y-1.5">
            {criteria.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-secondary-text">
                  {c.label}
                  {c.custom ? (
                    <button type="button" onClick={() => removeMgmtCustomCriterion(holdingId, c.id)} className="ml-1 text-secondary-text/60 hover:text-danger">×</button>
                  ) : null}
                </span>
                <TriStateButtons value={m.verdicts[c.id]?.verdict} labels={triLabels} onPick={(v) => setMemberVerdict(m.id, c.id, v)} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { addMember(holdingId, newName); setNewName(''); } }} placeholder={t('discipline.mgmt.addMemberPlaceholder')} className="h-8 flex-1 rounded-lg border border-border/70 bg-card/70 px-2.5 text-sm text-foreground focus:border-cyan focus:outline-none" />
        <button type="button" onClick={() => { if (newName.trim()) { addMember(holdingId, newName); setNewName(''); } }} disabled={!newName.trim()} className="btn-secondary inline-flex items-center gap-1 text-xs disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" />{t('discipline.mgmt.addMember')}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={newCrit} onChange={(e) => setNewCrit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newCrit.trim()) { addMgmtCustomCriterion(holdingId, newCrit); setNewCrit(''); } }} placeholder={t('discipline.mgmt.addCritPlaceholder')} className="h-8 flex-1 rounded-lg border border-border/70 bg-card/70 px-2.5 text-sm text-foreground focus:border-cyan focus:outline-none" />
        <button type="button" onClick={() => { if (newCrit.trim()) { addMgmtCustomCriterion(holdingId, newCrit); setNewCrit(''); } }} disabled={!newCrit.trim()} className="btn-secondary inline-flex items-center gap-1 text-xs disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" />{t('discipline.mgmt.addCrit')}
        </button>
      </div>
    </div>
  );
};

// ===== 第四层：财务指标 =====
export const MetricsLayer: React.FC<{ holdingId: string; metrics: MetricsResponse | null; language: UiLanguage; t: Translate }> = ({ holdingId, metrics, language, t }) => {
  const watched = listMetrics(holdingId);
  const [pick, setPick] = useState<MetricKey | ''>('');
  const [customLabel, setCustomLabel] = useState('');
  const [target, setTarget] = useState('');
  return (
    <div className="space-y-3">
      {watched.length === 0 ? <p className="text-sm text-secondary-text">{t('discipline.metric.empty')}</p> : null}
      {watched.map((w) => {
        const series = w.source === 'builtin' && w.metricKey ? metrics?.metrics?.[w.metricKey as MetricKey] : undefined;
        return (
          <div key={w.id} className="rounded-xl border border-border/60 bg-card/50 p-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                {w.label}
                <span className="ml-1.5 rounded border border-border/60 px-1 py-px text-[0.65rem] text-secondary-text">
                  {w.source === 'builtin' ? t('discipline.metric.builtin') : t('discipline.metric.custom')}
                </span>
              </p>
              <button type="button" onClick={() => removeMetric(w.id)} className="text-secondary-text hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {w.targetNote ? <p className="text-xs text-secondary-text">{t('discipline.metric.target')}: {w.targetNote}</p> : null}
            {series && series.points.length > 0 ? (
              <div className="mt-2">
                <MetricChartView metricKey={w.metricKey as MetricKey} series={series} currency={metrics?.currency ?? ''} language={language} t={t} />
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value as MetricKey | '')} className="h-8 rounded-lg border border-border/70 bg-card/70 px-2 text-sm text-foreground focus:border-cyan focus:outline-none">
            <option value="">{t('discipline.metric.pickBuiltin')}</option>
            {BUILTIN_METRICS.map((k) => (
              <option key={k} value={k}>{t(`valuation.metricName.${k}` as UiTextKey)}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pick}
            onClick={() => {
              if (pick) {
                addMetric(holdingId, { source: 'builtin', metricKey: pick, label: t(`valuation.metricName.${pick}` as UiTextKey) });
                setPick('');
              }
            }}
            className="btn-secondary inline-flex items-center gap-1 text-xs disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />{t('discipline.metric.addBuiltin')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder={t('discipline.metric.customLabel')} className="h-8 flex-1 rounded-lg border border-border/70 bg-card/70 px-2.5 text-sm text-foreground focus:border-cyan focus:outline-none" />
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t('discipline.metric.customTarget')} className="h-8 flex-1 rounded-lg border border-border/70 bg-card/70 px-2.5 text-sm text-foreground focus:border-cyan focus:outline-none" />
          <button
            type="button"
            disabled={!customLabel.trim()}
            onClick={() => {
              if (customLabel.trim()) {
                addMetric(holdingId, { source: 'custom', label: customLabel, targetNote: target });
                setCustomLabel('');
                setTarget('');
              }
            }}
            className="btn-secondary inline-flex items-center gap-1 text-xs disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />{t('discipline.metric.addCustom')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===== 第五层：买卖理由对比 =====
const ReasonColumn: React.FC<{ holdingId: string; type: 'buy' | 'sell'; title: string; t: Translate }> = ({ holdingId, type, title, t }) => {
  const reasons = listReasons(holdingId, type);
  const [text, setText] = useState('');
  const [cat, setCat] = useState<ReasonCategory | ''>('');
  return (
    <div>
      <p className={cn('mb-1 text-xs font-medium', type === 'buy' ? 'text-success' : 'text-danger')}>{title}</p>
      <ul className="space-y-1.5">
        {reasons.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-2.5 py-1.5">
            <div className="min-w-0">
              <p className={cn('text-sm', r.status === 'broken' ? 'text-secondary-text line-through' : 'text-foreground')}>
                {r.category ? <span className="mr-1 rounded border border-cyan/30 bg-cyan/10 px-1 py-px text-[0.6rem] text-cyan">{t(`discipline.cat.${r.category}` as UiTextKey)}</span> : null}
                {r.text}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {type === 'buy' ? (
                <button type="button" onClick={() => setReasonStatus(r.id, r.status === 'active' ? 'broken' : 'active')} className="rounded border border-border/60 px-1.5 py-px text-[0.65rem] text-secondary-text hover:text-foreground">
                  {r.status === 'active' ? t('discipline.markBroken') : t('discipline.restore')}
                </button>
              ) : null}
              <button type="button" onClick={() => removeReason(r.id)} className="text-secondary-text hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCat((p) => (p === c ? '' : c))} className={cn('rounded border px-1 py-px text-[0.6rem]', cat === c ? 'border-cyan/60 bg-cyan/15 text-cyan' : 'border-border/60 text-secondary-text')}>{t(`discipline.cat.${c}` as UiTextKey)}</button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { addReason(holdingId, text, cat || undefined, type); setText(''); setCat(''); } }} placeholder={type === 'buy' ? t('discipline.buyPlaceholder') : t('discipline.sellPlaceholder')} className="h-8 flex-1 rounded-lg border border-border/70 bg-card/70 px-2.5 text-sm text-foreground focus:border-cyan focus:outline-none" />
        <button type="button" onClick={() => { if (text.trim()) { addReason(holdingId, text, cat || undefined, type); setText(''); setCat(''); } }} disabled={!text.trim()} className="btn-secondary inline-flex items-center gap-1 text-xs disabled:opacity-50"><Plus className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
};

export const ReasonsLayer: React.FC<{ holdingId: string; t: Translate }> = ({ holdingId, t }) => {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ReasonColumn holdingId={holdingId} type="buy" title={t('discipline.buyReasons')} t={t} />
      <ReasonColumn holdingId={holdingId} type="sell" title={t('discipline.sellReasons')} t={t} />
    </div>
  );
};
