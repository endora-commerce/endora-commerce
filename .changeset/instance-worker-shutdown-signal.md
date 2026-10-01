---
"@endora-commerce/cli": patch
---

`endora new instance` no longer writes a `backend/src/worker.ts` whose `shutdown` takes a `signal` it never reads. The worker now logs the signal it is stopping on, as `backend/src/index.ts` already did, so a lint of a freshly scaffolded instance reports nothing about a file you did not write. An instance scaffolded with an earlier version works as before; to silence the warning, add `app.log.info({ signal }, 'worker shutting down');` as the first line of `shutdown` in `backend/src/worker.ts`.
