---
title: Module Lifecycle
description: CLI-driven install / uninstall / enable / disable / status for every backend module + dependency validation + first-boot reconciliation
---

# Module Lifecycle

Platform-internal subsystem that turns every backend module into a first-class lifecycle citizen: declarative manifest, dependency graph, install / uninstall / enable / disable / status, persisted registry, transactional install with migration rollback, and a per-process enabled-set cache — refreshed over Redis pub/sub — that gates HTTP routes, BullMQ workers, and event subscribers without restarting the process.

The subsystem itself lives inside the host package — the `lifecycle/` directory of `@endora-commerce/platform` — not in a module folder. It is the one registered module the packaging sweep does not turn into a package of its own: the lifecycle machinery is the platform's operator half, so it ships with `@endora-commerce/platform` to every instance that installs the platform at all, rather than being a separate package an instance could be missing. Its module id is still `_lifecycle`, and the leading underscore still marks it as platform-internal; every other backend module opts in by exporting a `manifest` constant from its `manifest.ts`.

What stays in the application, at `backend/src/lifecycle/`, is the wiring an instance must own anyway, and it stays for a reason rather than as residue. The **manifest-registry binding** (`registered-manifests.ts`) hands the platform's deriver three things the platform cannot see — this tree's generated manifest index, the deployment's overlay tree and the instance's installed packages — as a parameter rather than as a reach; and each of the five `module:*` commands keeps a twenty-line entry point that opens *this* instance's ORM and Redis and calls the body. The bodies, the argv grammar and the exit-code table are in the package. The deployment's divergence **reader** sits beside the rest of the overlay machinery at `backend/src/overlay/divergence-loader.ts`, because the path it composes is in the deployment tree, which belongs to the client; the platform holds the declaration's *parser* and receives the parsed value.

Everything else the application used to name at an old path it now names at `@endora-commerce/platform/lifecycle`. That subpath is **declared and not published**: `node` and `tsc` resolve it for the host, its entry points and the test tree, no published barrel carries it, and `check:platform-surface` reports a module naming it as `host-internal-subpath`. A module that could name this surface could install, uninstall, enable or disable its siblings.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/modules` | Read-only listing of every module's id, state (`installing` / `installed` / `disabled` / `uninstalled` / `not-installed`), version (registered vs on-disk), declared dependencies, and any flags (`orphan`, `pending-upgrade`, `dep-missing`, `dep-disabled`). Permission: `platform.modules.read`. |

Mutating operations (install, uninstall, enable, disable) are intentionally CLI-only in v1.

## CLI commands

Every command is wired in `backend/package.json`:

```bash
pnpm --filter backend run module:install <id> [--dry-run] [--json]
pnpm --filter backend run module:uninstall <id> [--hard] [--force] [--json]
pnpm --filter backend run module:enable <id> [--json]
pnpm --filter backend run module:disable <id> [--cascade] [--json]
pnpm --filter backend run module:status [<id>] [--filter=<state>] [--json]
```

Exit-code contract:

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

Every module exports a `manifest` constant from `packages/modules/<id>/src/manifest.ts`:

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

- `id` (required, string) — must match the module package's directory name (`packages/modules/<id>/`); regex `^_?[a-z][a-z0-9_]*$`.
- `name` (required, string) — human-readable display name (1–120 chars).
- `description` (optional, string) — up to 2000 chars.
- `version` (required, string) — semver-lite (`MAJOR.MINOR.PATCH` plus optional `-prerelease` suffix).
- `dependencies` (required, string array) — module ids the platform needs installed before this one. Validated against the manifest registry at boot.
- There is **no `license` field.** A manifest that still declares one is not refused; the key is dropped. A module package's licence is its `package.json` `license`, which `manifests:generate` copies from the repository root's `license` unless the module exports `packageLicense` beside its manifest — `LICENSE-COMMERCIAL.md` at the repository root describes that declaration. The platform never reads a licence at runtime: no module is enabled, refused or limited because of one.
- `settings` (optional) — the `ModuleSettingsManifest` shape; the lifecycle's install path runs the existing settings reconciler over it.
- `i18n` (optional) — the `{ bundlesDir: string }` shape; when present, the install path reads `<modulePath>/<bundlesDir>/<lang>.json` for every supported Admin UI language and UPSERTs the bundle into `translation_bundles`. Soft-uninstall preserves bundles; hard-uninstall removes them.
- `actions` (optional) — the `ModuleAction[]` shape; an inline list of command-palette action declarations (id, label key, icon, target route, optional required-permission, weight, keywords). The install path UPSERTs every declared action into `module_actions` and prunes any rows the new manifest no longer declares; hard-uninstall removes them. See the [Admin Command Palette Actions](./admin-actions.md) module page for the full schema and operator-side behaviour.
- `permissions` (optional) — the assignable admin-role codes for this module. Each entry `{ code, label, module? }` is merged into `GET /api/v1/admin/permissions` when the module is enabled. Every `requireAdmin('…')` literal on the module's admin routes must appear here (or in core `PERMISSION_CATALOGUE` for shared codes). CI enforces this via `permission-inventory.test.ts`.

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

The refused module is named in `details.module` on **every** `MODULE_DISABLED` response, not only the route gate: the id travels on `ModuleDisabledError` itself, so a port resolution and a `requireModuleEnabled` call answer the same shape. It has to be `details` rather than a field beside `code`, because the error envelope replaces an operator-visible message with the registered sentence for its **code**, and `MODULE_DISABLED` is one code for every gated port in the platform — the module id is what turns "Module Disabled." into a sentence an operator can act on, and `errors.MODULE_DISABLED` interpolates `{module}` out of exactly that detail.

The enabled set is cached per process and refreshed via Redis pub/sub on the `b2b:module:state-changed` channel; cache lookups are O(1) in-memory (~50 µs).

## Adding a new module — walkthrough

A worked example for a fictional `coupons` module that depends on `pricing` and `sales_channels`.

### 1. Create the package

```text
packages/modules/coupons/
├── package.json            generated by `manifests:generate` — never hand-written
├── i18n/{en,pl}.json
├── docs/coupons.md
└── src/
    ├── manifest.ts
    ├── migrations/
    └── backend/
        ├── entities/
        ├── services/
        ├── routes.admin.ts
        └── index.ts        exports registerModule(ctx)
```

### 2. Author the manifest

```typescript
// packages/modules/coupons/src/manifest.ts
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
packages/modules/coupons/src/migrations/20260805T141530_coupons_init.ts
```

The `<YYYYMMDDTHHmmss>` prefix is a UTC timestamp, not a sequence number; the class name is derived mechanically from the filename. Register it with `pnpm --filter backend run composer:generate`, which emits `backend/src/db/migrations-registry.generated.ts` from a filesystem walk; commit the artefact with the migration. **An unregistered migration does not run**, and the declared `moduleId` in that entry is what the orchestrator's hard-uninstall path matches against when reverting. See [Database Migrations](../architecture/migrations.md) for the naming convention, the ordering rules, and the FK-drift validator that requires a cross-module foreign key to be backed by a manifest `dependencies` entry.

### 4. Register the module

There is nothing to hand-edit. `backend/src/manifest-index.generated.ts` is
**generated**: every module directory that exports a lifecycle-shape
`manifest.ts` is discovered by the tree walk, together with its optional `installHook` /
`uninstallHook` exports. It is the only file that imports a manifest —
`registered-manifests.ts` derives `REGISTERED_MANIFESTS` from it, so there is one generated
registry and one command that refreshes it. Regenerate and commit the result:

```bash
pnpm --filter backend run composer:generate
```

The module package's own `package.json` is generated too, by a second command, and its
output changes what the workspace declares — so run an install in the same breath and
commit `pnpm-lock.yaml` with it:

```bash
pnpm --filter backend run manifests:generate
pnpm install --lockfile-only
```

`composer:generate` is **not** wired into `pnpm --filter backend run build`, and it used to be: a build that
re-derives a committed artefact writes its answer into its own output rather than into the
tree, so a checkout with a stale artefact builds cleanly and reports nothing — and the
production image, which holds only `backend/`, `packages/` and `scripts/`, cannot run a
generator that walks the whole workspace at all. `pnpm --filter backend run overlay:check`
is what fails the build when a committed artefact is stale with respect to the tree — the
one drift that is still possible now that the array is the walk.

### 5. Register routes, workers and subscribers through the module's own seams

Everything the module contributes to the running process is registered from its
`registerModule`, through the `ModuleContext` the kernel container hands it:

```typescript
// packages/modules/coupons/src/backend/index.ts
import type { ModuleContext } from '@endora-commerce/platform/kernel';

export function registerModule(ctx: ModuleContext): void {
  ctx.routes(async (app) => {
    await registerCouponsAdminRoutes(app, ctx.cradle<CouponsCradle>());
  });

  ctx.worker(new Worker('coupons.expiry', processor, { connection: redis }));

  ctx.subscribe('orders.placed', async (payload) => {
    await handleOrderPlaced(payload);
  });
}
```

**The gating wrappers are applied by those three seams, not by you.** `ctx.routes`
wraps the registration in `defineModuleRoutes(module.id, …)`, so every coupon route
returns `503 MODULE_DISABLED` with `Retry-After: 60` while the module is off — and
so does a route somebody adds to that registration a year from now, which is the
point of gating at the registration seam rather than per handler. `ctx.worker` and
`ctx.subscribe` do the same for `defineModuleWorker` and `subscribeForModule`.
`ctx.worker` takes a **constructed** `Worker`, not a factory.

**You cannot call the wrappers yourself, and that is deliberate rather than
discouraged.** `@endora-commerce/platform` publishes five subpaths and no deep
paths, so the relative specifier this step used to show
(`'../../kernel/lifecycle/plugin-helpers.js'`) resolves to nothing from a module
package — and the bare spelling does not rescue it, because
`defineModuleRoutes`, `defineModuleWorker`, `subscribeForModule`,
`pauseWorkersFor` and `resumeWorkersFor` are **not** exported from the
`./kernel` barrel. That is a decision recorded in the barrel itself, which classifies the
worker and subscription wrappers as application-only: publishing them would
re-open by bare specifier the seam `check:subscribe-seam` closed by relative
path. An import naming one fails `tsc` and is reported by
`pnpm --filter backend run check:platform-surface` as `unpublished-symbol`.

The one wrapper the barrel does publish is `requireModuleEnabled`, for an entry
point that has **no port and no request**. It is not the escape hatch for a
module: its single call site in the tree is the platform's own
`cli/module-commands.ts`, published host-internally as
`@endora-commerce/platform/cli` and reached by
the application through a re-export shim at `backend/src/cli/module-commands.ts`,
where the **host** asks about the module that declared the operator command it is
about to run, once, before it builds a context. A `cliCommands` handler receives
an ordinary `ModuleContext` and uses the same seams as everything above.

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

Test-driven development is non-negotiable: every module ships with unit + contract + integration tests. The lifecycle subsystem provides ready-to-use fixture helpers in `backend/test/fixtures/manifests/{basic-graph,cyclic-graph,deep-graph}/` for testing the manifest schema and dep graph.

## Extension points

- **Custom install / uninstall steps**: export `installHook` / `uninstallHook` from the module's `manifest.ts`. Hooks share the install transaction, so a throw rolls back migrations and settings.

## Operator runbook

If a lifecycle command exits 75 ("lock-busy") repeatedly, a previous run may have crashed mid-install. Diagnose with:

```bash
redis-cli get b2b:module:lifecycle:lock
```

If the value is older than five minutes, the lock has expired — repeated 75 errors with a stale Redis key indicate a stuck `state='installing'` row in `module_registrations`. Inspect with `pnpm module:status` and follow the recovery steps in [Stuck Module-Lifecycle Lock](../operations/runbooks/module-lifecycle-stuck-lock.md).

## Tests

- Unit: `backend/test/unit/_lifecycle/{dep-graph,manifest-loader,manifest-schema.zod,lock,registry-cache}.test.ts`.
- Contract: `backend/test/contract/_lifecycle/{cli-install,cli-uninstall,cli-enable,cli-disable,cli-status,manifest-schema}.contract.test.ts`.
- Integration (require live Postgres + Redis): authored under `backend/test/integration/_lifecycle/` but executed in environments where the dev DB is up.
