---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
---

After an approver rejects a member's basket, the member's next basket starts with the rejected basket's lines (issue #755).

- **The lines come back once.** When a basket is opened for a member whose most recent basket on the channel was rejected (the rejection still in force, as `previousRejection` reads it), each of its lines (product, variant, packaging unit and quantity) is added as the member would add it now, so it is checked for availability and priced afresh. This happens only where a basket is created, so an existing basket is never touched. It does not run again after the member empties or abandons the restored basket, and it does not carry the coupon over. A member whose role lacks `carts.create` gets nothing restored. Each restored line lands its usual `line_added` audit row, and the restore itself lands `lines_restored_from_rejection` on the new basket, with the source basket, the restored count and the skipped lines in its metadata. The rejected basket is left as it was.
- **The rejection notice says what was restored.** In `@endora-commerce/contracts`, `cartPreviousRejectionSchema` gains `restoredLineCount` (default `0`) and `skippedLines` (the `droppedLines` line shape, default `[]`), so a reply without them still parses. `CartPreviousRejection` now has both keys, so code that builds one must set them.
- `CartAuditAction` gains `lines_restored_from_rejection`.
