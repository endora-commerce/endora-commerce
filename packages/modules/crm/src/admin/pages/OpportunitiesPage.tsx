import { lazy, Suspense, type ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useOpportunityAddress } from '../lib/use-opportunity-address.js';

// One chunk per view: the list does not download the board's drag-and-drop.
const OpportunitiesList = lazy(() => import('./OpportunitiesList.js'));
const OpportunityBoardPage = lazy(() => import('./OpportunityBoardPage.js'));

/**
 * `/crm/opportunities` — the one Opportunities page (issue #1558, UX audit
 * WORK-07, owner decision DEC-13): the list, or at `?view=board` the board,
 * switched by the *List | Board* toggle in the header as Tasks is (Jakob's
 * Law), with one sidebar row for both (Hick's Law). The two views share the
 * address, and with it the filters they have in common.
 */
export function OpportunitiesPage(): ReactNode {
  const t = useTranslation('crm');
  const { view } = useOpportunityAddress();
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          {t('opportunity.list.loading')}
        </p>
      }
    >
      {view === 'board' ? <OpportunityBoardPage /> : <OpportunitiesList />}
    </Suspense>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default OpportunitiesPage;
