import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';

/** One applied filter, shown as a removable chip under the toolbar. */
export interface AppliedFilter {
  /** Stable React key. */
  key: string;
  /** What is applied, as the operator reads it ("Status: Paid"). */
  label: string;
  onRemove: () => void;
  /** The chip's accessible name; "Remove filter: {label}" when omitted. */
  removeLabel?: string;
}

export interface ListToolbarProps {
  /** The accessible name of the toolbar's `search` landmark ("Filter orders"). */
  label: string;
  /** Usually a {@link ListToolbarSearch}; first in reading order. */
  search?: ReactNode;
  /**
   * The three or four filters operators use most, always visible. Every
   * control here needs an accessible name — a visible `Label` or `aria-label`.
   */
  filters?: ReactNode;
  /** Right-aligned list controls: saved views, the column picker. */
  actions?: ReactNode;
  /**
   * The remaining filters, folded behind *More filters* (Hick's Law). Rendered
   * only while the panel is open; omitted, there is no disclosure at all.
   */
  moreFilters?: ReactNode;
  /** How many of the folded filters are in use — shown as *More filters (n)* while collapsed. */
  moreFiltersActiveCount?: number;
  defaultMoreFiltersOpen?: boolean;
  onMoreFiltersOpenChange?: (open: boolean) => void;
  /** Every applied filter as a removable chip; the search box is not one — it is always visible. */
  appliedFilters?: readonly AppliedFilter[];
  /** Given, the chip row ends with *Clear all filters*. */
  onClearFilters?: () => void;
  className?: string;
}

/**
 * The list toolbar — issue #1440 (UX audit 2026-11-17, DS-06), extracted from
 * the Orders list's toolbar and the Tasks list's *More filters (n)* disclosure
 * (issue #512).
 *
 * - **One row**: search, the primary filters, the disclosure, then the list's
 *   own controls pushed to the right. Three to four filters stay visible; the
 *   long tail is behind *More filters*, which counts the ones in use while it
 *   is closed, so a folded bar still says the list is narrowed (Hick's Law,
 *   Zeigarnik).
 * - **The panel is always mounted** — `hidden` while collapsed — so the
 *   toggle's `aria-controls` always names an element; its controls are
 *   rendered only while open, so a filter that loads its options loads them
 *   when asked for.
 * - **Applied filters are chips** named by what pressing them does ("Remove
 *   filter: Status: Paid"), with one *Clear all filters* after them.
 * - The whole toolbar is a `search` landmark named by `label`.
 *
 * It frames nothing: the page decides the card, the padding and the border it
 * sits in, so the toolbar composes into any list page.
 */
export function ListToolbar(props: ListToolbarProps): ReactNode {
  const {
    label,
    search,
    filters,
    actions,
    moreFilters,
    moreFiltersActiveCount = 0,
    defaultMoreFiltersOpen = false,
    onMoreFiltersOpenChange,
    appliedFilters = [],
    onClearFilters,
    className,
  } = props;
  const t = useTranslation('core');
  const panelId = useId();
  const [open, setOpen] = useState(defaultMoreFiltersOpen);
  const hasMore = moreFilters !== undefined && moreFilters !== null;

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    onMoreFiltersOpenChange?.(next);
  };

  return (
    <div role="search" aria-label={label} className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search}
        {filters}
        {hasMore ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 pointer-coarse:min-h-11"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('motion-safe:transition-transform', open && 'rotate-180')}
            />
            {open
              ? t('common.listToolbar.fewerFilters')
              : moreFiltersActiveCount > 0
                ? t('common.listToolbar.moreFiltersCount', { count: moreFiltersActiveCount })
                : t('common.listToolbar.moreFilters')}
          </Button>
        ) : null}
        {actions ? <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {appliedFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {appliedFilters.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-label={chip.removeLabel ?? t('common.listToolbar.removeFilter', { label: chip.label })}
              onClick={chip.onRemove}
              className={cn(
                'inline-flex min-h-8 items-center gap-1 rounded-full border bg-muted/40 px-2.5 text-xs hover:bg-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'pointer-coarse:min-h-11',
              )}
            >
              <span>{chip.label}</span>
              <X aria-hidden="true" className="size-3 opacity-70" />
            </button>
          ))}
          {onClearFilters ? (
            <button
              type="button"
              onClick={onClearFilters}
              className={cn(
                'min-h-8 rounded-sm px-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'pointer-coarse:min-h-11',
              )}
            >
              {t('common.listToolbar.clearAll')}
            </button>
          ) : null}
        </div>
      ) : null}

      {hasMore ? (
        <div
          id={panelId}
          hidden={!open}
          className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {open ? moreFilters : null}
        </div>
      ) : null}
    </div>
  );
}

export interface ListToolbarSearchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'aria-label'> {
  /** The accessible name. A placeholder is not one (SC 3.3.2, 4.1.2). */
  label: string;
  value: string;
  /** Called on every keystroke; the page debounces what it sends to the API. */
  onValueChange: (next: string) => void;
  /** Classes for the wrapper, which grows to fill the row. */
  className?: string;
}

/** The toolbar's search box: `type="search"`, named by `label`, with a decorative icon. */
export const ListToolbarSearch = forwardRef<HTMLInputElement, ListToolbarSearchProps>(
  ({ label, value, onValueChange, className, ...props }, ref) => (
    <div className={cn('relative min-w-[220px] flex-1 sm:max-w-sm', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={ref}
        type="search"
        aria-label={label}
        value={value}
        onChange={(event): void => onValueChange(event.target.value)}
        className="pl-8"
        {...props}
      />
    </div>
  ),
);
ListToolbarSearch.displayName = 'ListToolbarSearch';
