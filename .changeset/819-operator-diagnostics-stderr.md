---
'@endora-commerce/platform': patch
---

A `module:*` command's `--json` answer is the only thing on its stdout again (issue #819). The platform's own log lines — the ORM bootstrap's tenancy-chain notice among them, emitted once any installed module has a transitive chain ending at a customer-scoped entity — reached `platformLogger()`'s stdout fallback in a process that builds no server, and landed in front of the JSON document.

`runInstanceOperatorCommand` now sends them to the command's `err` channel, one JSON line each (`{"level":…,"msg":…,…fields}`), for the run's duration. An application that builds its own `module:*` entry points calls the new `attachOperatorDiagnostics(err)` from `@endora-commerce/platform/lifecycle` before opening anything; it returns the detach.
