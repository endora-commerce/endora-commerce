---
'@endora-commerce/mod-price-lists': minor
---

Issue #470 (D-288; owner ruling O-3, 2026-11-10), second stage: every price-book Command that changes a value now writes the book's own price-change history in the same transaction. Each book it changed gets one `price_list_value_changes` row, with one `price_list_row_value_changes` line per price row it added, changed or removed. A rolled-back Command leaves neither the history row nor its audit entry.

- The Commands that write it: `price_list.create`, `price_list.update` (only when the name, the priority or the audience members change), `price_list.rows_replace` (the admin row batch, which also carries the bulk change and the CSV import), `price_list.duplicate`, `price_list.base_prices_set` (the base-price editor and `priceBookWritePort`), and `price_list.book_rows_set` / `price_list.book_rows_remove` (`priceBookRowWritePort`, which already wrote it).
- `header_before` / `header_after` hold only the changed header values: `name`, `priority`, `audience.memberIds`, and on a duplicate `amountMultiplier`. A created book records its whole header in `header_after`.
- A line records the row's selection, its quantity window, and both sides of its price in the row's own types, unrounded. A row that keeps its selection and window and changes its price is one `changed` line. A row whose window moves, including one moved by its id in the admin batch, is one `removed` line and one `added` line.
- The actor is the Command's. `actor_admin_user_id` is set only for an administrator, and stays `null` for a system, PIM or API-key caller.
- Each audit entry points at its row with `valueChangeId`. A base-price write points at one row per currency with `valueChangeIds`. The entries keep their current values for now (`rows`, `byCurrency`, `amountMultiplier`). Removing them is a later stage of #470.
- A Command that changes no value writes no history row, and its audit entry has no `valueChangeId`. Status, dates, channels and deletion write none. A deleted book takes its history with it, and the delete's audit entry still records how many rows the book had.

Nothing reads the history yet, and no route, screen or price changes.
