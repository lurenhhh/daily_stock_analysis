import React, { useEffect, useState } from 'react';
import { Users, UserRound, Award, AlertTriangle, Sparkles, History, Briefcase, Star, CircleDot } from 'lucide-react';
import { valuationApi, type LeadersResponse } from '../../api/valuation';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { cn } from '../../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

export const LeadersPanel: React.FC<{ code: string; displayCode: string; name: string | null }> = ({
  code,
  displayCode,
  name,
}) => {
  const { t } = useUiLanguage() as { t: Translate };
  const [data, setData] = useState<LeadersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // 切换股票时清空（按钮触发，不自动请求）。
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
      const res = await valuationApi.getLeaders(code, { name: name ?? '' });
      if (res.supported && res.leaders.length > 0) {
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

  const hasData = !!data && data.leaders.length > 0;

  return (
    <Card className="rounded-2xl" padding="md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-cyan" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t('leaders.title')}</h3>
            <p className="text-xs text-secondary-text">
              {name ? `${name} · ` : ''}{displayCode} · {t('leaders.subtitle')}
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
          {loading ? t('leaders.generating') : hasData ? t('leaders.regenerate') : t('leaders.generate')}
        </button>
      </div>

      {hasData ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {data!.leaders.map((leader, i) => (
              <div key={`${leader.name}-${i}`} className="rounded-xl border border-border/60 bg-surface-2/30 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan/40 bg-cyan/10 text-cyan">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h4 className="text-sm font-semibold text-foreground">{leader.name}</h4>
                      <span className="text-xs text-cyan">{leader.title}</span>
                    </div>
                    {leader.tenure ? <p className="text-[0.7rem] text-secondary-text">{leader.tenure}</p> : null}
                  </div>
                </div>

                {leader.intro ? (
                  <p className="mt-2 text-xs leading-relaxed text-secondary-text">{leader.intro}</p>
                ) : null}

                {leader.timeline.length > 0 ? (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center gap-1 text-xs font-medium text-cyan">
                      <History className="h-3.5 w-3.5" />
                      {t('leaders.timeline')}
                    </div>
                    <ol className="relative ml-2 border-l border-border/60">
                      {leader.timeline.map((ev, j) => {
                        const isRole = ev.kind === 'role';
                        const isDeed = ev.kind === 'deed';
                        const EvIcon = isRole ? Briefcase : isDeed ? Star : CircleDot;
                        const tone = isRole
                          ? 'border-cyan/50 bg-cyan/15 text-cyan'
                          : isDeed
                            ? 'border-warning/50 bg-warning/15 text-warning'
                            : 'border-border/60 bg-card/70 text-secondary-text';
                        return (
                          <li key={j} className="mb-2.5 ml-4">
                            <span
                              className={cn(
                                'absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full border',
                                tone,
                              )}
                            >
                              <EvIcon className="h-2.5 w-2.5" />
                            </span>
                            <div className="flex flex-wrap items-baseline gap-x-1.5">
                              <time className="text-[0.7rem] font-semibold text-cyan">{ev.date}</time>
                              <span className="text-xs leading-relaxed text-secondary-text">{ev.event}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ) : null}

                {leader.achievements.length > 0 ? (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center gap-1 text-xs font-medium text-success">
                      <Award className="h-3.5 w-3.5" />
                      {t('leaders.achievements')}
                    </div>
                    <ul className="space-y-1">
                      {leader.achievements.map((a, j) => (
                        <li key={j} className="flex gap-1.5 text-xs leading-relaxed text-secondary-text">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-success" />
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-3">
                  <div className="mb-1 flex items-center gap-1 text-xs font-medium text-danger">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t('leaders.controversies')}
                  </div>
                  {leader.controversies.length > 0 ? (
                    <ul className="space-y-1">
                      {leader.controversies.map((c, j) => (
                        <li key={j} className="flex gap-1.5 text-xs leading-relaxed text-secondary-text">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-danger" />
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-secondary-text/70">{t('leaders.noControversies')}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-secondary-text/80">{t('leaders.disclaimer')}</p>
        </>
      ) : (
        <div className="flex min-h-[80px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-surface-2/30 px-4 py-6 text-center">
          <p className="text-sm text-secondary-text">
            {loading ? t('leaders.generating') : failed ? t('leaders.failed') : t('leaders.empty')}
          </p>
        </div>
      )}
    </Card>
  );
};

export default LeadersPanel;
