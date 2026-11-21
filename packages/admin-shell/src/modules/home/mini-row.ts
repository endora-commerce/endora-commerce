/**
 * One row of a dashboard mini-list — the stock alerts and the recent-activity
 * feed draw the same row, so the two cards beside each other read as one
 * system (Law of Similarity). Tailwind utilities, replacing the theme's
 * `b2b-minirow` (issue #1492).
 */
export const MINI_ROW = 'flex items-center gap-3 rounded-sm px-3 py-2.5';

/** A row that opens something: the hover and focus a link row adds. */
export const MINI_ROW_LINK =
  'hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
