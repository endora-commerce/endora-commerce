---
'@endora-commerce/admin-kit': patch
---

**Pager buttons keep keyboard focus at the ends of the range** (#1803).

`PaginationFooter` (offset and cursor modes) and `CursorPagination` now mark Previous / Next with `aria-disabled` instead of `disabled` on the first and last page, and while a cursor page is being fetched. Pressing Next onto the last page no longer drops focus to the page body; the button stays focusable, is announced as unavailable and ignores the press, so `onNext` / `onPrev` are still never called past the range. The range summary is now a polite live region, so the page change is announced.

No prop changes. A consumer test that asserted `toBeDisabled()` on these buttons should assert `toHaveAttribute('aria-disabled', 'true')` instead.
