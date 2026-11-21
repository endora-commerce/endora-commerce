import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { boardAddressRedirect } from '../lib/opportunity-address.js';

/**
 * `/crm/board` — the board's address before it became the *Board* view of the
 * Opportunities page (issue #1558, DEC-13). A bookmark, a link sent before, and
 * the command palette's *Opportunity board* (whose target may carry no query
 * string) land on `/crm/opportunities?view=board`, the filters they carried kept.
 */
export function OpportunityBoardRedirect(): ReactNode {
  const { search } = useLocation();
  return <Navigate replace to={boardAddressRedirect(search)} />;
}

export default OpportunityBoardRedirect;
