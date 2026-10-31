---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': patch
---

A bulk operation's log trail is readable in each administrator's language.

- `@endora-commerce/contracts`: `bulkOperationLogEntrySchema` gains an optional `messageKey`
  (`{ key, params? }`, a key in `catalog`'s bundle and the values that fill it) beside
  `message`, which stays the finished English sentence.
- `mod-catalog`: new log entries store `messageKey` and an English `message` where they stored
  a Polish sentence; the bulk-operations detail screen draws the key in the reader's language
  and falls back to `message` — so entries written before this release still show as they
  did. A Polish reader sees the same sentences as before. New bundle keys:
  `bulkOperations.log.*`.
