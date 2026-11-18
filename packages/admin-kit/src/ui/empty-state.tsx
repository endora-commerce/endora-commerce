import { useRef, type ReactNode, type RefObject } from 'react';
import { SearchX, X } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { Button } from './button.js';

/**
 * `EmptyState` — what a list, a panel or a tab shows when it has nothing to show
 * (issue #1448, UX audit 2026-11-17, DS-15; extracted from the forms list).
 *
 * One block: a decorative icon, a title, at most one line, at most one action —
 * never a bare grey sentence (Picture Superiority). It draws the design system's
 * `.b2b-empty` classes, which every screen used to write out by hand.
 *
 * Two variants, because "nothing here yet" and "your filters match nothing" are
 * different situations with different next steps, and a list that says the same
 * sentence for both sends the operator to create something that already exists:
 *
 * - `no-data` (default): the screen names the icon and the title, and passes the
 *   action that creates the first record — or none, for an operator who may not.
 * - `no-results`: the kit's own copy and a *Clear filters* button wired to
 *   `onClearFilters`. A screen may still name what it lists in `title`.
 *
 * **Focus after *Clear filters*** (WCAG 2.2 SC 2.4.3). The button unmounts
 * itself once the list comes back, and focus would fall to `<body>`. On the
 * next frame after `onClearFilters` the kit focuses `focusAfterClear` — pass the
 * search box, where the operator starts again. Without one, and only if focus
 * was actually lost, it focuses the page's `<h1>`, else the closest container of
 * the block that is still in the document (either made focusable with
 * `tabindex="-1"`). A screen whose list reloads asynchronously should pass a
 * target: the fallback runs once, before the answer arrives.
 *
 * It is not a live region: it is mounted together with its text, which screen
 * readers do not reliably announce (WCAG 2.2 SC 4.1.3). The list's result count
 * is the announcement; this block is what a sighted operator reads.
 */

interface EmptyStateCommonProps {
  /** A short heading — the situation, not an instruction. */
  title?: ReactNode;
  /** One line: why it is empty, or what to do. */
  description?: ReactNode;
  className?: string;
}

export interface EmptyStateNoDataProps extends EmptyStateCommonProps {
  variant?: 'no-data';
  /** A `lucide-react` icon for what the list holds; drawn decorative (`aria-hidden`). */
  icon: ReactNode;
  title: ReactNode;
  /**
   * The one next step — usually the button that creates the first record. Leave
   * it out when the operator may not take it; say why in `description` instead.
   */
  action?: ReactNode;
}

export interface EmptyStateNoResultsProps extends EmptyStateCommonProps {
  variant: 'no-results';
  /** Resets every filter and the search. */
  onClearFilters: () => void;
  /** Defaults to `SearchX`. */
  icon?: ReactNode;
  /**
   * Where focus goes once the filters are cleared — the screen's search box.
   * Without it the kit falls back to the page heading or the closest surviving
   * container (see above).
   */
  focusAfterClear?: RefObject<HTMLElement | null>;
}

function isFocusable(element: HTMLElement): boolean {
  return element.isConnected && !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true';
}

function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

function focusProgrammatically(element: HTMLElement): void {
  if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  element.focus();
}

/**
 * Moves focus after *Clear filters*: to the screen's target when it can take
 * focus, else — only if focus was lost — to the `<h1>`, else to the nearest of
 * `ancestors` (closest first) still in the document.
 */
function restoreFocusAfterClear(target: HTMLElement | null, ancestors: readonly HTMLElement[]): void {
  if (target && isFocusable(target)) {
    target.focus();
    return;
  }
  if (!focusLost()) return;
  const heading = document.querySelector<HTMLElement>('h1');
  const fallback = heading && heading.isConnected ? heading : ancestors.find((element) => element.isConnected);
  if (fallback) focusProgrammatically(fallback);
}

export type EmptyStateProps = EmptyStateNoDataProps | EmptyStateNoResultsProps;

export function EmptyState(props: EmptyStateProps): ReactNode {
  const t = useTranslation('core');
  const blockRef = useRef<HTMLDivElement>(null);
  const noResults = props.variant === 'no-results';
  const clearFilters = (clearing: EmptyStateNoResultsProps): void => {
    // Read before the clear: the block is about to unmount, and with it the way up.
    const ancestors: HTMLElement[] = [];
    for (let node = blockRef.current?.parentElement ?? null; node && node !== document.body; node = node.parentElement) {
      ancestors.push(node);
    }
    clearing.onClearFilters();
    requestAnimationFrame(() => restoreFocusAfterClear(clearing.focusAfterClear?.current ?? null, ancestors));
  };
  const icon = noResults ? (props.icon ?? <SearchX size={20} />) : props.icon;
  const title = noResults ? (props.title ?? t('common.emptyState.noResults.title')) : props.title;
  const description = noResults ? (props.description ?? t('common.emptyState.noResults.body')) : props.description;
  const action = noResults ? (
    <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => clearFilters(props)}>
      <X aria-hidden="true" />
      {t('common.emptyState.clearFilters')}
    </Button>
  ) : (
    props.action
  );

  return (
    <div ref={blockRef} className={cn('b2b-empty', props.className)} data-empty-state={noResults ? 'no-results' : 'no-data'}>
      <div className="b2b-empty__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="b2b-empty__title">{title}</p>
      {description ? <p className="b2b-empty__sub">{description}</p> : null}
      {action ?? null}
    </div>
  );
}
