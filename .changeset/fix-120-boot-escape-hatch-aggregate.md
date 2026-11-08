---
'@endora-commerce/platform': patch
---

A process start now writes one `tenant.escape_hatch` audit row instead of one row per boot step (issue #120). Every server, worker and composing CLI command used to write about 25 rows before it did any work. Each boot step and module boot hook that entered a system scope (`boot: load module presence`, `boot: inventory`, …) had a row of its own. `composeApp` now brackets its boot through two new methods on the escape-hatch audit writer, `beginBoot()` and `endBoot()`. Every record inside the bracket whose reason starts with `boot: ` is folded into one row: scope `system`, entry point `boot`, reason `boot: process start`. The row's `state_after.breakdown` holds one `{ module, reason, occurrences }` entry per folded reason, and `state_after.occurrences` is their sum, so no entry goes uncounted. The following are recorded exactly as before: a CLI command's own `cli: …` entry, any record inside the bracket under another reason, and any `boot: …` record outside the bracket. The stderr line is still written for every entry. No migration is needed.

Upgrade note: an audit query that looked for a single boot step by its reason, such as `state_after->>'reason' = 'boot: load module presence'`, now finds that step inside the `breakdown` of the `boot: process start` row.
