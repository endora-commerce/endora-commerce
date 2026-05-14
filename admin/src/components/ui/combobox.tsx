import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Generic searchable dropdown. The input narrows the visible options as
 * the user types; the cleared input shows the full list. Selecting an
 * option commits a value through `onChange`, the clear button resets it.
 *
 * Diacritic-insensitive matching mirrors the admin global-search
 * behaviour (feature 020): NFD-normalise both query and label, strip
 * combining marks, then case-fold.
 *
 * Build is dependency-free (no Radix popover) so it composes anywhere
 * the rest of the shadcn-style components do.
 */

export interface ComboboxOption<T = string> {
  value: T;
  label: string;
  description?: string | undefined;
  disabled?: boolean | undefined;
}

export interface ComboboxProps<T = string> {
  options: ComboboxOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  placeholder?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  clearable?: boolean;
  id?: string;
  name?: string;
  className?: string;
  ariaLabel?: string;
  filter?: (option: ComboboxOption<T>, normalizedQuery: string) => boolean;
  renderOption?: (option: ComboboxOption<T>, state: { selected: boolean; active: boolean }) => ReactNode;
  /**
   * Fires whenever the user edits the search input (raw, undebounced).
   * Parents that own server-side search wire their debounced fetch here.
   */
  onSearchChange?: (query: string) => void;
  /**
   * When true, the internal `defaultFilter` is bypassed and `options` are
   * rendered as-is. Use together with `onSearchChange` for server-side
   * pickers — the parent is the source of truth for which options match.
   */
  manualFilter?: boolean;
  /**
   * Optional label used to render the selected option's text in the input
   * when the parent's `options` no longer contain it (common with paginated
   * server-side search — once a value is committed and the dropdown closes,
   * the matching option may scroll out of the current page). Falls back to
   * the matching option's `label`, then to the empty string.
   */
  selectedLabel?: string;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function defaultFilter<T>(option: ComboboxOption<T>, normalizedQuery: string): boolean {
  if (normalizedQuery === '') return true;
  const haystack = `${normalize(option.label)} ${normalize(option.description ?? '')}`;
  return haystack.includes(normalizedQuery);
}

function sameValue<T>(a: T | null, b: T | null): boolean {
  return a === b;
}

function comboboxInner<T>(
  {
    options,
    value,
    onChange,
    placeholder,
    emptyMessage = 'No results.',
    loadingMessage = 'Loading…',
    disabled = false,
    loading = false,
    clearable = true,
    id,
    name,
    className,
    ariaLabel,
    filter,
    renderOption,
    onSearchChange,
    manualFilter = false,
    selectedLabel,
  }: ComboboxProps<T>,
  ref: React.Ref<HTMLInputElement>,
): ReactNode {
  const reactId = useId();
  const inputId = id ?? `combobox-${reactId}`;
  const listboxId = `${inputId}-listbox`;
  const t = useTranslation('core');

  const selectedOption = useMemo(
    () => options.find((opt) => sameValue(opt.value, value)) ?? null,
    [options, value],
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const setRefs = useCallback(
    (node: HTMLInputElement | null): void => {
      (inputRef as { current: HTMLInputElement | null }).current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as { current: HTMLInputElement | null }).current = node;
    },
    [ref],
  );

  // When the input is closed, keep its display text in sync with the selected option.
  // For server-side mode the matching option may not be in `options` anymore
  // (paginated away), so fall back to the parent-provided `selectedLabel`.
  const closedDisplay = selectedOption?.label ?? selectedLabel ?? '';
  const displayValue = open ? query : closedDisplay;

  const filtered = useMemo(() => {
    if (manualFilter) return options;
    const normalizedQuery = normalize(query.trim());
    const filterFn = filter ?? defaultFilter;
    return options.filter((opt) => filterFn(opt, normalizedQuery));
  }, [options, query, filter, manualFilter]);

  // Reset the highlighted row whenever the visible list changes.
  useEffect(() => {
    if (!open) return;
    const selectedIdx = filtered.findIndex((opt) => sameValue(opt.value, value));
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open, filtered, value]);

  // Close on outside pointer interactions.
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!containerRef.current || !target) return;
      if (containerRef.current.contains(target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('pointerdown', handler);
    return (): void => document.removeEventListener('pointerdown', handler);
  }, [open]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    const list = listboxRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const openMenu = (): void => {
    if (disabled) return;
    if (!open) {
      // For server-side pickers, prompt the parent to load a fresh page on
      // first open. The parent's own debounce should coalesce this with any
      // subsequent keystrokes that follow immediately after.
      onSearchChange?.(query);
    }
    setOpen(true);
  };

  const closeMenu = (): void => {
    setOpen(false);
    setQuery('');
  };

  const commit = (option: ComboboxOption<T>): void => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const clear = (): void => {
    onChange(null);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      if (filtered.length === 0) return;
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      if (filtered.length === 0) return;
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) commit(opt);
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      closeMenu();
    } else if (e.key === 'Home') {
      if (!open) return;
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      if (!open) return;
      e.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (e.key === 'Backspace' && query === '' && selectedOption !== null && clearable) {
      // Backspace on an empty input clears the current selection — common combobox affordance.
      clear();
    }
  };

  const showClear = clearable && !disabled && (selectedOption !== null || query.length > 0);

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div className="relative">
        <input
          ref={setRefs}
          id={inputId}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && filtered[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-label={ariaLabel}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder}
          onChange={(e): void => {
            const next = e.target.value;
            setQuery(next);
            if (!open) setOpen(true);
            onSearchChange?.(next);
          }}
          onFocus={openMenu}
          onClick={openMenu}
          onKeyDown={onKeyDown}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-transparent pl-3 pr-16 py-1 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
        <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          {showClear ? (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e): void => e.preventDefault()}
              onClick={clear}
              aria-label={t('common.combobox.clearSelection')}
              className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
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

      {open ? (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className={cn(
            'absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-input bg-background p-1 text-sm shadow-md',
          )}
        >
          {loading && filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground" aria-disabled="true">
              {loadingMessage}
            </li>
          ) : filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground" aria-disabled="true">
              {emptyMessage}
            </li>
          ) : (
            filtered.map((opt, idx) => {
              const selected = sameValue(opt.value, value);
              const active = idx === activeIndex;
              const optionId = `${listboxId}-option-${idx}`;
              return (
                <li
                  key={optionId}
                  id={optionId}
                  role="option"
                  data-index={idx}
                  aria-selected={selected}
                  aria-disabled={opt.disabled || undefined}
                  onMouseDown={(e): void => e.preventDefault()}
                  onMouseEnter={(): void => setActiveIndex(idx)}
                  onClick={(): void => commit(opt)}
                  className={cn(
                    'flex cursor-pointer items-start justify-between gap-2 rounded-sm px-2 py-1.5',
                    active && !opt.disabled ? 'bg-accent text-accent-foreground' : '',
                    opt.disabled ? 'cursor-not-allowed opacity-50' : '',
                  )}
                >
                  {renderOption ? (
                    renderOption(opt, { selected, active })
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{opt.label}</div>
                      {opt.description ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {opt.description}
                        </div>
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
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Generic-friendly forwardRef wrapper. The cast preserves the `<T>` parameter
 * through `forwardRef`, which otherwise erases generics on the inner component.
 */
export const Combobox = forwardRef(comboboxInner) as <T = string>(
  props: ComboboxProps<T> & { ref?: React.Ref<HTMLInputElement> },
) => ReactNode;
