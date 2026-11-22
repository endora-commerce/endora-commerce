import { useMemo, type ReactNode } from 'react';
import { SavedViewsControl, type SavedViewState } from '@endora-commerce/admin-kit/components';
import { fromSavedOpportunityView, toSavedOpportunityView } from '../lib/opportunity-address.js';
import { useOpportunityAddress } from '../lib/use-opportunity-address.js';

/** The Opportunities page's saved views (issue #1734). */
export const OPPORTUNITY_VIEWS_ENDPOINT = '/api/v1/admin/crm/opportunities/list-views';

export interface OpportunitySavedViewsProps {
  /** Page-level sink for a failure to read the views; the dialogs keep their own. */
  onError: (message: string) => void;
  /** Called before a chosen view is written to the address — the view's chance to reset what it holds. */
  onApply?: () => void;
}

/**
 * The kit's saved-views control on the Opportunities page (issue #1734). One
 * set of views serves the list and the board, as the page's address does: a
 * view stores every filter of both views and the list's sort, and applying one
 * replaces them all while the page stays in the view it is in — so a view
 * saved on the list opens the same Opportunities on the board, as switching
 * view does.
 */
export function OpportunitySavedViews({ onError, onApply }: OpportunitySavedViewsProps): ReactNode {
  const { params, update } = useOpportunityAddress();
  const current = useMemo<SavedViewState>(() => toSavedOpportunityView(params), [params]);
  const apply = (state: SavedViewState): void => {
    onApply?.();
    update((previous) => fromSavedOpportunityView(state, previous));
  };
  return <SavedViewsControl endpoint={OPPORTUNITY_VIEWS_ENDPOINT} current={current} onApply={apply} onError={onError} />;
}
