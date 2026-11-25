# Contract: `check:merge-participation` and its runtime twin

One analysis, two hosts (the `check-entity-tenant-classification.ts` precedent). The static check
lands in MR-A, and its obligations are those of `specs/conventions/check-estate.md`.

## 1. Population

Every persisted entity class in `packages/modules/*/src/backend/entities/`, in overlay modules
under `backend/src/apps/<deployment>/modules/`, in the platform's kernel entities, and in installed
packages (read from the emitted artefact, as the tenant-classification check does). From these:

- **Organization references:** properties named `organizationId`, `organizationIds`, or ending in
  `OrganizationId` or `OrganizationIds` (for example `payerOrganizationId`,
  `buyingForOrganizationId`, `allowedOrganizationIds`, `counterpartyOrganizationId`,
  `reservingOrganizationId`). The host's own `Organization.parentId` is declared by the host.
- **Project references:** properties named `projectId`, or ending in `ProjectId`, in modules other
  than `projects`, plus `projects`' own tables (declared by the host).
- **Polymorphic references:** whatever a participation declares with `polymorphic`. A polymorphic
  column cannot be found by name, so the check verifies that the declared discriminator property
  exists.

## 2. Findings (exit 1)

| Finding | Meaning |
| --- | --- |
| `undeclared-reference` | a population property covered by no participation of its own module and not in the pending ledger |
| `declared-missing-property` | a declaration names an entity or property that does not exist |
| `foreign-declaration` | a module declares a reference on another module's entity |
| `double-coverage` | two declarations cover one property |
| `stale-pending` | a ledger entry whose property is now declared, or no longer exists |
| `unknown-host` / `bad-phase` | as composition (`merge-mechanism.md` §1) |

Exit 2 means nothing was read (an empty population, or a missing root). It prints its read-size
line through `backend/scripts/lib/read-size.ts`, for example
`[merge-participation] read: files=… sites=… sources=…`.

## 3. The pending ledger

`backend/scripts/ledgers/merge-participation-pending.ts` is seeded in MR-A with every reference of
`participant-dispositions.md` §A, and with §B's when MR-G starts. Each entry carries the module,
entity, property, the MR that removes it and the issue that blocks it. It only shrinks
(`stale-pending`), and it must be empty when MR-E (Organization) and MR-G (Project) are merged.

## 4. Runtime twin (`packages/platform/src/kernel/merge/completeness.ts`)

At boot the twin computes the same uncovered set from MikroORM metadata plus composed declarations.
It does **not** read the ledger. A merge preview lists, in `incomplete`, every effectively present
module with an uncovered reference, and the start refuses with
`409 RECORD_MERGE_PARTICIPATION_INCOMPLETE` and `details.modules`. Modules that are off are left out,
because their steps are deferred anyway (R-10).

## 5. Registration

- An entry in `backend/test/unit/scripts/check-inventory.test.ts`.
- A verdict in `packages/cli/src/check/estate.ts`: `package` (a module package can be checked
  alone, since its own entities and declarations are its whole subject).
- Membership of the `quality` and `quality:static` blocks.
- A companion test `backend/test/unit/scripts/check-merge-participation.test.ts` with red proofs for
  every finding and its green twin.
