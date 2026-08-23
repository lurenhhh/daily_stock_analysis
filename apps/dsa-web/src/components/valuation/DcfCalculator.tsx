import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, RefreshCw, Sparkles } from 'lucide-react';
import { valuationApi, type DcfReferenceResponse, type DcfScenario } from '../../api/valuation';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiLanguage, UiTextKey, UiTextParams } from '../../i18n/uiText';
import { fmtNumber } from './chartUtils';
import { cn } from '../../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

interface DcfInputs {
  fcf: string;
  discount: string;
  growth: string;
  years: string;
  perpetual: string;
}

function computeDcf(inputs: DcfInputs): { valid: boolean; intrinsic: number } {
  const fcf0 = Number.parseFloat(inputs.fcf);
  const r = Number.parseFloat(inputs.discount) / 100;
  const g1 = Number.parseFloat(inputs.growth) / 100;
  const n = Math.round(Number.parseFloat(inputs.years));
  const gp = Number.parseFloat(inputs.perpetual) / 100;

  const finite = [fcf0, r, g1, gp].every((v) => Number.isFinite(v)) && Number.isFinite(n);
  if (!finite || n < 1 || n > 50 || r <= 0 || r <= gp) {
    return { valid: false, intrinsic: 0 };
  }
  let stage1 = 0;
  for (let t = 1; t <= n; t += 1) {
    stage1 += (fcf0 * (1 + g1) ** t) / (1 + r) ** t;
  }
  const fcfN = fcf0 * (1 + g1) ** n;
  const pvTerminal = ((fcfN * (1 + gp)) / (r - gp)) / (1 + r) ** n;
  return { valid: true, intrinsic: stage1 + pvTerminal };
}

const SCENARIO_KEYS: (keyof DcfScenario)[] = ['bear', 'base', 'bull'];

const ScenarioRow: React.FC<{
  tag: string;
  scenario: DcfScenario;
  activeId: string | undefined;
  digits: number;
  tone: 'hist' | 'ai';
  onPick: (id: string, v: string) => void;
  language: UiLanguage;
  t: Translate;
}> = ({ tag, scenario, activeId, digits, tone, onPick, language, t }) => (
  <div className="mt-1 flex items-center gap-0.5">
    <span className={cn('w-4 shrink-0 text-[0.55rem] leading-none', tone === 'ai' ? 'text-cyan/80' : 'text-secondary-text/60')}>{tag}</span>
    <div className="flex min-w-0 flex-1 gap-0.5 overflow-hidden">
      {SCENARIO_KEYS.map((key) => {
        const num = scenario[key];
        const id = `${tone}:${key}`;
        const active = activeId === id;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(id, String(num))}
            title={t(`dcf.sc.${key}` as UiTextKey)}
            className={cn(
              'inline-flex min-w-0 flex-1 items-center justify-center gap-px overflow-hidden whitespace-nowrap rounded border px-0.5 py-0 text-[0.5rem] leading-none transition-colors',
              active
                ? tone === 'ai'
                  ? 'border-cyan/60 bg-cyan/20 text-cyan'
                  : 'border-primary/50 bg-primary/10 text-[hsl(var(--primary))]'
                : 'border-border/50 bg-card/40 text-secondary-text/70 hover:bg-hover hover:text-foreground',
            )}
          >
            <span className="opacity-70">{t(`dcf.sc.${key}` as UiTextKey)}</span>
            <span className="font-medium">{fmtNumber(num, language, digits)}</span>
          </button>
        );
      })}
    </div>
  </div>
);

const Field: React.FC<{
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (id: string, v: string) => void;
  activeId: string | undefined;
  baseScenario: DcfScenario | null;
  aiScenario: DcfScenario | null;
  digits: number;
  naHint?: string;
  step?: string;
  language: UiLanguage;
  t: Translate;
}> = ({ label, unit, value, onChange, onPick, activeId, baseScenario, aiScenario, digits, naHint, step, language, t }) => (
  <div className="flex flex-col">
    <label className="mb-1 text-xs font-medium text-secondary-text">{label}</label>
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        step={step ?? 'any'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-border/70 bg-card/70 px-3 pr-12 text-sm text-foreground transition-colors focus:border-cyan focus:outline-none"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-secondary-text">{unit}</span>
    </div>
    {baseScenario ? (
      <ScenarioRow tag={t('dcf.rowHist')} scenario={baseScenario} activeId={activeId} digits={digits} tone="hist" onPick={onPick} language={language} t={t} />
    ) : (
      <p className="mt-1 text-[0.7rem] leading-tight text-secondary-text/80">{naHint}</p>
    )}
    {aiScenario ? (
      <ScenarioRow tag={t('dcf.rowAi')} scenario={aiScenario} activeId={activeId} digits={digits} tone="ai" onPick={onPick} language={language} t={t} />
    ) : null}
  </div>
);

const GROWTH_FALLBACK: DcfScenario = { bear: 5, base: 10, bull: 15 };

export const DcfCalculator: React.FC<{ code: string; displayCode: string; name: string | null }> = ({
  code,
  displayCode,
  name,
}) => {
  const { language, t } = useUiLanguage() as { language: UiLanguage; t: Translate };
  const [baseRef, setBaseRef] = useState<DcfReferenceResponse | null>(null);
  const [llmRef, setLlmRef] = useState<DcfReferenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [llmLoading, setLlmLoading] = useState(false);
  const [inputs, setInputs] = useState<DcfInputs>({
    fcf: '',
    discount: '8',
    growth: '10',
    years: '5',
    perpetual: '3',
  });
  // 记录每个指标当前「选中」的是哪一个 chip（形如 "hist:base" / "ai:bull"）。
  // 只有被选中的 chip 高亮，其余保持暗色；手动改输入框会清除该指标的选中态。
  const [picked, setPicked] = useState<Partial<Record<keyof DcfInputs, string>>>({});

  const applyReference = (ref: DcfReferenceResponse, source: 'hist' | 'ai') => {
    // 有返回值就填入该字段的中等值并把「中等」设为选中；没有返回值就置空、无选中。
    const nextInputs: DcfInputs = {
      fcf: ref.fcf ? String(ref.fcf.base) : '',
      discount: ref.discount ? String(ref.discount.base) : '',
      growth: ref.growth ? String(ref.growth.base) : '',
      years: ref.years ? String(ref.years.base) : '',
      perpetual: ref.perpetual ? String(ref.perpetual.base) : '',
    };
    const nextPicked: Partial<Record<keyof DcfInputs, string>> = {};
    (Object.keys(nextInputs) as (keyof DcfInputs)[]).forEach((k) => {
      if (nextInputs[k] !== '') {
        nextPicked[k] = `${source}:base`;
      }
    });
    setInputs(nextInputs);
    setPicked(nextPicked);
  };

  const inferWithLlm = async () => {
    if (!code || llmLoading) {
      return;
    }
    setLlmLoading(true);
    try {
      const res = await valuationApi.getDcfReference(code, { useLlm: true });
      // 只有 LLM 真正推理出至少一个字段（或给出依据）时才启用 AI 行；
      // 否则保持历史值、按钮可重试。
      const hasAiValue = Boolean(
        res.fcf || res.discount || res.growth || res.years || res.perpetual || res.rationale,
      );
      if (hasAiValue) {
        setLlmRef(res);
        applyReference(res, 'ai'); // 仅用 AI 推理出的字段填入
      }
    } catch {
      /* 保持历史推算 */
    } finally {
      setLlmLoading(false);
    }
  };

  useEffect(() => {
    if (!code) {
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setBaseRef(null);
      setLlmRef(null);
      try {
        const res = await valuationApi.getDcfReference(code, {}, { signal: controller.signal });
        if (!cancelled) {
          setBaseRef(res);
          applyReference(res, 'hist');
        }
      } catch {
        if (!cancelled) {
          setBaseRef(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [code]);

  const result = useMemo(() => computeDcf(inputs), [inputs]);

  const ctx = llmRef ?? baseRef; // 市值/股价/货币两套一致，取任一
  const currency = ctx?.currency || 'CNY';
  const yiUnit = `${t('valuation.unitYi')}${currency ? ` ${currency}` : ''}`;
  const marketCap = ctx?.marketCap ?? null;
  const price = ctx?.price ?? null;
  const margin = result.valid && marketCap && marketCap > 0
    ? (result.intrinsic - marketCap) / marketCap * 100
    : null;
  const perShare = result.valid && marketCap && marketCap > 0 && price && price > 0
    ? (result.intrinsic / marketCap) * price
    : null;
  const zone = margin == null ? null : margin > 15 ? 'under' : margin < -15 ? 'over' : 'fair';
  const zoneClass: Record<string, string> = {
    under: 'border-success/30 bg-success/10 text-success',
    fair: 'border-warning/30 bg-warning/10 text-warning',
    over: 'border-danger/30 bg-danger/10 text-danger',
  };

  // 手动编辑输入框：更新值并清除该指标的 chip 选中态。
  const set = (key: keyof DcfInputs) => (v: string) => {
    setInputs((prev) => ({ ...prev, [key]: v }));
    setPicked((prev) => {
      if (!(key in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // 点击某个 chip：填入其值并把该指标选中态设为该 chip。
  const pick = (key: keyof DcfInputs) => (id: string, v: string) => {
    setInputs((prev) => ({ ...prev, [key]: v }));
    setPicked((prev) => ({ ...prev, [key]: id }));
  };

  const fields: {
    key: keyof DcfInputs;
    label: string;
    unit: string;
    digits: number;
    step?: string;
    base: DcfScenario | null;
    ai: DcfScenario | null;
    naHint?: string;
  }[] = [
    {
      key: 'fcf', label: t('dcf.field.fcf'), unit: t('valuation.unitYi'), digits: 2,
      base: baseRef?.fcf ?? null, ai: llmRef?.fcf ?? null,
      naHint: loading ? t('dcf.loading') : t('dcf.ref.fcfNa'),
    },
    {
      key: 'discount', label: t('dcf.field.discount'), unit: '%', digits: 1,
      base: baseRef?.discount ?? { bear: 10, base: 8, bull: 7 }, ai: llmRef?.discount ?? null,
    },
    {
      key: 'growth', label: t('dcf.field.growth'), unit: '%', digits: 1,
      base: baseRef?.growth ?? GROWTH_FALLBACK, ai: llmRef?.growth ?? null,
    },
    {
      key: 'years', label: t('dcf.field.years'), unit: t('dcf.unit.years'), digits: 0, step: '1',
      base: baseRef?.years ?? { bear: 3, base: 5, bull: 10 }, ai: llmRef?.years ?? null,
    },
    {
      key: 'perpetual', label: t('dcf.field.perpetual'), unit: '%', digits: 1,
      base: baseRef?.perpetual ?? { bear: 2, base: 3, bull: 4 }, ai: llmRef?.perpetual ?? null,
    },
  ];

  return (
    <Card className="rounded-2xl" padding="md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-cyan" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t('dcf.title')}</h3>
            <p className="text-xs text-secondary-text">
              {name ? `${name} · ` : ''}{displayCode} · {t('dcf.subtitle')}
            </p>
            {llmRef?.rationale ? (
              <p className="mt-1 text-xs">
                <span className="mr-2 inline-flex items-center rounded-md border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 text-[0.7rem] text-cyan">
                  {t('dcf.source.llm')}
                </span>
                <span className="text-secondary-text">{llmRef.rationale}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void inferWithLlm()}
            disabled={!code || loading || llmLoading || !!llmRef}
            className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <Sparkles className={cn('h-4 w-4', llmLoading ? 'animate-pulse' : '')} />
            {llmLoading ? t('dcf.inferring') : llmRef ? t('dcf.inferred') : t('dcf.aiInfer')}
          </button>
          <button
            type="button"
            onClick={() => (ctx ? applyReference(ctx, ctx === llmRef ? 'ai' : 'hist') : undefined)}
            disabled={!ctx || loading}
            className="btn-secondary inline-flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
            {t('dcf.useMedium')}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {fields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            unit={f.unit}
            value={inputs[f.key]}
            onChange={set(f.key)}
            onPick={pick(f.key)}
            activeId={picked[f.key]}
            baseScenario={f.base}
            aiScenario={f.ai}
            digits={f.digits}
            naHint={f.naHint}
            step={f.step}
            language={language}
            t={t}
          />
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-border/70 bg-surface-2/40 p-4">
        {!result.valid ? (
          <p className="text-sm text-warning">{t('dcf.invalid')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            {perShare != null ? (
              <div>
                <p className="text-xs text-secondary-text">{t('dcf.result.perShare')}</p>
                <p className={cn('mt-1 text-2xl font-semibold', price != null && perShare >= price ? 'text-success' : 'text-danger')}>
                  {fmtNumber(perShare, language, 2)} <span className="text-sm font-normal text-secondary-text">{currency}</span>
                </p>
              </div>
            ) : null}
            {price != null ? (
              <div>
                <p className="text-xs text-secondary-text">{t('dcf.result.price')}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">
                  {fmtNumber(price, language, 2)} <span className="text-sm font-normal text-secondary-text">{currency}</span>
                </p>
              </div>
            ) : null}
            <div>
              <p className="text-xs text-secondary-text">{t('dcf.result.intrinsic')}</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {fmtNumber(result.intrinsic, language, 0)} <span className="text-sm font-normal text-secondary-text">{yiUnit}</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-secondary-text">{t('dcf.result.marketCap')}</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {marketCap != null ? fmtNumber(marketCap, language, 0) : '—'} <span className="text-sm font-normal text-secondary-text">{yiUnit}</span>
              </p>
            </div>
            {margin != null && zone ? (
              <>
                <div>
                  <p className="text-xs text-secondary-text">{t('dcf.result.margin')}</p>
                  <p className={cn('mt-1 text-2xl font-semibold', margin >= 0 ? 'text-success' : 'text-danger')}>
                    {margin >= 0 ? '+' : ''}{fmtNumber(margin, language, 1)}%
                  </p>
                </div>
                <span className={cn('inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium', zoneClass[zone])}>
                  {t(`dcf.zone.${zone}` as UiTextKey)}
                </span>
              </>
            ) : (
              <p className="text-sm text-secondary-text">{t('dcf.result.noMarketCap')}</p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-secondary-text">{t('dcf.footnote')}</p>
      </div>
    </Card>
  );
};

export default DcfCalculator;
