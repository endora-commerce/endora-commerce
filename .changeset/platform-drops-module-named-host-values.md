---
'@endora-commerce/platform': minor
---

**Breaking.** `composeApp` no longer registers the seven module-named host values it carried: `pimErgonodeRunWorkers`, `pimAkeneoRunWorkers`, `pimPimcoreRunWorkers`, `pimUnopimRunWorkers`, `comarchXlRunWorkers`, `productFeedsRunWorkers` and `pimAkeneoPublicBaseUrl`. The first six were deprecated when `processRunsWorkers` was added; `productFeedsRunWorkers` goes with them because its one reader, `@endora-commerce/mod-product-feeds`, now reads `processRunsWorkers` as well. A module that still resolves one of them fails at boot with an Awilix resolution error.

Read the module-agnostic value instead of a flag named after the module, and build the public origin yourself instead of resolving a registered base URL:

```ts
// before
const { pimAkeneoRunWorkers, pimAkeneoPublicBaseUrl } = ctx.cradle<Cradle>();
// after
import { resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';
const { processRunsWorkers } = ctx.cradle<Cradle>();
const publicBaseUrl = resolvePublicApiBaseUrl();
```

`processRunsWorkers` is `false` when `BACKEND_ROLE` is `api` and `true` otherwise, exactly what the removed flags carried, and `composeTestServer` registers it `false`. A test that built its own container with one of the removed names should register `processRunsWorkers` instead. A module release whose `@endora-commerce/platform` range stops below this version keeps resolving the previous minor, which still registers the old names.
