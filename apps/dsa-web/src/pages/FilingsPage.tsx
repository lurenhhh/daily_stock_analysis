import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, RefreshCw } from 'lucide-react';
import { filingsApi, type FilingsResponse } from '../api/filings';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { ApiErrorAlert, AppPage, Card, EmptyState, PageHeader } from '../components/common';
import { FilingList } from '../components/filings/FilingList';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../i18n/uiText';
import { cn } from '../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const TYPE_OPTIONS = ['all', 'annual', 'interim', 'q1', 'q3'] as const;

const FilingsPage: React.FC = () => {
  const { t } = useUiLanguage() as { t: Translate };
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputValue, setInputValue] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [type, setType] = useState<string>('all');
  const [year, setYear] = useState<string>('all');
  const [data, setData] = useState<FilingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const initedRef = useRef(false);

  const runQuery = useCallback(async (code: string, nextType: string, refresh = false) => {
    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoading(true);
    setError(null);
    try {
      const res = await filingsApi.getFilings(trimmed, { type: nextType, refresh }, { signal: controller.signal });
      if (seq !== seqRef.current) {
        return;
      }
      setData(res);
    } catch (err) {
      if (controller.signal.aborted || seq !== seqRef.current) {
        return;
      }
      setError(getParsedApiError(err));
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // 深链：从估值页跳转，读取 code / year 自动查询。
  useEffect(() => {
    if (initedRef.current) {
      return;
    }
    initedRef.current = true;
    const qCode = searchParams.get('code');
    const qYear = searchParams.get('year');
    if (qCode) {
      setInputValue(qCode);
      setActiveCode(qCode);
      if (qYear) {
        setYear(qYear);
      }
      void runQuery(qCode, 'all');
    }
  }, [searchParams, runQuery]);

  const handleSubmit = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) {
        return;
      }
      setActiveCode(trimmed);
      setType('all');
      setYear('all');
      setSearchParams({ code: trimmed });
      void runQuery(trimmed, 'all');
    },
    [runQuery, setSearchParams],
  );

  const handleType = (next: string) => {
    setType(next);
    if (activeCode) {
      void runQuery(activeCode, next);
    }
  };

  const years = useMemo(() => {
    const set = new Set<string>();
    (data?.items ?? []).forEach((f) => {
      const y = (f.reportPeriod || f.publishDate || '').slice(0, 4);
      if (y) {
        set.add(y);
      }
    });
    return Array.from(set).sort().reverse();
  }, [data]);

  const shownItems = useMemo(() => {
    const items = data?.items ?? [];
    if (year === 'all') {
      return items;
    }
    return items.filter((f) => (f.reportPeriod || '').startsWith(year) || (f.publishDate || '').startsWith(year));
  }, [data, year]);

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader
          eyebrow={t('filings.eyebrow')}
          title={t('filings.title')}
          description={t('filings.description')}
          actions={
            activeCode ? (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => void runQuery(activeCode, type, true)}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
                {t('filings.refresh')}
              </button>
            ) : undefined
          }
        />

        <Card className="rounded-2xl" padding="md">
          <label className="label-uppercase" htmlFor="filings-search">
            {t('filings.searchLabel')}
          </label>
          <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex-1">
              <StockAutocomplete
                value={inputValue}
                onChange={setInputValue}
                onSubmit={(code) => handleSubmit(code)}
                placeholder={t('filings.searchPlaceholder')}
                ariaLabel={t('filings.searchLabel')}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap rounded-xl border border-border/70 bg-card/70 p-1">
                {TYPE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleType(option)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm transition-colors',
                      type === option
                        ? 'bg-cyan text-background shadow-soft-card'
                        : 'text-secondary-text hover:bg-hover hover:text-foreground',
                    )}
                  >
                    {t(`filings.type.${option}` as UiTextKey)}
                  </button>
                ))}
              </div>
              {years.length > 0 ? (
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="h-9 rounded-xl border border-border/70 bg-card/70 px-3 text-sm text-foreground focus:border-cyan focus:outline-none"
                >
                  <option value="all">{t('filings.allYears')}</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>
        </Card>

        {error ? (
          <ApiErrorAlert
            error={error}
            actionLabel={t('common.retry')}
            onAction={() => (activeCode ? void runQuery(activeCode, type, true) : undefined)}
          />
        ) : null}

        {loading ? (
          <div className="h-40 w-full animate-pulse rounded-2xl border border-border/60 bg-card/50" />
        ) : data && !data.supported ? (
          <EmptyState
            title={t('filings.unsupportedTitle')}
            description={data.message ?? t('filings.unsupportedDesc')}
            icon={<FileText className="h-8 w-8" />}
          />
        ) : data && shownItems.length > 0 ? (
          <>
            <p className="text-xs text-secondary-text/80">{t('filings.originNote')}</p>
            <FilingList items={shownItems} t={t} />
            <p className="pt-1 text-xs text-secondary-text/70">{t('filings.disclaimer')}</p>
          </>
        ) : data ? (
          <EmptyState
            title={t('filings.noResultTitle')}
            description={data.message ?? t('filings.noResultDesc')}
            icon={<FileText className="h-8 w-8" />}
          />
        ) : (
          <EmptyState
            title={t('filings.emptyTitle')}
            description={t('filings.emptyDesc')}
            icon={<FileText className="h-8 w-8" />}
          />
        )}
      </div>
    </AppPage>
  );
};

export default FilingsPage;
