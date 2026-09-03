---
title: Module Lifecycle
description: CLI-driven install / uninstall / enable / disable / status for every backend module + dependency validation + first-boot reconciliation
---

# Module Lifecycle

Platform-internal subsystem (feature 018) that turns every backend module into a first-class lifecycle citizen: declarative manifest, dependency graph, install / uninstall / enable / disable / status, persisted registry, transactional install with migration rollback, and a per-process enabled-set cache — refreshed over Redis pub/sub — that gates HTTP routes, BullMQ workers, and event subscribers without restarting the process.

The subsystem itself lives at `packages/platform/src/lifecycle/` — inside the host package, not in a module folder. It is the one registered module the packaging sweep does not turn into a package of its own (feature 080, D-160.11): the lifecycle machinery is the platform's operator half, so it ships with `@endora-commerce/platform` to every instance that installs the platform at all, rather than being a separate package an instance could be missing. Its module id is still `_lifecycle`, and the leading underscore still marks it as platform-internal; every other backend module opts in by exporting a `manifest` constant from its `manifest.ts`.

Two parts of it stay in the application, at `backend/src/lifecycle/`, and they stay for a reason rather than as residue: the **manifest registry** (`registered-manifests.ts`) and the **reduced-deployment reader**, which read the deployment's overlay tree and the instance's installed packages — neither of which the platform can see — and the five `module:*` **CLI scripts**, which boot the ORM. Beside them sit re-export shims, one per moved file that something in `backend/` still names at its old path; they are a bridge and are deleted as their consumers stop naming it.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/modules` | Read-only listing of every module's id, state (`installing` / `installed` / `disabled` / `uninstalled` / `not-installed`), version (registered vs on-disk), declared dependencies, and any flags (`orphan`, `pending-upgrade`, `dep-missing`, `dep-disabled`). Permission: `platform.modules.read`. |

Mutating operations (install, uninstall, enable, disable) are intentionally CLI-only in v1 — see `contracts/admin-http.md` for the deferred E-2 spec.

## CLI commands

Every command is wired in `backend/package.json`:

```bash
pnpm --filter backend run module:install <id> [--dry-run] [--json]
pnpm --filter backend run module:uninstall <id> [--hard] [--force] [--json]
pnpm --filter backend run module:enable <id> [--json]
pnpm --filter backend run module:disable <id> [--cascade] [--json]
pnpm --filter backend run module:status [<id>] [--filter=<state>] [--json]
```

Exit-code contract (per `contracts/cli-commands.md`):

| Code | Meaning |
| --- | --- |
| 0 | Success (or already-in-target-state — no-op). |
| 64 | Misuse: unknown id, bad argv, `--hard` without `--force` in non-tty. |
| 65 | Manifest invalid (Zod fail), duplicate id, cycle. |
| 66 | Conflict: missing dependencies on install / dependents block uninstall / disable. |
| 70 | Internal error during install (migration / settings / hook failure). |
| 75 | Lock unavailable, or stale `installing` row. |
| 77 | Refused: the module declares itself `nonDeactivatable`, on `disable` and on `uninstall` alike. |

### A `nonDeactivatable` module cannot be withdrawn on this axis at all

A manifest that declares `activation: { nonDeactivatable: true, reason }` refuses **both**
`module:disable` and `module:uninstall` — soft and hard — with exit 77 and no override flag.
Uninstall is disable plus the settings sweep plus, on `--hard`, the migration revert, so a
declaration that forbids the smaller operation cannot permit the larger one. The refusal is
raised after the `already-uninstalled` no-op and before the dependents check, so nothing runs
and nothing is written. If the declaration is wrong for a module, the fix is the manifest.

An **orphan** registry row — a row whose module has no manifest on disk — is unaffected: the
guard reads the manifest, and cleaning orphans up is the one job uninstall has that nothing
else does.

Legacy `pnpm modules:install` / `pnpm modules:uninstall` (plural) print a deprecation notice and forward to the singular form. They will be removed in the next minor release.

## Manifest file shape

Every module exports a `manifest` constant from `backend/src/modules/<id>/manifest.ts`:

```typescript
import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'pricing',
  name: 'Pricing',
  description: 'Customer-group pricing with brackets and display modes.',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels'],
  settings: defineModuleSettingsManifest({
    moduleCode: 'pricing',
    groups: [{ code: 'pricing', name: 'Pricing' }],
    settings: [
      { code: 'pricing.default_display_mode',
        name: 'Default price display mode',
        valueType: 'string',
        defaultValue: 'gross_only',
        groupCode: 'pricing' },
    ],
  }),
});

export async function installHook({ em, log }) {
  // Optional. Runs once on first install, inside the install transaction.
  // Use to seed default content; idempotent if re-run after failure.
}

export async function uninstallHook({ em, hard, log }) {
  // Optional. `hard === true` indicates the operator chose data deletion.
}
```

Manifest fields:

- `id` (required, string) — must match the folder name (`backend/src/modules/<id>/`); regex `^_?[a-z][a-z0-9_]*$`.
- `name` (required, string) — human-readable display name (1–120 chars).
- `description` (optional, string) — up to 2000 chars.
- `version` (required, string) — semver-lite (`MAJOR.MINOR.PATCH` plus optional `-prerelease` suffix).
- `dependencies` (required, string array) — module ids the platform needs installed before this one. Validated against the manifest registry at boot.
- `license` (optional, enum `'core' | 'pro' | 'enterprise'`) — reserved for future edition gating; declared and audited but not enforced in v1.
- `settings` (optional) — feature 004's `ModuleSettingsManifest` shape; the lifecycle's install path runs the existing settings reconciler over it.
- `i18n` (optional) — feature 019's `{ bundlesDir: string }` shape; when present, the install path reads `<modulePath>/<bundlesDir>/<lang>.json` for every supported Admin UI language and UPSERTs the bundle into `translation_bundles`. Soft-uninstall preserves bundles; hard-uninstall removes them.
- `actions` (optional) — feature 020's `ModuleAction[]` shape; an inline list of command-palette action declarations (id, label key, icon, target route, optional required-permission, weight, keywords). The install path UPSERTs every declared action into `module_actions` and prunes any rows the new manifest no longer declares; hard-uninstall removes them. See the [Admin Command Palette Actions](./admin-actions) module page for the full schema and operator-side behaviour.
- `permissions` (optional) — feature 026's assignable admin-role codes for this module. Each entry `{ code, label, module? }` is merged into `GET /api/v1/admin/permissions` when the module is enabled. Every `requireAdmin('…')` literal on the module's admin routes must appear here (or in core `PERMISSION_CATALOGUE` for shared codes). CI enforces this via `permission-inventory.test.ts`. See `specs/026-admin-roles-permissions/contracts/module-manifest-permissions.md`.

## Lifecycle state machine

```text
                  ┌─────────────────────────────────────┐
                  │                                     │
            (install attempt)                           │
                  │                                     │
                  ▼                                     │
            ┌──────────┐                                │
   (no row) │installing│  ──fail──→  ┌──────────┐ ←─┐   │
            └────┬─────┘             │uninstalled│   │   │
                 │                   └────┬─────┘   │   │
                 │success                 │         │   │
                 ▼                        │         │   │
            ┌──────────┐                  │         │   │
   ┌──────→ │installed │ ←────install─────┤         │   │
   │        └────┬─────┘                  │         │   │
   │             │ disable                │         │   │
   │             ▼                        │         │   │
   │        ┌──────────┐                  │         │   │
   └enable──│ disabled │ ──uninstall───────┘         │   │
            └──────────┘                                │
                                                        │
            ─── all states can re-enter installing on   │
                an explicit re-install attempt ─────────┘
```

Soft-uninstall preserves data: settings rows are removed, the registry row keeps `state = 'uninstalled'`, schema and data tables are untouched. Re-installing the same module reuses already-applied migrations and finishes in seconds — but it does **not** bring the configuration back: the settings the sweep deleted are recreated from the manifest defaults, the module's activation choice included. Pausing a module without losing its configuration is what `module:disable` is for.

Hard-uninstall (`--hard`) additionally reverts the module's migrations and deletes the registry row. The migrations to revert are resolved from `MIGRATION_REGISTRY` (`backend/src/db/migrations-registry.generated.ts`) by their declared `moduleId`, sorted ascending, and reverted in reverse order — see [Database Migrations](../architecture/migrations.md#module-uninstall-migration-revert). A module that owns no registered migration logs a warning and reverts nothing; hard-uninstall then relies on its `uninstallHook`.

## How disable works (feature gating without restart)

When a module is disabled the platform inactivates three layers via wrappers:

1. **HTTP routes** registered through `defineModuleRoutes(moduleId, register)` — the wrapper installs an `onRequest` hook that returns `503 Service Unavailable` with `{error:{code:'MODULE_DISABLED',details:{module:'<id>'}}}` and `Retry-After: 60`.
2. **BullMQ workers** registered through `defineModuleWorker(moduleId, worker)` — paused on disable, resumed on enable.
3. **Event subscribers** registered through `subscribeForModule(moduleId, bus, event, handler)` — handler is a no-op when the module is disabled.

The refused module is named in `details.module` on **every** `MODULE_DISABLED` response, not only the route gate: the id travels on `ModuleDisabledError` itself, so a port resolution and a `requireModuleEnabled` call answer the same shape. It has to be `details` rather than a field beside `code`, because the error envelope replaces an operator-visible message with the registered sentence for its **code**, and `MODULE_DISABLED` is one code for every gated port in the platform — the module id is what turns "Module Disabled." into a sentence an operator can act on, and `errors.MODULE_DISABLED` interpolates `{module}` out of exactly that detail (issue #161).

The enabled set is cached per process and refreshed via Redis pub/sub on the `b2b:module:state-changed` channel; cache lookups are O(1) in-memory (~50 µs).

## Adding a new module — walkthrough

A worked example for a fictional `coupons` module that depends on `pricing` and `sales_channels`.

### 1. Create the folder

```text
backend/src/modules/coupons/
├── entities/
├── services/
├── plugin.ts
├── routes.admin.ts
└── manifest.ts
```

### 2. Author the manifest

```typescript
// backend/src/modules/coupons/manifest.ts
import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

const settings = defineModuleSettingsManifest({
  moduleCode: 'coupons',
  groups: [{ code: 'coupons.policies', name: 'Coupon policies' }],
  settings: [
    {
      code: 'coupons.policies.max_per_customer',
      name: 'Max coupons per customer',
      valueType: 'integer',
      defaultValue: 5,
      groupCode: 'coupons.policies',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'coupons',
  name: 'Coupons',
  description: 'Promotional codes redeemable at checkout.',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels', 'pricing'],
  settings,
});

export async function installHook({ em, log }) {
  log.info('coupons: seeding default policy presets');
  // await em.persistAndFlush(...);
}

export async function uninstallHook({ em, hard, log }) {
  if (hard) {
    log.info('coupons: deregistering external coupon webhook');
  }
}
```

### 3. Author migrations

Scaffold the migration into the module's own `migrations/` directory — never pick a number:

```bash
pnpm --filter backend run migration:new -- --module coupons --name coupons_init
```

```text
backend/src/modules/coupons/migrations/20260805T141530_coupons_init.ts
```

The `<YYYYMMDDTHHmmss>` prefix is a UTC timestamp, not a sequence number; the class name is derived mechanically from the filename. Register it with `pnpm --filter backend run composer:generate`, which emits `backend/src/db/migrations-registry.generated.ts` from a filesystem walk; commit the artefact with the migration. **An unregistered migration does not run**, and the declared `moduleId` in that entry is what the orchestrator's hard-uninstall path matches against when reverting. See [Database Migrations](../architecture/migrations.md) for the naming convention, the ordering rules, and the FK-drift validator that requires a cross-module foreign key to be backed by a manifest `dependencies` entry.

### 4. Register the module

There is nothing to hand-edit. `backend/src/manifest-index.generated.ts` is
**generated** (feature 072): every module directory that exports a lifecycle-shape
`manifest.ts` is discovered by the tree walk, together with its optional `installHook` /
`uninstallHook` exports. It is the only file that imports a manifest —
`registered-manifests.ts` derives `REGISTERED_MANIFESTS` from it, so there is one generated
registry and one command that refreshes it. Regenerate and commit the result:

```bash
pnpm --filter backend run composer:generate
```

It is **not** wired into `pnpm --filter backend run build`, and it used to be: a build that
re-derives a committed artefact writes its answer into its own output rather than into the
tree, so a checkout with a stale artefact builds cleanly and reports nothing — and the
production image, which holds only `backend/`, `packages/` and `scripts/`, cannot run a
generator that walks the whole workspace at all. `pnpm --filter backend run overlay:check`
is what fails the build when a committed artefact is stale with respect to the tree — the
one drift that is still possible now that the array is the walk.

### 5. Wire the routes through the gating wrapper

Inside `coupons/plugin.ts`:

```typescript
import { defineModuleRoutes } from '../../kernel/lifecycle/plugin-helpers.js';

const adminPlugin = defineModuleRoutes('coupons', async (scoped) => {
  await registerCouponsAdminRoutes(scoped, deps);
});
await adminPlugin(app);
```

This makes every coupon route return `503 MODULE_DISABLED + Retry-After: 60` when the module is disabled.

For BullMQ workers and event subscribers, use the matching helpers:

```typescript
import { defineModuleWorker, subscribeForModule } from '../../kernel/lifecycle/plugin-helpers.js';

const worker = defineModuleWorker('coupons', new Worker(...));
subscribeForModule('coupons', eventBus, 'orders.placed', handler);
```

### 6. Install locally

```bash
pnpm --filter backend run module:install coupons
```

Expected output:

```text
[install] coupons 1.0.0
  ✓ dependencies satisfied (settings, sales_channels, pricing)
  ✓ migrations applied: Migration20260805T141530CouponsInit
  ✓ settings reconciled: +1 group, +1 setting
  ✓ i18n bundles installed: en, pl
  ✓ admin actions reconciled: +1 row
  ✓ install hook completed (12 ms)
  ✓ registry updated: state=installed
done in 380 ms
```

### 7. Author tests

Per Constitution Principle III (TDD, NON-NEGOTIABLE), every module ships with unit + contract + integration tests. The lifecycle subsystem provides ready-to-use fixture helpers in `backend/test/fixtures/manifests/{basic-graph,cyclic-graph,deep-graph}/` for testing the manifest schema and dep graph.

## Extension points

- **Custom install / uninstall steps**: export `installHook` / `uninstallHook` from the module's `manifest.ts`. Hooks share the install transaction, so a throw rolls back migrations and settings.
- **License-tier gating** (planned): the manifest's `license` field is stored and audited; a future edition-composition pipeline will refuse to enable a paid module on a non-paid edition.

## Operator runbook

If a lifecycle command exits 75 ("lock-busy") repeatedly, a previous run may have crashed mid-install. Diagnose with:

```bash
redis-cli get b2b:module:lifecycle:lock
```

If the value is older than five minutes, the lock has expired — repeated 75 errors with a stale Redis key indicate a stuck `state='installing'` row in `module_registrations`. Inspect with `pnpm module:status` and follow the recovery steps in [Stuck Module-Lifecycle Lock](../operations/runbooks/module-lifecycle-stuck-lock).

## Tests

- Unit: `backend/test/unit/_lifecycle/{dep-graph,manifest-loader,manifest-schema.zod,lock,registry-cache}.test.ts`.
- Contract: `backend/test/contract/_lifecycle/{cli-install,cli-uninstall,cli-enable,cli-disable,cli-status,manifest-schema}.contract.test.ts`.
- Integration (require live Postgres + Redis): authored under `backend/test/integration/_lifecycle/` per the spec but executed in environments where the dev DB is up.
