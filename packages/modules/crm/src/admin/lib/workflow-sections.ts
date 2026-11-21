/**
 * The tabs of the Opportunity workflow configuration (issue #1559, UX audit
 * 2026-11-17 WORK-08).
 *
 * The screen used to be five stacked cards with three different meanings of
 * *Save*: statuses and moves wrote at once, while the order mappings, the value
 * counting and the board card each had a Save of their own. Each tab now holds
 * one save model — *Statuses & moves* applies immediately, every other tab is
 * one draft with one Save — and each is a route, so a link (the board's
 * *Configure card*, a palette action) can open it directly.
 */

export const WORKFLOW_PATH = '/crm/workflow';

export type WorkflowSection = 'statuses' | 'orderSync' | 'value' | 'boardCard';

export interface WorkflowSectionTab {
  readonly section: WorkflowSection;
  readonly path: string;
  readonly labelKey: string;
}

/** In display order; the first is the screen's own path. */
export const WORKFLOW_SECTION_TABS: readonly WorkflowSectionTab[] = [
  { section: 'statuses', path: WORKFLOW_PATH, labelKey: 'workflow.tab.statuses' },
  { section: 'orderSync', path: `${WORKFLOW_PATH}/order-sync`, labelKey: 'workflow.tab.orderSync' },
  { section: 'value', path: `${WORKFLOW_PATH}/value`, labelKey: 'workflow.tab.value' },
  { section: 'boardCard', path: `${WORKFLOW_PATH}/board-card`, labelKey: 'workflow.tab.boardCard' },
];

/** The anchor the board's *Configure card* link has always pointed at. */
export const BOARD_CARD_HASH = '#board-card';

/** The anchor an Opportunity's computed value links to (issue #1561). */
export const VALUE_COUNTING_HASH = '#value-counting';

/**
 * The tab an old in-page anchor stands for: the sections those links scrolled
 * to are tabs now, so the link opens the tab instead. `null` for any other hash.
 */
export function workflowSectionForHash(hash: string): WorkflowSection | null {
  if (hash === BOARD_CARD_HASH) return 'boardCard';
  if (hash === VALUE_COUNTING_HASH) return 'value';
  return null;
}

/** The path of a tab. */
export function workflowSectionPath(section: WorkflowSection): string {
  return WORKFLOW_SECTION_TABS.find((tab) => tab.section === section)?.path ?? WORKFLOW_PATH;
}

/**
 * The tab a pathname opens: the one whose path it ends with, *Statuses & moves*
 * for anything else. Matched on the end, not the whole path, so a host that
 * mounts the screen under a prefix still lands on the right tab.
 */
export function workflowSection(pathname: string): WorkflowSection {
  const trimmed = pathname.replace(/\/+$/, '');
  const match = WORKFLOW_SECTION_TABS.slice(1).find((tab) =>
    trimmed.endsWith(tab.path.slice(WORKFLOW_PATH.length)),
  );
  return match?.section ?? 'statuses';
}
