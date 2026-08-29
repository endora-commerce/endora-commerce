---
'@endora-commerce/mod-health-checks': minor
'@endora-commerce/mod-audit-logs': minor
'@endora-commerce/mod-addresses': minor
'@endora-commerce/mod-currencies': minor
'@endora-commerce/mod-languages': minor
'@endora-commerce/mod-seo': minor
'@endora-commerce/mod-analytics': minor
'@endora-commerce/mod-import-export': minor
'@endora-commerce/mod-shipments': minor
'@endora-commerce/mod-payment-methods': minor
---

Ten new packages: the first **batch** of modules to leave `backend/src/modules/`
(feature 080, T040b). Five moved one at a time before them; these ten move together, and
the properties below are the same ten times over.

**One changeset, not ten, and that is a judgement rather than a shortcut.** A changeset is
written for the consumer of a package, and for a package that did not exist a moment ago
there is no upgrader to instruct — every one of the ten says the same thing, *"this package
now exists, here are its subpaths, and here is what it deliberately does not export"*. Ten
files carrying one rationale would be nine copies of a derived fact. What genuinely differs
per package is its layer inventory, and that is the table below.

Every subpath is compiled output (D-164); none has a root wildcard; each package's `.` is
its `manifest.ts`, where the generated manifest index reads the module's identity, its
`dependencies`, its permission codes, its command-palette actions, its settings and its
activation control.

| Package | Subpaths | Entities | Migrations | Ships |
| --- | --- | --- | --- | --- |
| `@endora-commerce/mod-health-checks` | `.`, `./backend` | — | — | `dist` |
| `@endora-commerce/mod-audit-logs` | `.`, `./backend` | — | — | `dist` |
| `@endora-commerce/mod-addresses` | `.`, `./backend` | `Address` | — | `dist` |
| `@endora-commerce/mod-currencies` | `.`, `./backend` | `Currency` | — | `dist` |
| `@endora-commerce/mod-languages` | `.`, `./backend`, `./migrations` | `Language` | 1 | `dist` |
| `@endora-commerce/mod-seo` | `.`, `./backend`, `./migrations` | `SeoMetaOverride`, `SitemapCache` | 1 | `dist` |
| `@endora-commerce/mod-analytics` | `.`, `./backend`, `./migrations` | `AnalyticsEvent` | 1 | `dist` |
| `@endora-commerce/mod-import-export` | `.`, `./backend` | — | — | `dist`, `i18n` |
| `@endora-commerce/mod-shipments` | `.`, `./backend`, `./migrations` | `Shipment` | 2 | `dist` |
| `@endora-commerce/mod-payment-methods` | `.`, `./backend`, `./migrations` | `PaymentMethod` | 2 | `dist`, `i18n` |

**`./backend` publishes `registerModule(ctx)` and an `entities` array, and no entity class by
name** (D-168). The classes in that column are imported to build the array and are exported
under no name, so `import type { PaymentMethod } from '@endora-commerce/mod-payment-methods/backend'`
does not compile in a consumer's tree, whoever the consumer is. A foreign key still works —
`shipments.order_id -> orders.id` is between two column names and needs the table, never the
owner's class.

**Three of the ten own no table, and say so with an empty array rather than by omission.**
`health-checks`, `audit-logs` and `import-export` export `entities: readonly never[] = []`.
The distinction is not cosmetic: the platform's package loader answers a *missing* export with
`[]`, so "this module has no table" and "somebody forgot the array" would otherwise arrive as
one silence, whose only symptom is a query against a table nobody created.

**`./migrations` publishes a `migrations` array plus each class by name.** The asymmetry with
`./backend` is deliberate — `mikro_orm_migrations` persists the class name, so it is a string
every already-migrated database holds, while an entity class name is contract to nobody.

**Two behavioural removals, both in `./backend`, both affecting no caller in this repository.**
`@endora-commerce/mod-currencies/backend` no longer re-exports `CURRENCY_CHANGED_EVENT` and
`@endora-commerce/mod-languages/backend` no longer re-exports `LANGUAGE_CHANGED_EVENT`. Both
constants live in `@endora-commerce/contracts` and have since feature 075's Phase P; the
re-exports were that phase's compatibility shim, kept for consumers that turned out not to
exist. Import them from `@endora-commerce/contracts`, which is where the one and only
`dictionaries` consumer already reads them.

```ts
// before — from the module barrel
import { CURRENCY_CHANGED_EVENT } from '@endora-commerce/mod-currencies/backend';
// after — from the contracts package, where the constant is declared
import { CURRENCY_CHANGED_EVENT } from '@endora-commerce/contracts';
```
