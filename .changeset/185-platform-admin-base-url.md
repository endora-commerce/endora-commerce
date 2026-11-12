---
'@endora-commerce/platform': minor
---

`ADMIN_BASE_URL`, the admin panel's address, is now a platform input (issue #185). It is declared
in `PLATFORM_ENVIRONMENT_INPUTS` (`@endora-commerce/platform/env`) as an optional, platform-owned
address of the admin read by the backend, so an instance's `.env.example` lists it whether or not
`mfa` is installed.

`@endora-commerce/platform/kernel` exports `configuredAdminBaseUrl()`, the one reader any module
links into the admin panel through. It returns the configured address without trailing slashes
(`https://shop.example.com/admin`), or `null` when the variable is unset, blank or not an
absolute `http`/`https` URL without a query and a fragment; a caller omits the link on `null`:

```ts
import { configuredAdminBaseUrl } from '@endora-commerce/platform/kernel';

const base = configuredAdminBaseUrl();
const link = base === null ? null : `${base}/tasks/mine`;
```

`composeApp()` logs one warning at boot when the variable is set but malformed, naming its value.
A module that declared `ADMIN_BASE_URL` in its manifest's `env` removes the declaration;
`check:env-inputs` reports it as a module declaring a platform input.
