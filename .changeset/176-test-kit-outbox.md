---
'@endora-commerce/test-kit': minor
---

**The outbox, in the shared test server** (`specs/176-command-hooks-outbox/` P3).

- `composeTestServer` builds the outbox wake-up on its Redis and hands it to the `CommandBus`, as `composeApp` does; no worker consumes it, so a test drives the drain itself. `TestServerHandle` gains `closeOutboxWake`, which `teardownTestServer` calls before the Redis connection goes.
- `expectHookableCommand` now holds outbox data to the bus's own guard (`outboxDataViolations`): a string with whitespace or an `@` in it or longer than 128 characters now fails, as a nested object already did.
