---
'@endora-commerce/cli': patch
'@endora-commerce/platform': patch
---

A storefront added after an `endora install --no-storefront` run is no longer a silent mismatch of `REVALIDATE_SECRET` (#112).

- `endora install --no-storefront`: the closing text says whether `REVALIDATE_SECRET` in the instance's `.env` holds a value (a plain run generates none, so it is empty), what to set before a storefront is added, and prints the command that adds it — `pnpm exec endora install <dir>-storefront --only storefront --api-url … --storefront-url … --revalidate-secret <the same value>`. The refusal for a storefront that cannot be written from here, and the wizard's parts question, point at the same command instead of `endora new storefront <dir>`.
- `StorefrontRevalidator`: a warning identical to one logged in the last minute — same storefront, same status, or a transport failure again — is held and counted, and the next one logged carries `suppressed`, the number held. A 2xx answer clears the record for that storefront. A revalidator constructed without `logger` now reports through the platform logger instead of discarding the warning, so a refusal during a module activation or from the settings cache screen is logged too. The secret is never logged.
