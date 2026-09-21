---
title: PIM connector shared layer
---

# PIM connector shared layer (`pim_connector`)

The module that holds the behaviour **every** inbound PIM connector needs, without
importing any vendor transport. It ships with Endora, it is `nonDeactivatable`, and
it contains no vendor code at all: a PIM connector is a package of its own, and a
deployment may install none, one or several of them.

This page is for the engineer writing or reviewing a PIM connector, and for anyone
asking how two connectors coexist on one platform. A connector's own transport,
mapping screens and import pipeline are documented by that connector's package.

## What it owns

| Concern | Where it lives |
| --- | --- |
| The `pim-connector` capability key, and the declaration that it is mutually exclusive | `exclusiveCapabilities` in this module's own `manifest.ts` |
| The one exclusivity seam, over the derived family | the `pre` interceptor in `src/backend/index.ts` |
| Which member holds the claim | `PimConnectorRegistryService`, `pim_connector_activation_lock` |
| The refusal code `PIM_CONNECTOR_ALREADY_ACTIVE` and its operator sentence | the manifest's `errorCodes`, `i18n/{en,pl}.json` |
| Shared field-protection path grammar | `canonicalisePimFieldPath()` in `packages/contracts/src/pim-field-path.ts` |
| Contract vocabulary for runs, issues, triggers, modes and counts | `packages/contracts/src/pim-connector.ts` |
| Admin code | nothing — see below |

It does **not** own catalogue writes, import phases, vendor clients or webhook
ingress. Those stay in each connector package.

**And it owns no admin code**, which is a correction rather than an omission. A
shared run-status badge and issue list once lived under `admin/src/modules/pim_connector/`,
and feature 091's Phase 4 measured that the directory had a single consumer, so both
files moved into that connector's own package beside the screens that render them. A
module package cannot name `admin/src` at all, so a shared admin component needs a
*published* home — the design kit, or a supported subpath of this package — and
neither exists yet because one consumer does not need one. A second connector wanting
that chrome is what would buy it.

## The family is declared, never listed

A connector joins the family in **its own** manifest:

```ts
capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
```

The platform derives the membership from those declarations on every composition —
`effectiveState.membersOfCapability(key)` for the members that are effectively
present, `declaredMembersOfCapability(key)` for membership alone. **Nothing in this
repository holds a list of connectors.**

That is deliberate, and feature 132 is why. The member list used to be a hand-written
array in `@endora-commerce/contracts`, and it named two of the connectors then
shipped — so the exclusion covered a sixth of its ordered pairs and nothing said so,
a connector installed from npm could not join it at all, and a per-deployment overlay
module had to edit a core file to. Derived from the declarations, a connector that
declares membership is covered **by existing**, and a connector that stops declaring
it leaves the family instead of leaving a passing assertion behind.

A member does **not** have to depend on `pim_connector` to be covered: the seam
belongs to the owner. Declare the dependency only if the connector resolves the
registry port itself. A deployment that installs a connector *without* this shared
layer has a family that is simply not exclusive there — there is no lock row and
nothing to enforce with.

## Mutual exclusion

Endora allows several PIM connector packages to be **installed**, but an operator may
have **at most one active** at a time. Six properties of the seam are load-bearing:

- **One seam, registered by the owner.** A `pre` interceptor on
  `POST /api/v1/admin/modules/:id/activation`, registered once by `pim_connector` over
  the derived family. A member **must not** register an exclusivity interceptor of its
  own, and must not hand-roll the check anywhere else — that shape is how a new
  connector came to be shipped with no enforcement at all.
- **Effective presence, never the activation Setting alone.** Platform availability
  AND operator activation, the conjunction `effectiveState` computes. A module the
  deployment never installed holds no claim (Principle XVII).
- **The refusal lands before the audited Command runs**, so a refused activation
  writes nothing.
- **Deactivation is never refused.** A member may always be switched off.
- **Re-activating the holder is not refused.** The route is idempotent, so the module
  already holding the claim is excluded from the search for a rival.
- **Two different capability keys never exclude each other.** One PIM connector, one
  ERP connector and one invoice-ledger vendor may be active simultaneously.

The refusal is `409 PIM_CONNECTOR_ALREADY_ACTIVE` with details
`{ activeModuleId: <the holder> }`. The operator sentence is interpolated client-side
from that id, so the message names the holding module the way the modules screen does
rather than by its id.

`pim_connector` also subscribes to `module.activation.changed` and records or clears
the lock row. The interceptor never persists state itself, and the subscriber tests
**declared** membership, because on a deactivation the member is already absent and an
effective-presence test would drop exactly the event that has to clear the lock.

### No connector is active on a fresh install

No member may declare `activation.default: true`. It is refused at derivation, naming
the module, and a static check asserts it. The reason is not tidiness: the exclusion
resolves on the activation axis and the resolver returns no provenance, so a
default-activated member would hold a claim nobody made — and a mutual exclusion may
not fail open. Capping it at "one member may" leaves that category error in place.

So a stock install has no PIM connector active, and the operator picks one on
`/platform/modules`. Changing a shipped default never overwrites a recorded choice:
the default applies only where the Setting row carries no override, and **no migration
may write an activation row**.

Switching connectors is **non-destructive**. Rows imported by the previous connector
stay in the catalogue, and each connector's own connection, mappings, protections and
run history are preserved and return unchanged when it is switched on again.

## Field-protection paths

A connector that lets an administrator protect a locally curated value from being
overwritten on import shares the **path grammar**, so the admin controls and the
validation stay identical across connectors:

```text
attribute.<key>[.<locale>]
attribute.<key>.<channel-uuid>[.<locale>]
seo.(metaTitle|metaDescription|metaKeywords).<locale>
gallery.<index>
attachment.<asset-uuid>
price.<price-list-uuid>.<currency>
category.<category-uuid>
name[.<locale>]
description[.<locale>]
```

`canonicalisePimFieldPath()` normalises the segments — locale casing to `ll_RR`,
UUIDs to lower case, currency to upper case — and returns `null` for anything outside
the grammar. A connector's field-protection service calls it before persisting a
protection row, and `isValidPimFieldPath()` is the same judgement as a predicate.

## Writing a connector

1. **Declare membership**: `capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR]` in the
   manifest. That is the whole of joining the family.
2. **Declare the operator switch**: an `activation` block whose `settingCode` names a
   boolean Setting, with `default: false`. Never `true`.
3. **Do not** register an activation interceptor, and do not raise
   `PIM_CONNECTOR_ALREADY_ACTIVE` — the code belongs to the owner and a member
   declaring it is refused.
4. **Reuse** `canonicalisePimFieldPath()` for product-editor protection toggles, and
   the run status, issue severity, trigger, mode and counts schemas from
   `packages/contracts/src/pim-connector.ts`, which is what keeps run lists and badges
   consistent between connectors.
5. **Do not** import another connector's package. Shared code belongs here or in
   `packages/contracts`.

## Where the code lives

```text
packages/modules/pim_connector/
├── package.json                generated — never hand-written
├── i18n/{en,pl}.json
└── src/
    ├── manifest.ts
    ├── migrations/
    └── backend/
        ├── index.ts            registerModule, the seam, the subscriber, entities
        ├── entities/pim-connector-activation-lock.entity.ts
        └── services/
            ├── pim-connector-registry.service.ts
            └── registry.test.ts

packages/contracts/src/pim-connector.ts
packages/contracts/src/pim-field-path.ts
backend/test/{unit,contract,integration}/pim_connector/
```

## Gates

```bash
pnpm --filter @endora-commerce/mod-pim-connector run test
pnpm --filter backend exec vitest run test/unit/pim_connector test/contract/pim_connector \
  test/integration/pim_connector
```

`test/integration/pim_connector/exclusivity-pairs.test.ts` sweeps **every ordered
pair** of the derived family and carries a guard that the family it enumerated was
not empty — `describe.each([])` runs nothing at all, which is how a list-driven
version of this suite stayed green over the pairs it did not know about.

## Related reading

- Feature artifacts: `specs/089-unopim-pim-sync/contracts/pim-connector-shared.md` for
  the port, and `specs/132-connector-family-discovery/contracts/capability-exclusivity.md`
  for the seam and the default state.
