import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Play, Check, Loader2, ArrowUpRight } from 'lucide-react';
import { valuationApi, type ScreenPoolItem } from '../../api/valuation';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { cn } from '../../utils/cn';
import { allPass, evaluateAll, type ScreenCondition } from '../../utils/valuationScreen';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

interface Row {
  code: string;
  name: string;
  pass: boolean;
  failed: number;
  error?: boolean;
}

const POOLS = ['sse50', 'hs300', 'zz500', 'watchlist', 'alla'] as const;
type PoolKey = (typeof POOLS)[number];

// 逐只请求较慢，控制并发既提速又避免打爆数据源。
const CONCURRENCY = 4;

async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) {
        return;
      }
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

export const BatchScreenModal: React.FC<{ conditions: ScreenCondition[]; onClose: () => void }> = ({ conditions, onClose }) => {
  const { t } = useUiLanguage() as { t: Translate };
  const navigate = useNavigate();
  const [pool, setPool] = useState<PoolKey>('sse50');
  const [loadingPool, setLoadingPool] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<Row[]>([]);
  const [onlyPass, setOnlyPass] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const cancelled = useRef(false);

  const close = () => {
    cancelled.current = true;
    onClose();
  };

  const goTo = (code: string) => {
    cancelled.current = true;
    onClose();
    navigate(`/valuation?code=${encodeURIComponent(code)}`);
  };

  const run = async () => {
    if (conditions.length === 0) {
      return;
    }
    cancelled.current = false;
    setRows([]);
    setNote(null);
    setLoadingPool(true);
    let items: ScreenPoolItem[] = [];
    try {
      const res = await valuationApi.getScreenPool(pool);
      items = res.supported ? res.items : [];
      if (!res.supported || items.length === 0) {
        setNote(res.message || t('screen.poolLoadError'));
        setLoadingPool(false);
        return;
      }
    } catch {
      setNote(t('screen.poolLoadError'));
      setLoadingPool(false);
      return;
    }
    setLoadingPool(false);
    if (cancelled.current) {
      return;
    }

    setRunning(true);
    setProgress({ done: 0, total: items.length });
    const collected: Row[] = [];
    let done = 0;
    await runPool(items, CONCURRENCY, async (item) => {
      if (cancelled.current) {
        return;
      }
      let row: Row;
      try {
        const [pe, metrics, fundamentals] = await Promise.all([
          valuationApi.getPeHistory(item.code, { years: 20 }).catch(() => null),
          valuationApi.getMetrics(item.code, { years: 20 }).catch(() => null),
          valuationApi.getFundamentals(item.code, { years: 20 }).catch(() => null),
        ]);
        const results = evaluateAll(conditions, { pe, metrics, fundamentals });
        const failed = results.filter((r) => r.status !== 'pass').length;
        row = { code: item.code, name: item.name, pass: allPass(results), failed };
      } catch {
        row = { code: item.code, name: item.name, pass: false, failed: conditions.length, error: true };
      }
      collected.push(row);
      done += 1;
      if (!cancelled.current) {
        setRows([...collected]);
        setProgress({ done, total: items.length });
      }
    });
    if (!cancelled.current) {
      setRunning(false);
    }
  };

  const shown = onlyPass ? rows.filter((r) => r.pass) : rows;
  const passCount = rows.filter((r) => r.pass).length;
  const busy = loadingPool || running;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden="true" />
      <Card className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl" padding="md">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">{t('screen.batchTitle')}</h3>
          <button type="button" onClick={close} className="rounded-lg p-1 text-secondary-text hover:bg-hover hover:text-foreground" aria-label="close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-2 text-xs text-secondary-text/80">{t('screen.batchHint')}</p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-secondary-text">
            {t('screen.poolLabel')}
            <select
              value={pool}
              onChange={(e) => setPool(e.target.value as PoolKey)}
              disabled={busy}
              className="rounded-lg border border-border/70 bg-card/70 px-2 py-1 text-xs text-foreground focus:border-cyan focus:outline-none disabled:opacity-50"
            >
              {POOLS.map((p) => (
                <option key={p} value={p}>
                  {t(`screen.pool.${p}` as UiTextKey)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || conditions.length === 0}
            className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loadingPool ? t('screen.loadingPool') : running ? t('screen.running') : t('screen.run')}
          </button>
          {running ? (
            <button type="button" onClick={() => { cancelled.current = true; setRunning(false); }} className="btn-secondary text-xs">
              {t('screen.cancel')}
            </button>
          ) : null}
        </div>

        <p className="mt-2 text-[0.7rem] text-secondary-text/70">{t('screen.timeHint')}</p>
        {pool === 'alla' ? (
          <p className="mt-1 rounded-lg border border-warning/30 bg-warning/10 px-2 py-1 text-[0.7rem] text-warning">{t('screen.allaWarn')}</p>
        ) : null}

        {progress.total > 0 ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/50">
              <div className="h-full rounded-full bg-cyan transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <span className="text-xs text-secondary-text">{t('screen.progress', { done: progress.done, total: progress.total })}</span>
          </div>
        ) : null}

        {note ? <p className="mt-2 text-xs text-warning">{note}</p> : null}
        {conditions.length === 0 ? <p className="mt-2 text-xs text-warning">{t('screen.noConditions')}</p> : null}

        {rows.length > 0 ? (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-secondary-text">{t('screen.passLabel')} · {passCount}/{rows.length}</span>
            <label className="inline-flex items-center gap-1 text-xs text-secondary-text">
              <input type="checkbox" checked={onlyPass} onChange={(e) => setOnlyPass(e.target.checked)} />
              {t('screen.onlyPass')}
            </label>
          </div>
        ) : null}

        {shown.length > 0 ? (
          <ul className="mt-2 space-y-1 overflow-y-auto">
            {shown.map((r) =>
              r.pass ? (
                <li key={r.code}>
                  <button
                    type="button"
                    onClick={() => goTo(r.code)}
                    title={t('screen.openStock')}
                    className="group flex w-full items-center justify-between rounded-lg border border-success/30 bg-success/5 px-3 py-1.5 text-sm transition-colors hover:border-success/60 hover:bg-success/10"
                  >
                    <span className="text-foreground">
                      {r.code}
                      {r.name ? <span className="ml-2 text-secondary-text">{r.name}</span> : null}
                    </span>
                    <span className="inline-flex items-center gap-1 text-success">
                      <Check className="h-3.5 w-3.5" />
                      {t('screen.passLabel')}
                      <ArrowUpRight className="h-3.5 w-3.5 opacity-60 transition-opacity group-hover:opacity-100" />
                    </span>
                  </button>
                </li>
              ) : (
                <li key={r.code} className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 text-sm">
                  <span className="text-foreground">
                    {r.code}
                    {r.name ? <span className="ml-2 text-secondary-text">{r.name}</span> : null}
                  </span>
                  <span className={cn('text-xs', r.error ? 'text-secondary-text' : 'text-danger')}>
                    {r.error ? t('screen.fetchError') : `${t('screen.failLabel')} · ${t('screen.failedCount', { n: r.failed })}`}
                  </span>
                </li>
              ),
            )}
          </ul>
        ) : !busy && rows.length > 0 && shown.length === 0 ? (
          <p className="mt-3 text-xs text-secondary-text">{t('screen.emptyResult')}</p>
        ) : null}
      </Card>
    </div>
  );
};

export default BatchScreenModal;
