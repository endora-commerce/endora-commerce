---
'@endora-commerce/platform': patch
---

`composeApp` establishes the system-default sales channel itself, so an instance stops answering
`500 INTERNAL` to every request.

Every request on a scaffolded instance answered `500 INTERNAL` with **nothing logged** —
`/api/v1/_openapi.json` included, a route that touches no module and no database. The underlying
error was `NoSystemDefaultChannel`, thrown by `SalesChannelResolverService.getSystemDefault()`
inside the global `onRequest` hook `registerSalesChannelResolverMiddleware` installs. That hook
runs for every `/api/v1/*` path except `/api/v1/_health`, which is why the health route was the
only one answering anything else.

The boot-time default-channel reconciliation stood in the **reference deployment's** contribution
callback, not in `composeApp`. An instance supplies no contribution callback
(`contracts/instance-repository.md` R2.4), so it never ran, and the `sales_channels` table of a
freshly migrated instance stayed empty. `composeApp` now runs `DefaultChannelReconciler` itself,
before `composeModules`, so every root that mounts the resolver also guarantees the row the
resolver falls back to. A deployment that ran its own is unaffected: the reconciler is idempotent
and answers `no_change` when the flag is already held.

**A 5xx `HttpError` is now logged.** `registerErrorEnvelope`'s `HttpError` branch returned before
the `request.log.error` at the bottom of the handler, so a server fault raised as an `HttpError`
— `NoSystemDefaultChannel`, and every `HttpError(500, …)` a module throws — answered in complete
silence. Faults with `statusCode >= 500` now emit one `error`-level line carrying the error, the
status and the code; 4xx stays silent, because that is the client saying something wrong and its
own envelope already says what. Consumers filtering their logs at `error` will see lines they did
not see before, and each one is a fault that was already happening.
