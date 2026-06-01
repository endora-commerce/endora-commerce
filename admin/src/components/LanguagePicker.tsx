import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useAppLanguage } from '@/i18n/app-language-context';
import { setPreferredLanguage } from '@/i18n/language-storage';
import { useTranslation } from '@/i18n/useTranslation';
import type { SupportedAdminLanguage } from '@/i18n/types';

/**
 * Compact language picker for the top bar (feature 019 / FR-017).
 *
 * Replaces the read-only PL/EN badge — clicking it opens a tiny menu so the
 * admin can switch the UI language from any screen. Reuses the same backend
 * round-trip and AppLanguageContext flip that ProfilePage's language section
 * performs, so the two stay in sync.
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
        // produce a modal; the user can retry from /profile if it persists.
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
    <div ref={wrapperRef} style={{ position: 'relative', margin: '0 6px' }}>
      <button
        type="button"
        title={t('appShell.languageIndicator.label')}
        aria-label={t('appShell.languageIndicator.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={submitting}
        onClick={(): void => setOpen((v) => !v)}
        // Custom pill style — the topbar's icon-btn class fixes the box at
        // 34×34px which clips the flag + code + chevron triplet. Match the
        // same hover treatment but let the width grow to fit the content.
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 34,
          padding: '0 10px',
          border: '1px solid transparent',
          borderRadius: 'var(--r-sm)',
          background: open ? 'var(--surface-sunken)' : 'transparent',
          color: 'var(--fg-muted)',
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: 0.5,
          lineHeight: 1,
          cursor: submitting ? 'default' : 'pointer',
          transition: 'background .12s, color .12s',
        }}
        onMouseEnter={(e): void => {
          e.currentTarget.style.background = 'var(--surface-sunken)';
          e.currentTarget.style.color = 'var(--fg)';
        }}
        onMouseLeave={(e): void => {
          if (!open) e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--fg-muted)';
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
          {flagFor(language)}
        </span>
        <span className="b2b-lang-picker__label">{language.toUpperCase()}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('appShell.languageIndicator.label')}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 180,
            background: 'var(--surface, white)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
            padding: 4,
            zIndex: 60,
          }}
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
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: active ? 'var(--surface-2, rgba(0,0,0,0.04))' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  textAlign: 'left',
                  color: 'inherit',
                  gap: 8,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
                    {flag}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 11, letterSpacing: 0.5 }}>
                    {code.toUpperCase()}
                  </span>
                  <span>{t(labelKey)}</span>
                </span>
                {active ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
