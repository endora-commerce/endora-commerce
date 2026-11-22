import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ApiError, cn, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  useAppLanguage,
  setPreferredLanguage,
  useTranslation,
} from '@endora-commerce/admin-kit/i18n';
import type { SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';

/**
 * Compact language picker for the top bar (feature 019 / FR-017).
 *
 * Replaces the read-only PL/EN badge — clicking it opens a tiny menu so the
 * admin can switch the UI language from any screen. It is the one place the
 * preference is set: the profile's own language card was removed (issue #1553,
 * UX audit SHELL-17), because it repeated this menu with a second Save.
 */
interface LanguageOption {
  code: SupportedAdminLanguage;
  labelKey: string;
  /** Unicode regional-indicator flag emoji (renders via the OS font). */
  flag: string;
}

const LANGUAGES: ReadonlyArray<LanguageOption> = [
  { code: 'en', labelKey: 'profilePage.language.option.en', flag: '🇬🇧' },
  { code: 'pl', labelKey: 'profilePage.language.option.pl', flag: '🇵🇱' },
];

function flagFor(code: SupportedAdminLanguage): string {
  return LANGUAGES.find((l) => l.code === code)?.flag ?? '';
}

export function LanguagePicker(): ReactNode {
  const t = useTranslation('core');
  const { language, setLanguage } = useAppLanguage();
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click and on Escape, matching standard menu behaviour.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent): void => {
      const node = wrapperRef.current;
      if (node && !node.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = useCallback(
    async (next: SupportedAdminLanguage): Promise<void> => {
      setOpen(false);
      if (next === language || submitting) return;
      const previous = language;
      setSubmitting(true);
      setLanguage(next);
      try {
        await setPreferredLanguage(next);
        await refresh();
      } catch (err) {
        // Roll back the optimistic flip so the UI doesn't lie about what the
        // server stored. Logging only — a transient failure here shouldn't
        // produce a modal; the user can pick the language again.
        setLanguage(previous);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            '[i18n] preferred-language PATCH failed',
            err instanceof ApiError ? err.envelope.error : err,
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [language, refresh, setLanguage, submitting],
  );

  return (
    <div ref={wrapperRef} className="relative mx-1.5">
      <button
        type="button"
        title={t('appShell.languageIndicator.label')}
        aria-label={t('appShell.languageIndicator.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={submitting}
        onClick={(): void => setOpen((v) => !v)}
        // A pill, not `.b2b-topbar__icon-btn`: that class fixes the box at
        // 34×34px, which clips the flag + code + chevron triplet. Same height,
        // colours and hover as the icon buttons beside it; the width grows.
        className={cn(
          'inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[var(--r-sm)] border border-transparent px-2.5',
          'text-[11px] font-semibold leading-none tracking-[0.5px] text-[var(--fg-muted)] transition-colors',
          'hover:bg-[var(--surface-sunken)] hover:text-[var(--fg)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-default',
          open && 'bg-[var(--surface-sunken)]',
        )}
      >
        <span aria-hidden="true" className="text-sm leading-none">
          {flagFor(language)}
        </span>
        <span className="b2b-lang-picker__label">{language.toUpperCase()}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('appShell.languageIndicator.label')}
          className="absolute right-0 top-[calc(100%+4px)] z-[60] min-w-[180px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {LANGUAGES.map(({ code, labelKey, flag }) => {
            const active = code === language;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={(): void => {
                  void pick(code);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left text-[13px]',
                  'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none',
                  active && 'bg-muted',
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="text-base leading-none">
                    {flag}
                  </span>
                  <span className="text-[11px] font-semibold tracking-[0.5px]">{code.toUpperCase()}</span>
                  <span>{t(labelKey)}</span>
                </span>
                {active ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
