---
'@endora-commerce/contracts': minor
---

**`outboxDataViolations(data)` and `OUTBOX_STRING_MAX_LENGTH`** (`specs/176-command-hooks-outbox/` P3, FR-031). The structural list-1 guard the Command Bus applies to an owner's `outboxData` before it writes a `command_outbox` row: it returns the sorted keys whose value is nested, not a finite number, longer than 128 characters or contains whitespace or an `@` (an e-mail address is the one personal datum shaped like a code), and never repeats the value. `@endora-commerce/test-kit`'s `expectHookableCommand` uses the same guard.
