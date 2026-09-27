---
title: ERP connector shared layer
---

# ERP connector shared layer (`erp_connector`)

A thin shared module that holds **behaviour every inbound ERP connector needs**,
without importing any vendor transport. It ships with Endora, it is
`nonDeactivatable`, and it contains no vendor code at all: an ERP connector is a
package of its own, and a deployment may install none, one or several of them.

This page is for engineers writing or reviewing an ERP connector, and for anyone
asking how two ERP connectors coexist on one platform. A connector's own transport,
sync pipeline and apply logic are documented by that connector's package.

## What it owns

| Concern | Where it lives |
| --- | --- |
| The `erp-connector` capability key, and the declaration that it is mutually exclusive | `exclusiveCapabilities` in this module's own `manifest.ts` |
| The one exclusivity seam, over the derived family | the `pre` interceptor in `src/backend/index.ts` |
| Which member holds the claim | `ErpConnectorRegistryService`, `erp_connector_activation_lock` table |
| The refusal code `ERP_CONNECTOR_ALREADY_ACTIVE` and its operator sentence | the manifest's `errorCodes`, `i18n/{en,pl}.json` |
| Shared job/run/issue vocabulary for admin monitors | `packages/contracts/src/erp-connector.ts` |
| Registry port for code that needs to ask who holds the claim | `erpConnectorRegistryPort` |

It does **not** own catalogue writes, ERP HTTP clients, BullMQ processors, webhook
ingress, or any vendor-specific mapping tables — those stay in each connector
package.

**PIM connectors are a separate axis.** `erp_connector` does not interact with
`pim_connector`. A deployment may have an active PIM connector and an active ERP
connector at the same time; how the two divide the catalogue between them — content
from the PIM, stock and prices from the ERP, for example — is decided by the
connectors, not here.

## The family is declared, never listed

A connector joins the family in **its own** manifest:

```ts
capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR],
```

The platform derives the membership from those declarations on every composition —
`effectiveState.membersOfCapability(key)` for the members that are effectively
present, `declaredMembersOfCapability(key)` for membership alone. Nothing in this
repository holds a list of connectors, so a connector installed from npm and a
per-deployment overlay module join the family the same way, without editing a core
file. The example deployment's `erp_incumbent_fixture` and `erp_challenger_fixture`,
under `backend/src/apps/example/modules/`, are the smallest possible members: a
manifest, an activation Setting and nothing else.

## Mutual exclusion

Endora allows several ERP connector packages to be **installed**, but an operator
may activate **at most one** at a time.

The registry reads operator activation through `effectiveState` — the same
conjunction the kernel uses everywhere else — and persists the active module id in
`erp_connector_activation_lock`. When an operator tries to activate a second ERP
connector while another is already active, the activation endpoint returns
`ERP_CONNECTOR_ALREADY_ACTIVE` naming the holder.

Switching connectors is **non-destructive**: identity mappings and configuration
rows imported by the previous connector remain in the database; the new connector
adopts by identifier where links exist.

Implementation notes:

- `erp_connector` registers **one** pre-interceptor on
  `POST /api/v1/admin/modules/:id/activation`, over the derived family. It calls
  `assertCanActivate(<module id>)` before the flip persists. A member registers no
  exclusivity interceptor of its own.
- `erp_connector` subscribes to `module.activation.changed` and records or clears
  the lock row — the interceptor never persists state itself. The subscriber tests
  **declared** membership, because on a deactivation the member is already absent.
- No member may declare `activation.default: true`: the platform refuses it at
  derivation for every exclusive capability, so a stock install has no ERP connector
  active and the operator picks one on `/platform/modules`.

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

## Writing an ERP connector

1. **Declare membership**: `capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR]` in the
   manifest. That is the whole of joining the family.
2. **Declare the operator switch**: an `activation` block whose `settingCode` names a
   boolean Setting, with `default: false`. Never `true`.
3. **Do not** register an activation interceptor, and do not raise
   `ERP_CONNECTOR_ALREADY_ACTIVE` — the seam and the code belong to this module.
   Declare `dependencies: ['erp_connector']` only if the connector resolves
   `erpConnectorRegistryPort` itself.
4. **Reuse** the contract enums from `erp-connector.ts` for job status, issue
   severity and monitor summaries — it keeps admin badges consistent between
   connectors.
5. **Do not** import another connector's package; shared code belongs in
   `erp_connector` or `packages/contracts`.

A typical connector keeps its wire client (OpenAPI or otherwise) behind a port, owns
its identity-mapping tables, runs its sync as a BullMQ pipeline, and writes into
other modules only through their exported ports, so the Command Bus, the tenant guard
and the audit trail apply where the target module enforces them.

## Where the code lives

The `erp_connector` module package owns the registry service, activation-lock
entity and migrations; its unit tests sit beside them. Shared Zod vocabulary lives in
`packages/contracts` as `erp-connector.ts`. Contract and integration tests live under
`backend/test/{contract,integration}/erp_connector/`.

`erp_connector` ships no operator documentation page, and deliberately so: it has no
operator surface of its own — no admin screen, no setting an operator sets — exactly
like `pim_connector`, whose architecture page is the sibling of this one. What an
operator reads is the connector's own page.

## Gates

```bash
pnpm --filter @endora-commerce/mod-erp-connector run test
pnpm --filter backend exec vitest run test/contract/erp_connector test/integration/erp_connector
```

`test/integration/erp_connector/overlay-joins.test.ts` composes the example
deployment and asserts that its overlay members alone make a pair, so the exclusion
cases stay meaningful whichever packaged connectors a checkout contains.

## Related reading

- [PIM connector shared layer](./pim-connector.md) — the same pattern for PIM connectors
- [Overlay pattern](./overlay-pattern.md) — per-deployment client rules via ports and decorations
- [Module Lifecycle](../modules/lifecycle.md) — the activation route the exclusivity seam intercepts
