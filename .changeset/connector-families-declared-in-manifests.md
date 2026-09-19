---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/mod-pim-connector': minor
'@endora-commerce/mod-pim-akeneo': minor
'@endora-commerce/mod-pim-ergonode': minor
'@endora-commerce/mod-pim-pimcore': minor
'@endora-commerce/mod-pim-unopim': minor
'@endora-commerce/mod-erp-connector': minor
'@endora-commerce/mod-comarch-xl': minor
'@endora-commerce/mod-invoice-ledger': minor
'@endora-commerce/mod-infakt': minor
'@endora-commerce/mod-wfirma': minor
---

Connector family membership is declared in each module's own manifest and derived by the
platform, replacing three hand-maintained arrays and the three boolean flags that
duplicated them.

## Breaking: three manifest fields are removed

*(Declared `minor` rather than `major` per **D-225**: no package leaves `0.x` before the
move to public npmjs. In a `0.x` series the two carry the identical consumer-facing
contract — `^0.9.0` excludes `0.10.0` exactly as it excludes `1.0.0` — so `minor` already
forces the explicit opt-in that is what "breaking" means to a caller. The break is
described below, which is where it belongs.)*

`pimConnector`, `invoiceLedger` and `erpConnector` are gone from `ModuleManifestSchema`,
along with `PIM_CONNECTOR_MODULES`, `INVOICE_LEDGER_MODULES` and `ERP_CONNECTOR_MODULES`.
A module that declared one replaces it with a single additive line:

```ts
capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],   // 'pim-connector'
```

A capability's **owner** declares it mutually exclusive and mints the refusal code:

```ts
exclusiveCapabilities: [
  { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
],
```

The declaration carries membership only, creates no lifecycle edge, and requires no
dependency on the owner's package — a key is a string literal, on the same terms as an
error code. That is the point of the change: a connector installed from npm, and a
per-deployment overlay module, can now join a family, which an array inside
`@endora-commerce/contracts` could never let them do without editing a file they do not
own.

## Breaking behaviour on upgrade: three PIM connectors become inactive

**Read this before upgrading if you run Akeneo, Ergonode or Pimcore.**

`pim_akeneo`, `pim_ergonode` and `pim_pimcore` shipped activated by default. They now ship
**deactivated**, as every member of a mutually exclusive capability must
(owner ruling, 2026-09-15).

- **If you chose explicitly** — you switched the connector on or off on
  `/platform/modules` at any point — a settings row records that choice and **nothing
  changes for you**. The new default applies only where no override exists.
- **If you never chose**, those three connectors were running on the shipped default and
  will be **off** after this upgrade. Switch the one you use back on at
  `/platform/modules`; the choice is recorded and survives every later upgrade.

Nothing is deleted. Connections, identity maps, field protections and run history are
preserved exactly as they were, and come back when the connector is switched on — the
reversal is two clicks and no data is touched. **No migration writes an activation row**:
changing a shipped default must not rewrite an operator's recorded choice, and the two
migration-shaped alternatives were considered and rejected — materialising the effective
value for everyone would persist three simultaneous exclusive claims attributed to an
operator who made none, and materialising it only where a connection exists would put a
read across four connectors' tables inside another module's migration and would pick one
arbitrarily wherever several qualified.

**Why the default had to move rather than being tolerated.** Exclusivity is enforced when a
module is *activated*, so it guards the transition and not the state a deployment starts
in. Three connectors shipping activated were therefore all active from the first boot, with
no transition to refuse and nothing to report it — and the one connector that consulted the
registry was refused activation out of the box, naming a connector the operator had never
configured. A member of an exclusive capability declaring `default: true` is now refused
when the platform derives the family, because the activation resolver returns booleans and
carries no provenance: nothing downstream can tell a recorded choice from a shipped
default, so a member that ships activated holds a claim nobody made.

## Also in this change

- Exclusivity is **one** seam per family — a single `pre` interceptor on
  `POST /api/v1/admin/modules/:id/activation`, registered by the capability's owner over
  the derived family. It previously lived on one member with that member's id hard-coded,
  which is why only 1 of the 12 ordered pairs of the four PIM connectors was refused; all
  12 are now.
- Exclusion resolves **effective** module presence — platform availability *and* operator
  activation. A connector a deployment never installed no longer holds a claim.
- `pim_akeneo` no longer refuses a connection save because another connector has a
  connection; that path validates its own module's activation and nothing else. The
  refusal an operator meets is the activation one, with the same code and the same
  `{ activeModuleId }` detail.
- `PimErgonodeConnectorActivityPort` is removed from `@endora-commerce/contracts`: it
  existed so one connector could ask another about its connections, and has no caller.
- Two keys never exclude each other. One ERP connector, one PIM connector and one
  invoice-ledger vendor may run together, which was always true and is now asserted.
