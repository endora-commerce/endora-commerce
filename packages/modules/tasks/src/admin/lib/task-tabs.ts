/**
 * The tabs of a Task's screen (issue #1524, UX audit 2026-11-17 WORK-02):
 * what accumulates on a Task over time — its comments, its files and its
 * history — in one tabbed card, as on an Opportunity and a Project.
 *
 * The selected tab is kept in the address (`?tab=`), so a link can open the
 * history and a reload keeps the tab; the default tab is the bare address.
 */
export const TASK_TABS = ['comments', 'attachments', 'history'] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export const DEFAULT_TASK_TAB: TaskTab = 'comments';
const TAB_PARAM = 'tab';

const isTaskTab = (value: string | null): value is TaskTab =>
  value !== null && (TASK_TABS as readonly string[]).includes(value);

/** The tab the address asks for; the default for none or for one this screen does not have. */
export function taskTabFromSearch(search: URLSearchParams): TaskTab {
  const asked = search.get(TAB_PARAM);
  return isTaskTab(asked) ? asked : DEFAULT_TASK_TAB;
}

/** The query string that selects `tab`, keeping every other parameter (`returnTo`). */
export function searchForTaskTab(search: URLSearchParams, tab: TaskTab): URLSearchParams {
  const next = new URLSearchParams(search);
  if (tab === DEFAULT_TASK_TAB) next.delete(TAB_PARAM);
  else next.set(TAB_PARAM, tab);
  return next;
}
