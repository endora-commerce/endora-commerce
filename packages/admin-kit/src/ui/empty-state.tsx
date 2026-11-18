import { type ReactNode } from 'react';
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
}

export type EmptyStateProps = EmptyStateNoDataProps | EmptyStateNoResultsProps;

export function EmptyState(props: EmptyStateProps): ReactNode {
  const t = useTranslation('core');
  const noResults = props.variant === 'no-results';
  const icon = noResults ? (props.icon ?? <SearchX size={20} />) : props.icon;
  const title = noResults ? (props.title ?? t('common.emptyState.noResults.title')) : props.title;
  const description = noResults ? (props.description ?? t('common.emptyState.noResults.body')) : props.description;
  const action = noResults ? (
    <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={props.onClearFilters}>
      <X aria-hidden="true" />
      {t('common.emptyState.clearFilters')}
    </Button>
  ) : (
    props.action
  );

  return (
    <div className={cn('b2b-empty', props.className)} data-empty-state={noResults ? 'no-results' : 'no-data'}>
      <div className="b2b-empty__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="b2b-empty__title">{title}</p>
      {description ? <p className="b2b-empty__sub">{description}</p> : null}
      {action ?? null}
    </div>
  );
}
