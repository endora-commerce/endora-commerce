---
title: PIM connector shared layer
---

# PIM connector shared layer (`pim_connector`)

Feature `089`. A thin shared module that holds **behaviour every inbound PIM
connector needs**, without importing any vendor transport. UnoPim (`pim_unopim`)
uses it today; Ergonode predates it and is **not refactored** in feature 089.

This page is for engineers extending PIM integrations or reviewing how two
connectors coexist on one platform. The UnoPim-specific transport and import
pipeline are documented in [UnoPim PIM connector](./pim-unopim.md).

## What it owns

| Concern | Where it lives |
| --- | --- |
| Mutual exclusion — only one PIM connector may be operator-active at a time | `PimConnectorRegistryService`, `pim_connector_activation_lock` table |
| Shared field-protection path grammar | `canonicalisePimFieldPath()` in `services/field-path.ts` |
| Contract vocabulary for runs, issues, triggers | `packages/contracts/src/pim-connector.ts` |
| Admin run/issue badge primitives | `admin/src/modules/pim_connector/` |

It does **not** own catalogue writes, import phases, vendor clients, or webhook
ingress — those stay in each connector package.

## Mutual exclusion (FR-003)

Endora allows several PIM connector packages to be **installed**, but an
operator may activate **at most one** at a time.

The registry reads operator activation through `effectiveState` — the same
conjunction the kernel uses everywhere else — and persists the active module id
in `pim_connector_activation_lock`. When an operator tries to activate UnoPim
while Ergonode is already active, the activation endpoint returns
`PIM_CONNECTOR_ALREADY_ACTIVE` naming the sibling.

Switching connectors is **non-destructive**: rows imported by the previous
connector remain in the catalogue; the new connector adopts by SKU where links
exist (see UnoPim operator doc).

Implementation notes:

- `pim_unopim` registers a **pre-interceptor** on
  `POST /api/v1/admin/modules/:id/activation` that calls
  `assertCanActivate('pim_unopim')` before the flip persists.
- `pim_connector` subscribes to `module.activation.changed` and records or clears
  the lock row — the interceptor must not persist state itself.

## Field-protection paths

Both Ergonode and UnoPim let an administrator protect a locally curated value
from overwrite on import. The **path grammar is shared** so admin controls and
validation stay identical:

```text
attribute.<key>[.<channel-uuid>[.<locale>]]
seo.<channel-uuid>.<locale>
price.<price-list-uuid>.<currency>
category.<category-uuid>
name[.<channel-uuid>[.<locale>]]
description[.<channel-uuid>[.<locale>]]
```

`canonicalisePimFieldPath()` normalises segments (LCID casing, UUID lower-case)
and returns `null` for paths outside the grammar. Connector field-protection
services call it before persisting a protection row.

## Extension points for the next PIM

When adding a third connector package:

1. **Declare** `dependencies: ['pim_connector']` and resolve
   `PIM_CONNECTOR_REGISTRY_PORT` through `lazyPort`.
2. **Register** the same activation pre-interceptor pattern as `pim_unopim` —
   refuse activation when a sibling is active.
3. **Reuse** `canonicalisePimFieldPath()` for product-editor protection toggles.
4. **Reuse** contract enums from `pim-connector.ts` for run status, issue
   severity and trigger — keeps admin badges and run lists consistent.
5. **Do not** import another connector's backend package; shared code belongs in
   `pim_connector` or `packages/contracts`.

Copy the **layout** from `packages/modules/pim_ergonode/README.md` (port + scripted
fake + phased import + BullMQ workers) rather than the GraphQL/REST details.

## Where the code lives

```text
packages/modules/pim_connector/
├── package.json                generated — never hand-written
├── i18n/{en,pl}.json
└── src/
    ├── manifest.ts
    ├── migrations/
    └── backend/
        ├── index.ts            registerModule, entities
        ├── entities/pim-connector-activation-lock.entity.ts
        └── services/
            ├── pim-connector-registry.service.ts
            └── field-path.ts

packages/contracts/src/pim-connector.ts
admin/src/modules/pim_connector/
backend/test/{unit,contract}/pim_connector/
```

## Gates

```bash
pnpm --filter backend exec vitest run test/unit/pim_connector test/contract/pim_connector
```

## Related reading

- [UnoPim PIM connector](./pim-unopim.md) — OAuth client, delta bookmarks, webhook
- [Ergonode PIM connector](./pim-ergonode.md) — the first packaged connector
- Operator guide: [Importing from UnoPim](../modules/pim_unopim.md)
- Feature artifacts: `specs/089-unopim-pim-sync/`
