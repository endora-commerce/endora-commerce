import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { OpportunityDetail } from '@endora-commerce/contracts';

/**
 * The tabs of the Opportunity screen, as data
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1).
 *
 * **A story adds a tab by adding one file and one line here** — Notes and
 * Messages, Attachments, Change history each arrive that way — so the stories
 * that work on this screen in parallel meet in one array and not in the body of
 * `OpportunityDetail.tsx`. Each component is lazy: a tab nobody opens is never
 * downloaded.
 */

/** What the page hands every tab. */
export interface OpportunityTabProps {
  opportunity: OpportunityDetail;
  /** Put a newer read of the Opportunity on screen (the answer of a write). */
  onChange: (next: OpportunityDetail) => void;
  /** Read the Opportunity again; resolves once the new read is on screen. */
  reload: () => Promise<void>;
}

export interface OpportunityTab {
  id: string;
  /** Relative to the module's namespace. */
  labelKey: string;
  component: LazyExoticComponent<ComponentType<OpportunityTabProps>>;
}

export const OPPORTUNITY_TABS: readonly OpportunityTab[] = [
  {
    id: 'overview',
    labelKey: 'opportunity.tabs.overview',
    component: lazy(() => import('./tabs/OverviewTab.js')),
  },
  {
    id: 'notes',
    labelKey: 'opportunity.tabs.notes',
    component: lazy(() => import('./tabs/NotesTab.js')),
  },
  {
    id: 'messages',
    labelKey: 'opportunity.tabs.messages',
    component: lazy(() => import('./tabs/MessagesTab.js')),
  },
  {
    id: 'attachments',
    labelKey: 'opportunity.tabs.attachments',
    component: lazy(() => import('./tabs/AttachmentsTab.js')),
  },
  // User Story 11 — the owner named this tab "Change history" / "Historia zmian".
  {
    id: 'history',
    labelKey: 'opportunity.tabs.history',
    component: lazy(() => import('./tabs/HistoryTab.js')),
  },
];
