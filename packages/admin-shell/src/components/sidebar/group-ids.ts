/**
 * Issue #1480 — the DOM id of a sidebar group's item region, which its
 * collapsible header names through `aria-controls`.
 *
 * Derived from the group key, which is already unique across the sidebar: it is
 * the key `sidebarCollapsedGroups` stores, and the Pinned section's key
 * (`ADMIN_PINNED_GROUP_KEY`) shares that namespace. Characters an id should not
 * carry are folded to `-`; the shell renders one sidebar, so a fixed prefix is
 * enough.
 */
export function sidebarGroupItemsId(groupKey: string): string {
  return `b2b-sidebar-group-${groupKey.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
