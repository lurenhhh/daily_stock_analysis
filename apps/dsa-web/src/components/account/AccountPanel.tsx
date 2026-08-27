import React, { useState } from 'react';
import axios from 'axios';
import { LogIn, LogOut, X, Cloud } from 'lucide-react';
import { useUserAccount } from '../../contexts/UserAccountContext';
import { Card } from '../common/Card';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { UiTextKey, UiTextParams } from '../../i18n/uiText';
import { cn } from '../../utils/cn';

type Translate = (key: UiTextKey, params?: UiTextParams) => string;

const inputClass =
  'h-10 w-full rounded-xl border border-border/70 bg-card/70 px-3 text-sm text-foreground transition-colors focus:border-cyan focus:outline-none';

export const AccountPanel: React.FC = () => {
  const { t } = useUiLanguage() as { t: Translate };
  const { user, loading, login, register, logout } = useUserAccount();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return null;
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, nickname.trim() || undefined);
      }
      setOpen(false);
      setPassword('');
    } catch (e) {
      const detail = axios.isAxiosError(e)
        ? (e.response?.data as { detail?: string } | undefined)?.detail
        : undefined;
      setError(detail ?? t('account.error'));
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-2 text-sm">
        <span className="inline-flex items-center gap-2 text-secondary-text">
          <Cloud className="h-4 w-4 text-cyan" />
          {t('account.syncedAs', { who: user.nickname || user.email })}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          className="btn-secondary inline-flex items-center gap-1.5 text-xs"
        >
          <LogOut className="h-3.5 w-3.5" /> {t('account.logout')}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border/60 bg-card/40 px-4 py-2 text-sm">
        <span className="text-secondary-text">{t('account.localOnly')}</span>
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setError(null);
            setOpen(true);
          }}
          className="btn-primary inline-flex items-center gap-1.5 text-xs"
        >
          <LogIn className="h-3.5 w-3.5" /> {t('account.loginRegister')}
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <Card className="relative z-10 w-full max-w-sm rounded-2xl" padding="md">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">
                {mode === 'login' ? t('account.login') : t('account.register')}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-secondary-text transition-colors hover:bg-hover hover:text-foreground"
                aria-label="close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 inline-flex w-full rounded-lg border border-border/60 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={cn('flex-1 rounded-md py-1', mode === 'login' ? 'bg-cyan text-background' : 'text-secondary-text')}
              >
                {t('account.login')}
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={cn('flex-1 rounded-md py-1', mode === 'register' ? 'bg-cyan text-background' : 'text-secondary-text')}
              >
                {t('account.register')}
              </button>
            </div>

            <div className="space-y-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('account.email')}
                className={inputClass}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('account.password')}
                className={inputClass}
              />
              {mode === 'register' ? (
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={t('account.nickname')}
                  className={inputClass}
                />
              ) : null}
            </div>

            {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !email.trim() || !password}
              className="btn-primary mt-3 inline-flex w-full items-center justify-center text-sm disabled:opacity-50"
            >
              {busy ? t('account.submitting') : mode === 'login' ? t('account.login') : t('account.register')}
            </button>
            <p className="mt-2 text-[0.7rem] text-secondary-text/70">{t('account.syncNote')}</p>
          </Card>
        </div>
      ) : null}
    </>
  );
};

export default AccountPanel;
