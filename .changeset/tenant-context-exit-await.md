---
'@endora-commerce/platform': patch
---

`runWithoutTenantContext` now keeps the context cleared across an `await` on Node 22.

It was implemented with `AsyncLocalStorage.exit(fn)`, which on every runtime before Node 24
is `disable(); try { fn() } finally { enable() }` — a synchronous try/finally around a
callback that may be `async`. Where the caller's context had been installed with
`enterTenantContext` and the callback opened a nested `runWithTenantContext` of its own, the
re-enable resurfaced the caller's context and everything after that point read it: the
function's documented "no ambient context" ended partway through, silently. Node 24 made
`AsyncContextFrame` the default and the same call became frame-scoped, so the defect was
invisible on a newer local runtime and live on the 22.17 floor `engines.node` declares.

The implementation is now `storage.run(undefined, fn)`. The contract is unchanged —
`getTenantContext()` answers `undefined` inside, the caller's context is restored on both
return and throw — and it holds across `await` on 22.17 and on 26 alike. Callers need no
change; a caller that had worked around the old behaviour by re-asserting the clear after an
await can drop the workaround.
