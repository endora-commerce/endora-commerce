---
---

No release: the acceptance runners under `backend/scripts/acceptance/` share one process-group
teardown and bound their own exit, and the local registry ends its upstream requests; no file
under `packages/` changes, so nothing a package publishes does.
