---
'@endora-commerce/cli': patch
---

`endora dev` no longer waits out the whole 10 s grace when a layer fails. A group signal
reaches only the processes in the group when it is sent, so a process a layer started just
after the polite stop (for example the script `pnpm run` had not spawned yet) kept running until
the forced stop. `superviseDev` now repeats SIGTERM to the layers still running every 250 ms
during the grace; SIGKILL still comes only once the grace is up.
