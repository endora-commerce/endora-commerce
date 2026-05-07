---
title: Module Lifecycle
---

# Module Lifecycle

Platform-internal subsystem (feature 018) that turns every backend module into a first-class lifecycle citizen: declarative manifest, dependency graph, install / uninstall / enable / disable / status, persisted registry, transactional install with migration rollback, and a Redis-backed enabled-set cache that gates HTTP routes, BullMQ workers, and event subscribers without restarting the process.

The subsystem itself lives at `backend/src/modules/_lifecycle/`. The leading underscore marks it as platform-internal (alongside `auth` and `example`); every other backend module opts in by exporting a `manifest` constant from its `manifest.ts`.

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

Legacy `pnpm modules:install` / `pnpm modules:uninstall` (plural) print a deprecation notice and forward to the singular form. They will be removed in the next minor release.

## Manifest file shape

Every module exports a `manifest` constant from `backend/src/modules/<id>/manifest.ts`:

```typescript
import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

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

Soft-uninstall preserves data: settings rows are removed, the registry row keeps `state = 'uninstalled'`, schema and data tables are untouched. Re-installing the same module reuses already-applied migrations and finishes in seconds.

Hard-uninstall (`--hard`) additionally reverts the module's migrations (matched by filename pattern `^\d+_<id>_`) and deletes the registry row.

## How disable works (feature gating without restart)

When a module is disabled the platform inactivates three layers via wrappers:

1. **HTTP routes** registered through `defineModuleRoutes(moduleId, register)` — the wrapper installs an `onRequest` hook that returns `503 Service Unavailable` with `{error:{code:'MODULE_DISABLED',module:'<id>'}}` and `Retry-After: 60`.
2. **BullMQ workers** registered through `defineModuleWorker(moduleId, worker)` — paused on disable, resumed on enable.
3. **Event subscribers** registered through `subscribeForModule(moduleId, bus, event, handler)` — handler is a no-op when the module is disabled.

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
import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

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

### 3. Author migrations using the filename convention

```text
backend/src/db/migrations/040_coupons_init.ts
```

The leading number is sequential (next available after the previous module's last migration). The `<id>_` infix is what the orchestrator's hard-uninstall path matches against — modules whose migration filenames don't follow this convention skip migration revert with a warning.

### 4. Register the module

Add an entry to `backend/src/modules/_lifecycle/registered-manifests.ts`:

```typescript
import { manifest as couponsManifest, installHook as couponsInstall, uninstallHook as couponsUninstall } from '../coupons/manifest.js';

export const REGISTERED_MANIFESTS: ReadonlyArray<RegisteredManifestEntry> = [
  // …
  {
    manifest: couponsManifest,
    installHook: couponsInstall,
    uninstallHook: couponsUninstall,
  },
];
```

Run the index generator (also wired into `pnpm build`):

```bash
pnpm --filter backend run manifest-index:generate
```

The parity test (`test/unit/_lifecycle/manifest-index-parity.test.ts`) catches drift if you forget this step.

### 5. Wire the routes through the gating wrapper

Inside `coupons/plugin.ts`:

```typescript
import { defineModuleRoutes } from '../_lifecycle/plugin-helpers.js';

const adminPlugin = defineModuleRoutes('coupons', async (scoped) => {
  await registerCouponsAdminRoutes(scoped, deps);
});
await adminPlugin(app);
```

This makes every coupon route return `503 MODULE_DISABLED + Retry-After: 60` when the module is disabled.

For BullMQ workers and event subscribers, use the matching helpers:

```typescript
import { defineModuleWorker, subscribeForModule } from '../_lifecycle/plugin-helpers.js';

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
  ✓ migrations applied: 040
  ✓ settings reconciled: +1 group, +1 setting
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
