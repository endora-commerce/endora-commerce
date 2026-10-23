---
'@endora-commerce/mod-price-lists': patch
---

A large paste in the price grid, and a save of many lines, stay fast (feature 161, T099; FR-036).

- Old: each cell of a pasted or filled group copied every pending edit, and the save read every edit once per line. Both were quadratic: 5 000 cells took about 4 s.
- New: the grid applies a group in one pass (`editCells` in `src/admin/lib/book-edit-state.ts`), and the save and the cell views group the edits by line once per change. Measured on the development machine, 5 000 cells take about 90 ms.
