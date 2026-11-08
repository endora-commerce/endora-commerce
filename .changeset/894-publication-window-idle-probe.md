---
'@endora-commerce/mod-catalog': patch
---

The publication-window sweep no longer enters the system scope on an idle tick. Each tick
first asks, outside any tenant scope, whether a product's publication window (global, or an
overridden channel window) was crossed since the last sweep, and opens the system scope only
when one was. An instance where no window is crossed therefore stops writing a
`tenant.escape_hatch` audit row every five minutes. A probe that fails counts as "yes", so a
failure can cost an audit row but never skip a sweep.

`PublicationWindowSweep` gains `hasDueTransitions()` and `crossedRows()`, and the tick
(`runPublicationWindowSweepTick`) now needs `hasDueTransitions` beside `sweep`.
