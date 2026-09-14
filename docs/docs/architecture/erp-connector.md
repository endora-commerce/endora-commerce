---
title: ERP connector shared layer
---

# ERP connector shared layer (`erp_connector`)

Feature `119`. A thin shared module that holds **behaviour every inbound ERP
connector needs**, without importing any vendor transport. Comarch XL
(`comarch_xl`) uses it today; future ERP adapters may adopt the same layer.

This page is for engineers extending ERP integrations or reviewing how two ERP
connectors coexist on one platform. The Comarch XL transport, pipeline and
apply logic are documented in [Comarch ERP XL connector](./comarch-xl.md).

## What it owns

| Concern | Where it lives |
| --- | --- |
| Mutual exclusion — only one ERP connector may be operator-active at a time | `ErpConnectorRegistryService`, `erp_connector_activation_lock` table |
| Shared job/run/issue vocabulary for admin monitors | `packages/contracts/src/erp-connector.ts` |
| Registry port for activation guards | `erpConnectorRegistryPort` |

It does **not** own catalogue writes, XL HTTP, BullMQ processors, webhook
ingress, or any vendor-specific mapping tables — those stay in each connector
package.

**PIM connectors are a separate axis.** `erp_connector` does not interact with
`pim_connector`. A deployment may have an active PIM connector and Comarch XL at
the same time; domain split (catalogue content vs stock/prices) is enforced in
`comarch_xl`, not here.

## Mutual exclusion (FR-006)

Endora allows several ERP connector packages to be **installed**, but an
operator may activate **at most one** at a time.

The registry reads operator activation through `effectiveState` — the same
conjunction the kernel uses everywhere else — and persists the active module id
in `erp_connector_activation_lock`. When an operator tries to activate a second
ERP connector while Comarch XL is already active, the activation endpoint returns
`ERP_CONNECTOR_ALREADY_ACTIVE` naming the sibling.

Switching connectors is **non-destructive**: identity mappings and configuration
rows imported by the previous connector remain in the database; the new
connector adopts by identifier where links exist.

Implementation notes:

- `comarch_xl` registers a **pre-interceptor** on
  `POST /api/v1/admin/modules/:id/activation` that calls
  `assertCanActivate('comarch_xl')` before the flip persists.
- `erp_connector` subscribes to `module.activation.changed` and records or clears
  the lock row — the interceptor must not persist state itself.

Consumer modules declare membership with `erpConnector: true` on their manifest
(mirror of `pimConnector` on PIM packages). The flag is validated in
`packages/contracts/src/modules.ts`.

## Shared vocabulary (contracts)

`packages/contracts/src/erp-connector.ts` exports:

| Schema | Purpose |
| --- | --- |
| `erpSyncJobStatusSchema` | `pending \| in_progress \| success \| error \| poison` |
| `erpSyncJobDirectionSchema` | `erp_to_shop \| shop_to_erp` |
| `erpSyncIssueSeveritySchema` | `info \| warning \| error` |
| `erpSyncRunSummarySchema` | batch counters for monitor dashboards |
| `erpIdentityEntityTypeSchema` | `article \| contractor \| order \| quote_request \| offer \| sale_document` |

Port constant:

```ts
export const ERP_CONNECTOR_REGISTRY_PORT = 'erpConnectorRegistryPort' as const;
```

Error code:

```text
ERP_CONNECTOR_ALREADY_ACTIVE
details: { activeModuleId: string }
```

## Extension points for the next ERP connector

When adding a second ERP connector package:

1. **Declare** `dependencies: ['erp_connector']`, `erpConnector: true`, and resolve
   `erpConnectorRegistryPort` through `lazyPort`.
2. **Register** the same activation pre-interceptor pattern as `comarch_xl` —
   refuse activation when a sibling is active.
3. **Reuse** contract enums from `erp-connector.ts` for job status, issue
   severity and monitor summaries — keeps admin badges consistent.
4. **Do not** import another connector's backend package; shared code belongs in
   `erp_connector` or `packages/contracts`.

Copy the **layout** from `comarch_xl` (OpenAPI or other wire client behind a
port, identity mapping, BullMQ pipeline, apply services) rather than Comarch-specific
field names.

## Where the code lives

The `erp_connector` module package owns the registry service, activation-lock
entity and migrations. Shared Zod vocabulary lives in `packages/contracts` as
`erp-connector.ts`. Unit and contract tests live under `backend/test/erp_connector/`.

See the generated [ERP connector module reference](../modules/erp_connector.md) for
the package that ships this module in a given instance.

## Gates

```bash
pnpm --filter backend exec vitest run test/unit/erp_connector test/contract/erp_connector
```

## Related reading

- [Comarch ERP XL connector](./comarch-xl.md) — OpenAPI client, sync pipeline, apply logic
- [Overlay pattern](./overlay-pattern.md) — per-deployment client rules via ports and decorations
- Operator guide: [Comarch ERP XL](../modules/comarch_xl.md)
- Feature artifacts: `specs/119-comarch-xl-sync/`
