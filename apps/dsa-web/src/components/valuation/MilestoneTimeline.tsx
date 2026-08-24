import React, { useEffect, useState } from 'react';
import {
  Milestone,
  Target,
  TrendingUp,
  TrendingDown,
  Activity,
  Rocket,
  GitMerge,
  Package,
  Coins,
  Landmark,
  CircleDot,
  Sparkles,
} from 'lucide-react';
import { valuationApi, type MilestoneItem, type MilestonesResponse } from '../../api/valuation';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { cn } from '../../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;
type IconType = React.FC<{ className?: string }>;

const KIND_META: Record<string, { icon: IconType; dot: string }> = {
  ipo: { icon: Rocket, dot: 'border-success/50 bg-success/15 text-success' },
  ma: { icon: GitMerge, dot: 'border-cyan/50 bg-cyan/15 text-cyan' },
  product: { icon: Package, dot: 'border-warning/50 bg-warning/15 text-warning' },
  capital: { icon: Coins, dot: 'border-primary/50 bg-primary/10 text-[hsl(var(--primary))]' },
  policy: { icon: Landmark, dot: 'border-danger/50 bg-danger/15 text-danger' },
  other: { icon: CircleDot, dot: 'border-border/60 bg-card/70 text-secondary-text' },
};

// A 股习惯：涨红跌绿。
function priceMeta(impact: string): { icon: IconType; dot: string } {
  if (impact === 'up') {
    return { icon: TrendingUp, dot: 'border-danger/50 bg-danger/15 text-danger' };
  }
  if (impact === 'down') {
    return { icon: TrendingDown, dot: 'border-success/50 bg-success/15 text-success' };
  }
  return { icon: Activity, dot: 'border-cyan/50 bg-cyan/15 text-cyan' };
}

const TimelineList: React.FC<{
  items: MilestoneItem[];
  isPrice: boolean;
  emptyText: string;
  t: Translate;
}> = ({ items, isPrice, emptyText, t }) => {
  if (items.length === 0) {
    return <p className="mt-2 text-xs text-secondary-text/70">{emptyText}</p>;
  }
  return (
    <ol className="relative ml-3 mt-2 border-l border-border/60">
      {items.map((m, i) => {
        const meta = isPrice ? priceMeta(m.impact) : KIND_META[m.kind] ?? KIND_META.other;
        const Icon = meta.icon;
        const tagText = isPrice
          ? m.impact === 'up'
            ? t('milestones.impact.up')
            : m.impact === 'down'
              ? t('milestones.impact.down')
              : t('milestones.impact.volatile')
          : t(`milestones.kind.${m.kind}` as UiTextKey);
        return (
          <li key={`${m.date}-${i}`} className="mb-4 ml-5">
            <span
              className={cn(
                'absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full border',
                meta.dot,
              )}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <time className="text-xs font-semibold text-cyan">{m.date}</time>
              <span className={cn('rounded px-1.5 py-px text-[0.65rem]', meta.dot)}>{tagText}</span>
            </div>
            <h4 className="mt-0.5 text-sm font-medium text-foreground">{m.title}</h4>
            {m.detail ? <p className="mt-0.5 text-xs leading-relaxed text-secondary-text">{m.detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
};

export const MilestoneTimeline: React.FC<{ code: string; displayCode: string; name: string | null }> = ({
  code,
  displayCode,
  name,
}) => {
  const { t } = useUiLanguage() as { t: Translate };
  const [data, setData] = useState<MilestonesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // 切换股票时清空旧里程碑（本功能按钮触发，不自动请求）。
  useEffect(() => {
    setData(null);
    setFailed(false);
    setLoading(false);
  }, [code]);

  const generate = async () => {
    if (!code || loading) {
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const res = await valuationApi.getMilestones(code, { name: name ?? '' });
      if (res.supported) {
        setData(res);
      } else {
        setData(null);
        setFailed(true);
      }
    } catch {
      setData(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const hasData = !!data && data.supported;

  const columns: { key: 'general' | 'strategy' | 'price'; icon: IconType; title: string; isPrice: boolean }[] = [
    { key: 'general', icon: Milestone, title: t('milestones.col.general'), isPrice: false },
    { key: 'strategy', icon: Target, title: t('milestones.col.strategy'), isPrice: false },
    { key: 'price', icon: TrendingUp, title: t('milestones.col.price'), isPrice: true },
  ];

  return (
    <Card className="rounded-2xl" padding="md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Milestone className="h-5 w-5 text-cyan" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t('milestones.title')}</h3>
            <p className="text-xs text-secondary-text">
              {name ? `${name} · ` : ''}{displayCode} · {t('milestones.subtitle')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!code || loading}
          className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
        >
          <Sparkles className={cn('h-4 w-4', loading ? 'animate-pulse' : '')} />
          {loading ? t('milestones.generating') : hasData ? t('milestones.regenerate') : t('milestones.generate')}
        </button>
      </div>

      {hasData ? (
        <>
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-3">
            {columns.map((col) => {
              const ColIcon = col.icon;
              return (
                <div key={col.key}>
                  <div className="mb-1 flex items-center gap-1.5 border-b border-border/50 pb-2">
                    <ColIcon className="h-4 w-4 text-cyan" />
                    <h4 className="text-sm font-semibold text-foreground">{col.title}</h4>
                  </div>
                  <TimelineList items={data![col.key]} isPrice={col.isPrice} emptyText={t('milestones.colEmpty')} t={t} />
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-secondary-text/80">{t('milestones.disclaimer')}</p>
        </>
      ) : (
        <div className="flex min-h-[80px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-surface-2/30 px-4 py-6 text-center">
          <p className="text-sm text-secondary-text">
            {loading ? t('milestones.generating') : failed ? t('milestones.failed') : t('milestones.empty')}
          </p>
        </div>
      )}
    </Card>
  );
};

export default MilestoneTimeline;
