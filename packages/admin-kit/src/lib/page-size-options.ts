/**
 * The page sizes every paginated admin list offers.
 *
 * It is a module of its own because the **constant** is design-system and the
 * **preference** is application state. `usePageSizePreference` reads the signed-in
 * admin's id to key its `localStorage` entry, so it belongs to the admin application
 * and stays there (see the package README, *What Phase 1b does not publish*);
 * `PaginationFooter` only needs the list of numbers to render its dropdown. Splitting
 * them is what lets the footer be published without dragging the session with it, and
 * it keeps exactly one list: the admin's hook re-exports these names rather than
 * declaring a second array the dropdown and the validation could disagree about.
 */
export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 500] as const;

export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
