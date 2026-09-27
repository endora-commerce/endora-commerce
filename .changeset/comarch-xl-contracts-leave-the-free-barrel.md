---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-comarch-xl': minor
---

`@endora-commerce/contracts` no longer exports the Comarch XL module's schemas; the module publishes its own

**If you import any `comarchXl*`/`ComarchXl*` or `xl*`/`Xl*` symbol, `COMARCH_XL_SETTING_CODES`,
`COMARCH_XL_READ_PERMISSION`, `COMARCH_XL_MANAGE_PERMISSION` or `XL_CONTRACT_VERSION` from
`@endora-commerce/contracts` or from its `./comarch-xl` subpath, this release removes it.** One
hundred and thirty-nine exports go: the admin API shapes (connection, connection test, identity,
warehouse, price-list and status mappings, sync jobs, worker heartbeats, imported offers), the XL
wire schemas and snapshots, the seven overlay extension ports (`ComarchXlSellabilityPort` and its
siblings), the setting codes, the two permission codes, and every type inferred beside them.
They are now on the module's own `./contracts` subpath:

```diff
- import { COMARCH_XL_SETTING_CODES, type ComarchXlSellabilityPort } from '@endora-commerce/contracts';
+ import { COMARCH_XL_SETTING_CODES, type ComarchXlSellabilityPort } from '@endora-commerce/mod-comarch-xl/contracts';
```

A deployment overlay that decorates one of the module's ports imports the port's type from there.
One symbol that sat in the same file stays where it was imported from: `ContractorCreditLimitPort`,
the published name of `credit_limits`' `creditLimitService` registration, is `credit_limits`' own
port and is now declared beside its other contract types. Nothing else in
`@endora-commerce/contracts` changes: the ERP connector family's shared vocabulary
(`erp-connector`) and the vendor-neutral imported-invoice seam stay in the free contracts.

`@endora-commerce/mod-comarch-xl` gains the `./contracts` export. It already declared `zod` as a
peer dependency, so installing it pulls in nothing new.

`@endora-commerce/mod-comarch-xl` also owns its ten error codes now: the root export gains
`comarchXlErrorCodes`, declared with `defineModuleErrorCodes`, and every raise site in the module
uses it instead of `ERROR_CODES.COMARCH_XL_*` and `ERROR_CODES.XL_CONTRACT_VERSION_MISMATCH`. The
codes' values on the wire do not change.
