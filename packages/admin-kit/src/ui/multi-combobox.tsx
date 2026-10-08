import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { normalize } from '../lib/text-normalization.js';
import { defaultComboboxFilter, type ComboboxOption } from './combobox.js';

/**
 * Searchable multi-select — the multi-value sibling of `Combobox`.
 *
 * One text input carries the WAI-ARIA combobox role and owns a `listbox`
 * filtered as the operator types; what is selected is rendered as removable
 * chips beside the input, so the selection is readable without opening
 * anything. Use it where the list is long enough to need a search and the
 * selection small enough to read as chips: the languages or currencies of a
 * sales channel, not the columns of a table.
 *
 * It is **not** a replacement for `MultiSelect`, which is a different control —
 * a button summarising the selection (`Status (3)`) over a panel of checkboxes,
 * sized for a filter bar where the chips would not fit.
 *
 * Keyboard, all from the input, which never loses focus while the list is used:
 * `↓`/`↑` open the list and move the highlight (wrapping), `Home`/`End` jump,
 * `Enter` toggles the highlighted option and keeps the list open for the next
 * one, `Escape` closes it, and `Backspace` in an empty input removes the last
 * chip. Each chip also carries its own remove button, in the tab order before
 * the input.
 *
 * Matching is the same diacritic-insensitive fold `Combobox` uses, over the
 * option's `label` and `description` — so an option labelled `pl-PL — Polish`
 * and described `Polski` is found by its code and by either name. Every option
 * is rendered; a couple of hundred rows is well inside what a browser lays out
 * without a virtualised list, and a virtualised list would cost the listbox its
 * `aria-activedescendant` targets.
 *
 * Dependency-free, like its sibling: no Radix popover, no `cmdk`.
 */
export interface MultiComboboxProps<T = string> {
  options: ComboboxOption<T>[];
  /** The selected values, in the order they are shown and reported. */
  value: T[];
  /** A newly selected value is appended; a removed one is filtered out. */
  onChange: (next: T[]) => void;
  placeholder?: string;
  /** Shown in the listbox when no option matches. Defaults to a translated line. */
  emptyMessage?: string;
  /** Shown in the listbox while `loading` and there is nothing to offer yet. */
  loadingMessage?: string;
  disabled?: boolean;
  /** Options are still being fetched: `aria-busy` on the input and a spinner. */
  loading?: boolean;
  /** Id of the text input — point the field's `<label htmlFor>` at it. */
  id?: string;
  className?: string;
  ariaLabel?: string;
  /**
   * Id of the visible label. Names the listbox as well as the input, which a
   * `<label htmlFor>` alone cannot do.
   */
  ariaLabelledBy?: string;
  /** Ids of the help text and, while `invalid`, the error message. */
  ariaDescribedBy?: string | undefined;
  /**
   * Marks the field as failing validation (`aria-invalid` and a destructive
   * border). The message is the caller's to render and to link through
   * `ariaDescribedBy`.
   */
  invalid?: boolean;
  filter?: (option: ComboboxOption<T>, normalizedQuery: string) => boolean;
  renderOption?: (option: ComboboxOption<T>, state: { selected: boolean; active: boolean }) => ReactNode;
}

export function MultiCombobox<T = string>({
  options,
  value,
  onChange,
  placeholder,
  emptyMessage,
  loadingMessage,
  disabled = false,
  loading = false,
  id,
  className,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  invalid = false,
  filter,
  renderOption,
}: MultiComboboxProps<T>): ReactNode {
  const reactId = useId();
  const inputId = id ?? `multi-combobox-${reactId}`;
  const listboxId = `${inputId}-listbox`;
  const t = useTranslation('core');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  // Set while focus is being handed back to the input after a chip was removed
  // with its own button, so that hand-back does not also pop the list open.
  const suppressOpenRef = useRef(false);

  const filtered = useMemo(() => {
    const normalizedQuery = normalize(query);
    const filterFn = filter ?? defaultComboboxFilter;
    return options.filter((opt) => filterFn(opt, normalizedQuery));
  }, [options, query, filter]);

  // The highlight survives a toggle (so several neighbours can be picked in a
  // row) and is clamped rather than reset when the list gets shorter.
  const active = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);

  const labelOf = (v: T): string => options.find((opt) => opt.value === v)?.label ?? String(v);

  useEffect(() => {
    if (!open || active < 0) return;
    const el = listboxRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openMenu = (): void => {
    if (disabled || open) return;
    setActiveIndex(0);
    setOpen(true);
  };

  const closeMenu = (): void => {
    setOpen(false);
    setQuery('');
  };

  const remove = (v: T): void => {
    onChange(value.filter((selected) => selected !== v));
    setAnnouncement(t('common.multiCombobox.removed', { label: labelOf(v) }));
  };

  const toggle = (option: ComboboxOption<T>): void => {
    if (option.disabled) return;
    if (value.includes(option.value)) {
      remove(option.value);
    } else {
      onChange([...value, option.value]);
      setAnnouncement(t('common.multiCombobox.added', { label: option.label }));
    }
    // The query has done its job; the list stays open for the next pick.
    setQuery('');
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      if (filtered.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((Math.max(active, 0) + step + filtered.length) % filtered.length);
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (e.key === 'Enter') {
      // Closed, Enter is the form's: it submits, as it does in any text field.
      if (!open) return;
      e.preventDefault();
      const option = filtered[active];
      if (option) toggle(option);
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      closeMenu();
    } else if (e.key === 'Backspace' && query === '' && value.length > 0) {
      remove(value[value.length - 1] as T);
    }
  };

  return (
    <div data-multi-combobox="" className={cn('relative w-full', className)}>
      {/* The whole box is the click target for the input inside it (Fitts). */}
      <div
        onMouseDown={(e): void => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
        className={cn(
          'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent py-1 pl-2 pr-14 text-sm shadow-sm transition-colors',
          'focus-within:ring-1 focus-within:ring-ring',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-text',
          invalid ? 'border-destructive' : '',
        )}
      >
        {value.map((v) => {
          const label = labelOf(v);
          return (
            <span
              key={String(v)}
              data-chip-value={String(v)}
              className="inline-flex h-6 max-w-full items-center rounded-md bg-secondary pl-2 text-xs text-secondary-foreground"
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={t('common.multiCombobox.remove', { label })}
                onClick={(): void => {
                  remove(v);
                  // The button is about to unmount; without this, focus falls
                  // to <body> and a keyboard user starts again from the top.
                  suppressOpenRef.current = true;
                  inputRef.current?.focus();
                  suppressOpenRef.current = false;
                }}
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:cursor-not-allowed',
                )}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listboxId}-option-${active}` : undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={invalid || undefined}
          aria-busy={loading || undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(e): void => {
            setQuery(e.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          onFocus={(): void => {
            if (!suppressOpenRef.current) openMenu();
          }}
          onClick={openMenu}
          onBlur={closeMenu}
          onKeyDown={onKeyDown}
          className={cn(
            'h-6 min-w-24 flex-1 bg-transparent text-sm outline-none',
            'placeholder:text-muted-foreground disabled:cursor-not-allowed',
          )}
        />
        <div className="pointer-events-none absolute right-0 top-0 flex h-9 items-center gap-1 pr-2">
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              open ? 'rotate-180' : 'rotate-0',
            )}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Mounted empty, before it has anything to say (WCAG 4.1.3). */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>

      {open ? (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-input bg-background p-1 text-sm shadow-md"
        >
          {filtered.length === 0 && !loading ? (
            <li role="presentation" className="px-2 py-1.5 text-muted-foreground">
              {emptyMessage ?? t('common.multiCombobox.noMatches')}
            </li>
          ) : (
            filtered.map((opt, idx) => {
              const selected = value.includes(opt.value);
              const isActive = idx === active;
              return (
                // The input owns the keyboard: options are reached through
                // `aria-activedescendant`, never by focus.
                <li
                  key={String(opt.value)}
                  id={`${listboxId}-option-${idx}`}
                  role="option"
                  data-index={idx}
                  data-value={String(opt.value)}
                  aria-selected={selected}
                  aria-disabled={opt.disabled || undefined}
                  onMouseDown={(e): void => e.preventDefault()}
                  onMouseEnter={(): void => setActiveIndex(idx)}
                  onClick={(): void => toggle(opt)}
                  className={cn(
                    'flex cursor-pointer items-start justify-between gap-2 rounded-sm px-2 py-1.5',
                    isActive && !opt.disabled ? 'bg-accent text-accent-foreground' : '',
                    opt.disabled ? 'cursor-not-allowed opacity-50' : '',
                  )}
                >
                  {renderOption ? (
                    renderOption(opt, { selected, active: isActive })
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{opt.label}</div>
                      {opt.description ? (
                        <div className="truncate text-xs text-muted-foreground">{opt.description}</div>
                      ) : null}
                    </div>
                  )}
                  {selected ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : null}
                </li>
              );
            })
          )}
          {/* Said even when there is something to show: what is listed while
              the options are still arriving is not yet the whole list. */}
          {loading ? (
            <li role="presentation" className="px-2 py-1.5 text-muted-foreground">
              {loadingMessage ?? t('common.state.loading')}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
