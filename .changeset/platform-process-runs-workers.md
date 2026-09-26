---
'@endora-commerce/platform': patch
'@endora-commerce/test-kit': patch
---

A composition now registers `processRunsWorkers: boolean`, the one module-agnostic answer to "does this process run queue consumers?". `composeApp` registers it above the modules from `BACKEND_ROLE` (`false` for `api`, `true` for `all`, `worker` or unset — the same value it acts on itself), and `composeTestServer` registers it `false` beside `redis` and `eventBus`, overridable through `options.values` like every other platform value.

A module that starts queue consumers should read `processRunsWorkers` from its cradle rather than read `BACKEND_ROLE` itself or resolve a flag named after itself:

```ts
// before
const { pimErgonodeRunWorkers } = ctx.cradle<Cradle>();
// or: process.env['BACKEND_ROLE'] !== 'api'
// after
const { processRunsWorkers } = ctx.cradle<Cradle>();
```

The six module-named values `composeApp` registers — `pimErgonodeRunWorkers`, `pimAkeneoRunWorkers`, `pimPimcoreRunWorkers`, `pimUnopimRunWorkers`, `comarchXlRunWorkers` and `pimAkeneoPublicBaseUrl` — are unchanged and deprecated. Read `processRunsWorkers` instead of the five flags, and call `resolvePublicApiBaseUrl()` from `@endora-commerce/platform/kernel` instead of the base URL. They will be removed in a later breaking platform release.
