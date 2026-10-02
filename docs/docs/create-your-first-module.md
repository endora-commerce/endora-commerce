---
title: Create your first Module
description: A 20-minute tutorial — add your own module to a new Endora Commerce instance, with a setting you edit in the admin, an API route, a permission and a translation, then switch it off and on.
sidebar_position: 3
---

# Create your first Module

This tutorial takes a new instance and adds one small module of your own to it: a **store notice**.
The shop owner types a short message in the admin ("We are closed 24-26 December"), and the
storefront — or anything else — reads it from an API route. It takes about 20 minutes.

Every command and file on this page was run on an instance created with
`npx create-endora-commerce@latest`, on releases `0.100.1` and `0.100.2`. Where something does not work
for you today,
the page says so in a box like this one and gives the way round it:

:::caution Limit today
Four things on this page are harder than they should be. They are collected in
[What does not work yet](#what-does-not-work-yet), each with what was observed.
:::

## What a module is

A **module** is one self-contained capability of the shop — the blog, the product comparison, the
newsletter. It declares what it is in a **manifest** (its name, its settings, its permissions, what
it depends on) and registers what it does in one function, `registerModule` (its services, its API
routes). The platform composes every module the same way, so a module can be switched off and
behaves as if it were never installed.

The modules that came with your instance are packages in `node_modules`, and you never edit them.
A module of your own lives in your instance's `apps/<deployment>/modules/` directory and is called
an **overlay module**: it is added on top of the platform, and no platform file changes.

## What you need

- An instance from [Getting started](./getting-started.md). This page assumes it is in `my-shop`,
  created with the default deployment name, so your own modules go in `apps/my-shop/modules/`. If
  you passed `--deployment`, or named the directory differently, use the directory you find under
  `apps/`.
- Its development services running (`pnpm run dev:services`), and the administrator you created
  during the install.
- A terminal in the instance's root directory. Stop `pnpm run dev:all` if it is running (Ctrl-C);
  you start it again in step 7.

## Step 1 — Name your deployment

The platform composes your overlay modules only when it knows which deployment it is running as.
Add one line to the `.env` file in the instance's root:

```bash
echo "DEPLOYMENT=my-shop" >> .env
```

The value is the name of the directory under `apps/`. Without this line nothing fails: your module
is simply not there, and nothing says why.

## Step 2 — Add the contracts package

A manifest is written with two helpers from `@endora-commerce/contracts`. The instance does not
declare that package itself, so add it, at the same version range as the platform:

```bash
pnpm add -w "@endora-commerce/contracts@$(node -p "require('./package.json').dependencies['@endora-commerce/platform']")"
```

The part in `$(…)` prints the range your `package.json` already has for
`@endora-commerce/platform` — for example `^0.100.2` — so the two packages stay on one release.

## Step 3 — Write the manifest

Create the module's directory and its manifest. The directory name is the module's id: lower-case
letters, digits and underscores.

```bash
mkdir -p apps/my-shop/modules/store_notice/i18n
```

```ts title="apps/my-shop/modules/store_notice/manifest.ts"
import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

const settings = defineModuleSettingsManifest({
  moduleCode: 'store_notice',
  groups: [{ code: 'store_notice', name: 'Store notice' }],
  settings: [
    {
      code: 'store_notice.enabled',
      name: 'Store notice enabled',
      description:
        'Switches the store notice module on or off as a whole. Nothing is deleted: the notice text is kept and comes back when you switch the module on again.',
      groupCode: 'store_notice',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: 'store_notice.message',
      name: 'Notice text',
      description:
        'A short message for your customers, for example a holiday closure. Leave it empty to show nothing.',
      groupCode: 'store_notice',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'store_notice',
  name: 'Store notice',
  description: 'A short notice the shop owner writes and the storefront can display.',
  version: '1.0.0',
  dependencies: ['settings', 'auth'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [{ code: 'store_notice:read', label: 'View the store notice' }],
  activation: { settingCode: 'store_notice.enabled', default: true },
});
```

What each part is for:

- **`settings`** — two Settings the module owns. `store_notice.message` is the module's data: the
  admin gets a field for it with no screen written by you. `store_notice.enabled` is the module's
  on/off switch, which `activation` points at.
- **`dependencies`** — the modules this one needs. `settings` stores the notice; `auth` owns the
  check that an administrator is signed in, used in step 4.
- **`permissions`** — the permission code that guards the admin route. Declaring it here is what
  makes it grantable to a role.
- **`i18n`** — the directory, beside the manifest, holding the module's translations.

## Step 4 — Register the routes

```ts title="apps/my-shop/modules/store_notice/backend.ts"
import { z } from 'zod';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type {
  ModuleContext,
  RequireAdminFactory,
  SettingsReadPort,
} from '@endora-commerce/platform/kernel';

interface StoreNoticeCradle {
  readonly requireAdmin: RequireAdminFactory;
}

export function registerModule(ctx: ModuleContext): void {
  const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
  const readNotice = async (): Promise<{ message: string; visible: boolean }> => {
    const message = (await settings.get('store_notice.message', null, z.string())).trim();
    return { message, visible: message.length > 0 };
  };

  ctx.routes(async (app) => {
    app.get('/api/v1/store-notice', async () => ({ data: await readNotice() }));

    app.get(
      '/api/v1/admin/store-notice',
      { preHandler: ctx.cradle<StoreNoticeCradle>().requireAdmin('store_notice:read') },
      async () => ({ data: await readNotice() }),
    );
  });
}
```

- **`registerModule(ctx)`** is the module's one entry point. The platform calls it once at start.
- **`ctx.routes(…)`** registers the routes, and is why the on/off switch works: routes registered
  through it answer `503` while the module is off. `app` is an ordinary Fastify instance.
- **`lazyPort(ctx, 'settingsReadPort')`** is how a module reads something another part of the
  platform provides. `null` as the second argument reads the platform-wide value rather than one
  sales channel's.
- **`requireAdmin('store_notice:read')`** guards the second route with the permission from the
  manifest. The code must match exactly.

Nothing in an instance compiles this file: Node runs it directly and removes the types as it goes.
So write plain TypeScript — an `enum`, a `namespace` or a constructor parameter property stops the
start with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

## Step 5 — Add the translations

Every user-facing string ships in English and Polish. This module has one: the label of its
permission, shown when a role is edited. The files are flat `key: text` maps.

```json title="apps/my-shop/modules/store_notice/i18n/en.json"
{
  "adminRoles.permission.store_notice:read": "View the store notice"
}
```

```json title="apps/my-shop/modules/store_notice/i18n/pl.json"
{
  "adminRoles.permission.store_notice:read": "Odczyt komunikatu sklepu"
}
```

## Step 6 — Install the module

The platform now sees the module, and reports it as not installed:

```bash
pnpm run module:status
```

```text
store_notice          not-installed  —        1.0.0    settings,auth
```

Install it. This is the step that creates its settings and loads its translations:

```bash
pnpm run module:install store_notice
```

```text
[install] store_notice 1.0.0
  ✓ dependencies satisfied
  ✓ migrations applied: (none)
  ✓ settings reconciled: +1 groups, +2 settings (~0 updated)
  ✓ install hook completed (0 ms)
  ✓ registry updated: state=installed
```

Then record what your deployment now does differently from the platform:

```bash
pnpm run generate
```

Among its output is one line about your module:

```text
[undeclared-divergence] apps/my-shop/divergence.ts: no reason for `port-consumed:store_notice:settingsReadPort` — 'store_notice' resolves the port 'settingsReadPort', owned by a composition root
```

The instance keeps a report of every place it reaches into the platform, and asks for one sentence
of your own per entry. Open `apps/my-shop/divergence.ts` and give the reason, under the key the
message names:

```ts title="apps/my-shop/divergence.ts"
export const divergence = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {
    'port-consumed:store_notice:settingsReadPort':
      'The store notice text is a Setting, so the module reads it through the settings port.',
  },
} as const;
```

Run `pnpm run generate` again: the line is gone, and
`apps/my-shop/divergence.generated.md` lists `store_notice` with your sentence. That file is the
first thing to read when a platform upgrade changes something you relied on.

## Step 7 — See it work

Start the instance:

```bash
pnpm run dev:all
```

**The API route.** In a second terminal:

```bash
curl http://localhost:3001/api/v1/store-notice
```

```json
{"data":{"message":"","visible":false}}
```

**The setting, in the admin.** Open the admin at `http://localhost:3002`, sign in, and go to
**System → Settings**. Find the **Store notice** group, type a message into **Notice text** and
press **Save 1 change(s)**. Ask the route again:

```json
{"data":{"message":"We are closed 24-26 December. Orders ship from 27 December.","visible":true}}
```

**The permission and its translation.** Go to **System → Roles** and pick a role. The permission
list has a `STORE_NOTICE` group with `store_notice:read — View the store notice`. Switch the admin
to Polish with the language picker in the top bar and the same line reads
`Odczyt komunikatu sklepu`.

The admin route `GET /api/v1/admin/store-notice` answers `401` without a signed-in administrator
and the same body as the public route with one; step 8 shows how to call an admin route from a
terminal.

## Step 8 — Switch it off and on

Every module can be switched off by the people running the shop, and a module that is off behaves
as if it were not installed. Nothing is deleted, and switching it on again brings everything back.

:::caution Limit today
The switch belongs on the admin's **Modules** screen (**System → Modules**). In an instance that
screen currently shows `NOT_FOUND: Resource not found.` and an empty list, and
`pnpm run module:disable <id>` prints `registry updated: state=disabled` without changing anything.
Until both are repaired, use the API call the Modules screen itself makes, as below.
:::

Sign in from the terminal, keeping the session cookie in a file:

```bash
curl -c cookies.txt -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}' \
  http://localhost:3001/api/v1/auth/admin/login
```

Switch the module off:

```bash
curl -b cookies.txt -H 'content-type: application/json' \
  -d '{"active":false}' \
  http://localhost:3001/api/v1/admin/modules/store_notice/activation
```

```json
{"module":{"id":"store_notice","present":false,"platformState":"installed","activated":false,"deactivatable":true,"nonDeactivatableReason":null}}
```

Now the route refuses, with no restart:

```bash
curl -i http://localhost:3001/api/v1/store-notice
```

```text
HTTP/1.1 503 Service Unavailable

{"error":{"code":"MODULE_DISABLED","message":"The \"store_notice\" module is off, so this action was refused. Check its state on the Modules screen.", …}}
```

The `store_notice:read` permission has also left the list of permissions a role can be given.
Switch the module on again with the same call and `{"active":true}`: the route answers `200`, with
the notice you saved. Delete `cookies.txt` when you are done.

You wrote no code for any of this. It follows from two things you already did: the `activation`
line in the manifest, and registering the routes through `ctx.routes`.

## What does not work yet

Checked on releases `0.100.1` and `0.100.2`. Each is a limit of the product today, not of your module.

| What | What you see | What to do |
| --- | --- | --- |
| `DEPLOYMENT` is not written by the installer | The instance has `apps/my-shop/`, but `.env` has no `DEPLOYMENT`, so an overlay module is silently not composed | Step 1 |
| `@endora-commerce/contracts` is not a dependency of an instance | `ERR_MODULE_NOT_FOUND … '@endora-commerce/contracts'` from your `manifest.ts`, on every command | Step 2 |
| The Modules screen does not load in an instance | `NOT_FOUND: Resource not found.` and "No modules to show" | The API call in step 8 |
| `pnpm run module:disable <id>` changes nothing in an instance | It prints `state=disabled`; `pnpm run module:status` still says `installed` and the routes still answer | The API call in step 8 |

Three more limits decide what your first module can be:

- **An overlay module cannot own a database table.** It contributes settings, routes, permissions
  and translations, and no entity and no migration. In an instance this is not refused: a
  `migrations/` or `entities/` directory inside an overlay module is ignored, no table is created,
  and nothing reports it. Keep small state in Settings, as this module does.
- **A module that needs its own table is a module package**, and so is a module with its own admin
  screen. `endora new module` scaffolds one — with `--entities` for a table and `--admin` for a
  screen — but it runs only inside a checkout of the Endora Commerce repository. In an instance it
  stops, naming `backend/scripts/generate-module-manifests.ts` as missing. This tutorial does not
  cover writing a package by hand.
- **There is no storefront to show the notice in** unless your instance was created from a checkout
  of the repository — see
  [What a first run does not give you](./getting-started.md#what-a-first-run-does-not-give-you). The
  route is what a storefront would call.

## Where to go next

- [Overlay pattern](./architecture/overlay-pattern.md) — everything an overlay module may do,
  including changing what a platform service does with `ctx.di.decorate`.
- [The customisation ladder](./architecture/customisation-ladder.md) — which seam to reach for
  first, and what each one costs you at the next upgrade.
- [Permissions](./architecture/permissions.md) — how permission codes, roles and modules relate.
- [Module lifecycle](./modules/lifecycle.md) — installing, enabling, disabling and uninstalling.
- [Admin UI translations](./contributing/translations.md) — the Polish glossary and how a module's
  `i18n/` bundles are loaded.
- [Modules](./modules/README.md) — the modules your instance already has; their pages show what a
  finished module declares.
