import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { ApiError, cn, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  InlineStatus,
} from '@endora-commerce/admin-kit/ui';
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
 *
 * The menu is the kit's `DropdownMenu` (issue #1783): arrow keys, Home/End,
 * type-ahead on the language name, Escape giving focus back to the trigger —
 * the contract every other admin menu keeps (Jakob's Law).
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
  const [saveFailed, setSaveFailed] = useState(false);
  const errorId = useId();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // A save error outlives the menu, which Radix dismisses itself; dismiss the
  // error the same two ways while the menu is closed — outside click, Escape.
  useEffect(() => {
    if (!saveFailed || open) return;
    const onPointer = (e: MouseEvent): void => {
      const node = wrapperRef.current;
      if (node && !node.contains(e.target as Node)) setSaveFailed(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSaveFailed(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, saveFailed]);

  const onOpenChange = useCallback(
    (next: boolean): void => {
      // Busy, the trigger is `aria-disabled` rather than `disabled`, so it can
      // take focus back from the menu; it is this guard that keeps it shut.
      if (next && submitting) return;
      if (next) setSaveFailed(false);
      setOpen(next);
    },
    [submitting],
  );

  const pick = useCallback(
    async (next: SupportedAdminLanguage): Promise<void> => {
      setOpen(false);
      if (next === language || submitting) return;
      const previous = language;
      setSaveFailed(false);
      setSubmitting(true);
      setLanguage(next);
      let saved = false;
      try {
        await setPreferredLanguage(next);
        saved = true;
        await refresh();
      } catch (err) {
        if (!saved) {
          setSaveFailed(true);
          // Roll back only when the preference save failed; a refresh failure
          // must not undo the language the server already stored.
          setLanguage(previous);
        }
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
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t('appShell.languageIndicator.label')}
            aria-label={t('appShell.languageIndicator.label')}
            aria-describedby={saveFailed ? errorId : undefined}
            aria-disabled={submitting || undefined}
            // A pill, not `.b2b-topbar__icon-btn`: that class fixes the box at
            // 34×34px, which clips the flag + code + chevron triplet. Same height,
            // colours and hover as the icon buttons beside it; the width grows.
            // On a coarse pointer the top bar's shared rule makes it 44 px (#1784).
            className={cn(
              'inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[var(--r-sm)] border border-transparent px-2.5',
              'text-[11px] font-semibold leading-none tracking-[0.5px] text-[var(--fg-muted)] transition-colors',
              'hover:bg-[var(--surface-sunken)] hover:text-[var(--fg)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'aria-disabled:cursor-default',
              open && 'bg-[var(--surface-sunken)]',
            )}
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {flagFor(language)}
            </span>
            <span className="b2b-lang-picker__label">{language.toUpperCase()}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        {/* Radix names the menu by its trigger: "UI language". */}
        <DropdownMenuContent className="min-w-[180px]">
          <DropdownMenuRadioGroup
            value={language}
            onValueChange={(next): void => {
              void pick(next as SupportedAdminLanguage);
            }}
          >
            {LANGUAGES.map(({ code, labelKey, flag }) => (
              <DropdownMenuRadioItem
                key={code}
                value={code}
                // Type-ahead matches the name, not the flag the entry starts with.
                textValue={t(labelKey)}
                className="text-[13px]"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {flag}
                </span>
                <span className="text-[11px] font-semibold tracking-[0.5px]">{code.toUpperCase()}</span>
                <span>{t(labelKey)}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="absolute right-0 top-[calc(100%+4px)] z-[60] flex w-max max-w-[min(20rem,calc(100vw-16px))] flex-col items-end gap-1">
        <InlineStatus
          id={errorId}
          tone="error"
          className={cn(
            'm-0',
            saveFailed && 'max-w-full rounded-md border border-border bg-popover p-2 shadow-md',
          )}
        >
          {saveFailed ? t('appShell.languageIndicator.saveFailed') : null}
        </InlineStatus>
      </div>
    </div>
  );
}
