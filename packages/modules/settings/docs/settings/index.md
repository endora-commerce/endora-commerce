---
title: Settings
sidebar_position: 1
description: Manifest-driven, per-sales-channel platform configuration with cached read API
---

# Settings

The Settings module owns platform-wide configuration. Other modules contribute
their own setting groups and individual settings through a typed manifest;
platform administrators tune values per sales channel from the Admin UI; any
backend module reads values through one well-known service.

## Concepts

- **Setting** — a single tunable knob. Carries a name, a globally-unique
  machine code, a value type (`string` / `number` / `boolean` / `json` /
  `string_list`), a manifest-supplied default value, and a sales-channel
  scope (empty scope means "applies to every channel").
- **Setting Value** — an admin-chosen value for a `(setting, sales_channel)`
  pair. Replaces the manifest default for that channel. Resolution order is
  always: per-channel value → manifest default.
- **Setting Group** — a logical section under which related settings appear in
  the Admin UI. The built-in `general` group is system-protected. Deleting any
  other group reassigns its settings to `general` and preserves their values.

## For module authors — declaring your settings

Each module that wants to register settings or groups exports a sibling
`manifest.ts` file using the helper from `@endora-commerce/contracts`:

```ts
// backend/src/modules/<your_module>/manifest.ts
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';

export const settingsManifest = defineModuleSettingsManifest({
  moduleCode: 'your_module',
  groups: [{ code: 'your_section', name: 'Your section' }],
  settings: [
    {
      code: 'your_module.base_url',
      name: 'Base URL',
      groupCode: 'your_section',          // optional — defaults to 'general'
      valueType: 'string',
      defaultValue: 'https://default.example',
      // salesChannelCodes: ['main', 'wholesale']  // optional — empty = all
    },
  ],
});
```

Append your manifest to the array in `backend/src/composition.ts` — the
boot-time reconciler walks every entry and inserts any missing rows
idempotently. Re-running is always safe; admin-chosen values are never
overwritten.

### Reconciler guarantees

| Behavior | Outcome |
|----------|---------|
| First-time apply | New groups + settings inserted; `owner_module` set to your module code. |
| Re-apply (no changes) | No-op. |
| Re-apply (added entry) | Only new entries are inserted. |
| Re-apply (renamed `name`/`description`) | Updated in place. |
| Re-apply (changed `valueType` or `defaultValue`) | Rejected without `--force` to keep existing per-channel values valid. |
| Re-apply (entry removed from manifest) | Boot sync ignores the removal — orphan rows are logged but not deleted. Only `modules:uninstall` is destructive. |
| Setting code conflicts with another module | Reconciliation aborts with a clear error. |

## For platform admins — editing values

Open `Admin → Operations → Settings`. Settings are grouped by their owning
section. Selecting one opens an editor on the right; you can:

- Apply a value to **every sales channel in scope** in one click.
- Apply a value to a **chosen subset** of channels (the editor enforces the
  "at least one channel" rule).
- **Reset** the per-channel values back to the manifest default.

Concurrent edits are detected via an `expectedVersion` (ISO timestamp). If
someone else has changed the setting since you opened it, the save returns
`409 VERSION_CONFLICT` and a banner asks you to refresh and retry — no silent
overwrites.

Setting groups are managed under `Admin → Operations → Setting groups`.
The `general` group is system-protected; the platform refuses to delete it.
Deleting any other group reassigns its settings to `general` and preserves
their per-channel values.

Every value change and group mutation lands an `audit_log_entries` row with
the actor, action, target, and new value.

## For module consumers — reading values

Other modules inject `SettingsService` from the composition root and read
through a single API. The result is always either the admin-chosen value
for the requested channel or the manifest default.

```ts
import { z } from 'zod';

// In your module's plugin:
const baseUrl = await settingsService.get(
  'your_module.base_url',
  request.salesChannelId,
  z.string().url(),
);
```

### Errors

| Thrown | When |
|--------|------|
| `SettingNotRegistered` | The code has no row in `settings`. The caller has a typo or the module that should declare it has not been installed. |
| `SettingOutOfScopeForChannel` | The setting was registered with an explicit channel scope and the requested channel is not in that scope. Indicates a programmer error: the consuming module should not be reading this setting in this context. |
| `SettingValueShapeMismatch` | The stored value passed Zod validation at write time but failed the caller's schema (e.g. an admin set the value via a manifest with a wider type). Surfaced as a fail-fast misconfiguration. |

### Performance

The universal getter is cheap enough to call freely from request paths.
Resolution order:

1. Per-process LRU (1024 entries, entries older than 30 s ignored).
2. Redis (`settings:v1:<code>:<channelId>`, TTL 1h).
3. Postgres (one keyed lookup against `(setting_id, sales_channel_id)`).

Cache invalidation hangs off the EventBus events that the admin service
emits on every value or group mutation. The EventBus is in-process, so the
writing process picks the change up immediately, and every other process
picks it up on its next read past the 30 s window — invalidation dropped the
shared Redis entry, and the local window is measured from when the value was
loaded rather than from the last read, so even a setting read on every request
ages out.

That window is the bound on how long a missed invalidation can be visible. It
is also why the operator-facing "clear cache" page is a diagnostic tool rather
than a repair: it drops both layers in the process that serves it and the
shared entries for everyone, and every other process converges within the same
30 s.

## CLI

Two scripts ship with the backend:

```bash
# Idempotently reconcile a module's manifest into the database.
pnpm --filter backend run modules:install <module-code> [--force] [--dry-run]

# Remove a module's settings + groups. The flag is required — there is no
# implicit default. --remove-settings deletes everything owned by the module
# (cascade-deletes per-channel values); --preserve-settings keeps everything
# in place so a future re-install picks the rows up unchanged.
pnpm --filter backend run modules:uninstall <module-code> \
    (--remove-settings | --preserve-settings)
```

Both commands write `audit_log_entries` rows. `modules:install` exit codes:
`0` success, `64` misuse, `65` invalid manifest, `66` conflict, `70` internal
error.

## Database

Five tables introduced by migration `024_settings_init.ts`:

- `setting_groups` (with `is_system_protected` for the built-in `general`)
- `settings` (FK → `setting_groups`, value-type enum, `jsonb` default)
- `setting_values` (per-`(setting, sales_channel)` admin override; UNIQUE)
- `setting_group_sales_channels` (M:N scope)
- `setting_sales_channels` (M:N scope; empty = all channels)

`setting_values.sales_channel_id` cascade-deletes when the channel is
removed; remaining bindings on the same setting are preserved.

## See also

- Specification: `specs/004-settings-module/spec.md`
- Implementation plan: `specs/004-settings-module/plan.md`
- Contract: `specs/004-settings-module/contracts/settings-004.contract.md`
- Constitution: Principles I (Modular), III (TDD), V (TS + Zod), VI (Naming)
