import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import type { OrderStatusOption } from '../../api.js';

/**
 * The tabs of the Opportunity screen, as data
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1).
 *
 * **A story adds a tab by adding one file and one line here** — Notes and
 * Messages, Attachments, Change history each arrived that way — so the stories
 * that work on this screen in parallel meet in one array and not in the body of
 * `OpportunityDetail.tsx`. Each component is lazy: a tab nobody opens is never
 * downloaded.
 *
 * **The order is deliberate** (User Story 20, research N-DL3): what the deal is
 * about first, then the documents that make it up, then the conversation in
 * the order it is used — notes, messages, files — and the audit trail last,
 * where a list's end is easy to find and nobody passes it on the way to work.
 *
 * **A tab's `id` is part of an address**: the screen selects a tab from
 * `?tab=<id>`, so an id that is renamed breaks every link somebody saved.
 */

/** What the page hands every tab. */
export interface OpportunityTabProps {
  opportunity: OpportunityDetail;
  /** Put a newer read of the Opportunity on screen (the answer of a write). */
  onChange: (next: OpportunityDetail) => void;
  /** Read the Opportunity again; resolves once the new read is on screen. */
  reload: () => Promise<void>;
  /**
   * `orders`' statuses, read once by the page (they need `orders:read`; without
   * it the list is empty and a status is shown by its code).
   */
  orderStatuses: readonly OrderStatusOption[];
  /** The edit form is open — the page's header opens it, the Overview tab shows it. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

export interface OpportunityTab {
  id: string;
  /** Relative to the module's namespace. */
  labelKey: string;
  component: LazyExoticComponent<ComponentType<OpportunityTabProps>>;
  /** A number to show on the tab's label — how much is behind it. Zero is not shown. */
  count?: (opportunity: OpportunityDetail) => number;
}

/** The tab a visit opens on when its address names none. */
export const DEFAULT_TAB_ID = 'overview';

/** The tab holding the linked Orders and Quote Requests. */
export const LINKS_TAB_ID = 'links';

/** The query parameter that names the selected tab. */
export const TAB_PARAM = 'tab';

export const OPPORTUNITY_TABS: readonly OpportunityTab[] = [
  {
    id: DEFAULT_TAB_ID,
    labelKey: 'opportunity.tabs.overview',
    component: lazy(() => import('./tabs/OverviewTab.js')),
  },
  // User Story 20 — the owner named this tab "Powiązania" / "Links".
  {
    id: LINKS_TAB_ID,
    labelKey: 'opportunity.tabs.links',
    component: lazy(() => import('./tabs/LinksTab.js')),
    count: (opportunity) => opportunity.links.length,
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

/**
 * The tab an address selects.
 *
 * `?tab=<id>` wins when it names a tab. Without it, a visit that comes back
 * from creating a document (`?created=…`, the return address this module hands
 * the Order and Quote Request create screens) lands on the Links tab, where
 * the answer to "was it linked?" is. Anything else — a bare address, an id
 * nobody declares — is the default tab.
 */
export function tabFromSearch(search: URLSearchParams): string {
  const asked = search.get(TAB_PARAM);
  if (asked && OPPORTUNITY_TABS.some((tab) => tab.id === asked)) return asked;
  if (search.has('created')) return LINKS_TAB_ID;
  return DEFAULT_TAB_ID;
}

/**
 * The query string that selects `tabId`, keeping every other parameter.
 * The default tab is the bare address, so a link to an Opportunity stays short.
 */
export function searchForTab(search: URLSearchParams, tabId: string): URLSearchParams {
  const next = new URLSearchParams(search);
  if (tabId === DEFAULT_TAB_ID && !next.has('created')) next.delete(TAB_PARAM);
  else next.set(TAB_PARAM, tabId);
  return next;
}
