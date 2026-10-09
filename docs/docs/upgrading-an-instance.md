---
title: Upgrading an instance
description: Move an Endora Commerce instance and its storefront from one release to the next with one command — what it changes, what it leaves alone, what to restart, and what to do on an instance whose CLI predates the command.
sidebar_position: 4
---

# Upgrading an instance

An instance holds no copy of the platform: the platform, the admin shell and every module are
packages it depends on. Upgrading it means moving **every package of the release** to the new
version together, installing them, and running the instance's own `setup` — which generates,
builds, migrates and installs every module the instance declares. A module that is new in the
release is not one of them until you declare it: see
[Adding a module that is new in a release](#adding-a-new-module).

One command does all of that:

```bash
pnpm run upgrade             # to the latest release
pnpm run upgrade 0.102.0     # to a release you name
```

Run it in the instance's root directory. If the instance was created by a release whose CLI
has no `upgrade` command, see [Instances created before the command](#before-the-command).

## Do not use `pnpm update`

`pnpm update` looks like the obvious command and leaves the instance in a state that works
until it does not, while exiting with `0`:

- Your `package.json` pins the packages of the release **exactly**, so the tree installs the same
  thing on any day and only one copy of each. `pnpm update` never moves an exact pin, so in an
  instance created by a release after `0.101.x` it changes none of them. In one created by
  `0.101.x` or earlier only `@endora-commerce/contracts` is exact: `pnpm update` moves every
  other package and leaves that one behind, so two copies are installed and pnpm prints an
  *unmet peer* warning per module.
- Before `1.0.0`, a `^0.101.0` range stops below `0.102.0`, so `pnpm update` cannot reach the
  next minor release at all.
- It rewrites the ranges of your other dependencies — `"react": "^19"` becomes `"^19.3.0"` —
  and it never moves a package pnpm installed by itself as a peer, such as
  `@endora-commerce/page-builder-core`.

## Before you start

- **Commit**, so the upgrade is one diff you can read and revert: `package.json` in each member,
  `pnpm-lock.yaml` and the storefront's two files.
- **Back up the database.** `setup` runs the new release's migrations, and migrations do not run
  backwards. For the same reason the command refuses a version older than the one installed.
- **Stop the API and its queue consumers**, so nothing is serving requests while the schema
  changes.
- **Preview it** with `pnpm run upgrade --dry-run`: every range it would move, every lockfile
  entry it would drop and every command it would run. It writes and runs nothing.

## What it does

1. It checks everything first: that it runs in an instance, that the platform is installed,
   that the version exists, and that **every** release package your manifests declare is
   published at that version. Any problem is reported in one message, and nothing is written.
2. In every `package.json` of the instance — the root, `backend/`, `admin/` and `docs/` — and in
   the storefront beside it, it moves each package of the release to the new version. An exact
   pin stays exact and `^` stays `^`. No other line changes.
3. In each `pnpm-lock.yaml` it drops the entries that name a package of the release at another
   version, so pnpm resolves them again — including the peers it installed by itself.
4. It runs `pnpm install` and `pnpm run setup` in the instance, then `pnpm install` in the
   storefront. Each command is printed before it runs.

Already at the version you asked for, it says so and changes nothing.

### What it leaves alone

- **Packages that are not part of the release.** Which packages belong to it is decided by the
  release itself, not by the `@endora-commerce/` scope, so a module versioned on its own outside
  the release, and every third-party package, keeps the range you wrote. Each scoped package it
  skips is named in the output.
- **A dependency that is not a version range** — `file:`, `link:`, `workspace:`, a tag. It is
  named, and kept.
- **The storefront's own files.** The storefront is your repository; only its release packages
  move. `--no-storefront` leaves it alone entirely, and `--storefront-dir <path>` names one that
  is not beside the instance. So a storefront keeps the source it was created with: when a
  release changes the storefront a new installation gets, yours gains that change only when you
  bring it over — see [Module blocks in an existing storefront](#storefront-block-renderers) for
  the one in `0.103.0` and [After upgrading to 0.104.0](#after-0-104-0) for the two in `0.104.0`.

## After it finishes

It ends by naming what to restart:

```bash
pnpm run start                                   # the API, and its queue consumers
pnpm run preview:admin                           # setup rebuilt the admin bundle
cd ../my-shop-storefront && pnpm run build && pnpm run start
```

Sign in and open **Modules** (`/platform/modules`) to check that the list loads.

If pnpm reports an *unmet peer* for a third-party package after the upgrade, a new release has
raised a range your `package.json` still holds lower. Raise it there to the range the warning
names and run `pnpm install`.

### Adding a module that is new in a release {#adding-a-new-module}

The upgrade moves the packages your instance already declares. A module that first appears in the
release is not among them, so after the upgrade it is neither installed nor listed on **Modules**.
To have it, declare its package in the root `package.json` and run `setup`, in the root of the
instance:

```bash
pnpm add -w -E @endora-commerce/mod-<name>@<version>
pnpm run setup
```

`<version>` is the release the instance is on — the version `@endora-commerce/platform` has in the
root `package.json`. Then restart the API and the admin preview, as above: `setup` applied the
module's migrations, installed it and rebuilt the admin bundle.

Both flags matter:

- **`-w`** — the root of an instance is a workspace root, and the module list is its
  `dependencies`. Without the flag pnpm 9 refuses with `ERR_PNPM_ADDING_TO_ROOT`.
- **`-E` and the version** — every package of the release is pinned in that file at exactly one
  version. Without them pnpm writes a range, `^<version>`, for this one package, which an install
  that resolves it again may take to a later patch than the rest: the mixed set described under
  [An instance that is mixed from the start](#an-instance-that-is-mixed-from-the-start).
  `pnpm run upgrade` keeps an exact pin exact and a `^` a `^`, so a range written here stays a
  range.

Whether the module comes up switched on is the module's own declaration; the section for the
release that brings it says which.

## If a step fails

The command exits with that step's own exit code and prints what is left, as commands you can
type. The manifests already name the new version, so `pnpm run upgrade <version>` run again picks
up from the install. `pnpm run setup` on its own is always safe to run again.

## Instances created before the command {#before-the-command}

The `upgrade` command is part of `@endora-commerce/cli`. An instance created by release
`0.101.x` or earlier has a CLI without it and no `upgrade` script. Install the CLI of the release
you are moving to, then run the command through it:

```bash
pnpm add -D -w @endora-commerce/cli@<version>
pnpm exec endora upgrade <version>
```

To have `pnpm run upgrade` from then on, add `"upgrade": "endora upgrade"` to the `scripts` in
your root `package.json`.

### Instances created with 0.100.x

Measured from `0.100.2` to `0.101.1`, the commands above upgrade the instance and fix what the
platform packages fixed: the **Modules** screen loads and `module:enable`, `module:disable` and
`module:uninstall` take effect. Three things are not package fixes and the upgrade does not
change them:

- Two files the `0.100.x` installer did not write — the `DEPLOYMENT` line in `.env` and the
  `@endora-commerce/contracts` dependency. See
  [Instances created with 0.100.2 or earlier](./create-your-first-module.md#older-instances).
- The `0.100.x` installer wrote no storefront outside a checkout of the repository. Create one
  with `endora new storefront` — see [The storefront](./getting-started.md#the-storefront).
- The `0.100.x` installer did not move a port that was already taken, so check that `.env`
  does not point at another stack's database before you run anything.

### Instances created before 0.102.0 {#puck-rename}

Release `0.102.0` moved the page builder from `@measured/puck` to `@puckeditor/core` — Puck
renamed its package at 0.21 — and the upgrade does not rename it in your files. After
`pnpm run upgrade` finishes, replace `"@measured/puck"` with `"@puckeditor/core": "^0.23.0"` in
every `package.json` that declares it (the instance's root and the storefront's), and in your own
files — the storefront's `app/`, `components/` and `test/`, and anything of yours under
`admin/src` or an overlay module — change the imports `'@measured/puck'` to `'@puckeditor/core'`
and `'@measured/puck/puck.css'` to `'@puckeditor/core/puck.css'`.
`grep -rl "@measured/puck" --exclude-dir=node_modules .` in each tree finds them. Then run
`pnpm install` in both. Left as it is, the storefront's `pnpm run build` fails type-checking.
Stored pages, blocks and templates need no change.

### After upgrading to 0.103.0 {#after-0-103-0}

`0.103.0` closes a tenant-isolation defect in every instance created from the published packages
up to and including `0.102.0`: requests were not confined to the organization of the customer or
API key making them, an administrator's reach was not read from their role, and audit entries did
not record the acting administrator. **The fix is the upgrade itself.** Nothing in the instance
has to be edited for it — `backend/src/index.ts` stays as it is.

**Move every `@endora-commerce/*` package together.** `pnpm run upgrade` does. If you set
versions by hand, do not leave one behind: with the platform upgraded and
`@endora-commerce/mod-organizations` still at an earlier version, every administrator — a platform
administrator included — reaches no organization and organization-scoped screens are empty. The
backend logs a warning at boot naming `adminTenantScopePort` when that is the case.

Three things the upgrade does not do for you.

**Give a role to every administrator account that has none.** An administrator's permissions and
the organizations they reach are both read from the role the account holds. An account without a
role used to be treated as reaching every organization; from `0.103.0` it is refused instead. It
can still sign in and sign out, and every permission-gated admin route — and the first read of
organization data on any other — answers `403 ADMIN_ROLE_REQUIRED`. The upgrade gives such
accounts no role, because any default would grant access nobody chose. The backend logs a warning
at every boot that says how many accounts are affected; no warning means there are none.

An administrator who can sign in chooses the role on the **Users** screen. When none can, run this
in the root of the instance:

```bash
pnpm run admin:create -- --email=<their e-mail> --password-stdin \
  --first-name=<first name> --last-name=<last name> [--role=<code>]
```

The command finds the account by its e-mail address and updates it: it assigns the
platform-administrator role (`platform_admin`), or the role `--role` names, **and sets the
password it is given** — the account's previous password stops working. It also makes the account
active, so do not run it for one you deactivated on purpose. `--password-stdin` reads the
password, at least 12 characters, from standard input. Every instance has the
`platform_admin` role from this release on: each boot ensures it exists, and it can no longer be
deleted. See
[Every administrator holds a role](./modules/admin_users.md#every-administrator-holds-a-role).

If something of yours creates administrator accounts through the API, it must now send the role
with the create: `POST /api/v1/admin/admin-users` without `adminRoleId`, and a `PATCH` that sets
it to `null`, answer `400 ADMIN_USER_ROLE_REQUIRED`.

**Run the order repair's dry run once.** An earlier release could leave an order cancelled or
paid while it still held stock or a credit reservation, and nothing releases those by itself.
In the root of the instance, after `pnpm run upgrade` finishes:

```bash
pnpm run cli orders transition-effects-repair           # lists, writes nothing
pnpm run cli orders transition-effects-repair --apply   # releases what the list named
```

Read the list before you apply it: a release changes reserved-stock counters and available
credit. `--except=<order id>` leaves an order out and `--order=<order id>` repairs only the ones
you name — see
[Repairing orders stranded by an earlier version](./modules/orders.md#repairing-orders-stranded-by-an-earlier-version).
A command that prints `No projects matched the filters` has run nothing, whatever its exit code:
that is `pnpm --filter backend …`, the form for a checkout of the Endora Commerce repository,
typed in an instance.

**Add one line to the storefront's `vitest.config.mts`.** The storefront's own `.tsx` tests fail
with *Failed to parse source for import analysis* once its install resolves Vite 8. Beside the
`esbuild` block in that file, add:

```ts
oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
```

#### Module blocks in an existing storefront {#storefront-block-renderers}

From `0.103.0` a module package can carry the storefront renderers of its own Page Builder blocks,
and a storefront created by `0.103.0` or later wires them in by itself. **A storefront created
earlier does not gain this by upgrading**: the upgrade moves its packages, not its source. After
the upgrade it builds and renders the pages it rendered before. What it lacks:

- a block that only a module package renders is not drawn — there is no `blocks:generate` script
  to find the package and nothing to import its renderer;
- a block of a module you switched off is not hidden, where a newer storefront renders nothing
  in its place;
- there is no `lib/page-builder/local-blocks.tsx` for a block the storefront renders itself.

If you use none of these, you can leave the storefront as it is. To bring it forward, take the
files from a storefront written by the new CLI. Create one beside yours — it reads its settings
from the `.env` you copy in, and nothing is installed or run:

```bash
mkdir ../storefront-0.103.0
cp ../my-shop-storefront/.env ../storefront-0.103.0/.env
pnpm exec endora new storefront ../storefront-0.103.0
```

Then, from that directory into your storefront:

1. **Copy the files that are new**: `components/BlockRenderScope.tsx`, the directory
   `lib/page-builder/`, `scripts/block-discovery.mjs`, `scripts/generate-blocks.mjs`,
   `app/blocks.generated.css`, and the tests `test/block-registry.test.ts` and
   `test/ssr/module-blocks.test.tsx`.
2. **Take the new version of the files that changed** — or, where you have edited one, apply its
   difference by hand: `components/PageBuilderRender.tsx`, `app/layout.tsx`, `app/globals.css`,
   `app/blog/_components/BlogCategoryPage.tsx`, `app/blog/_components/BlogPostBody.tsx`,
   `components/Megamenu/MenuCmsBlockEmbed.tsx`, `lib/api/module-presence.ts`,
   `scripts/theme-discovery.mjs`, and the tests `test/lib/module-presence.test.ts` and
   `test/ssr/block-degradation.test.tsx`. `diff -ru ../my-shop-storefront ../storefront-0.103.0`
   shows each difference, beside your own changes.
3. **Add the script to `package.json`** and run it in `dev` and `build`, after `themes:generate`:

   ```json
   "dev": "pnpm run themes:generate && pnpm run blocks:generate && node --env-file-if-exists=.env node_modules/next/dist/bin/next dev",
   "build": "pnpm run themes:generate && pnpm run blocks:generate && next build && pnpm run check:themes",
   "blocks:generate": "node scripts/generate-blocks.mjs",
   ```

4. If your storefront mounts Puck's `<Render>` anywhere of its own, render `PageBuilderRender`
   there instead: it is the one place the modules' blocks and the switched-off rule are applied.
5. Run `pnpm run typecheck`, `pnpm test` and `pnpm run build`, then delete the directory you
   copied from.

How far this procedure has been exercised: on a storefront created by `0.102.0` and not edited
since, it produces the same files a `0.103.0` storefront has, and the type-check, the tests and
the build pass. It has not been exercised on a storefront whose files were changed, nor by
rendering a module's block on a storefront brought forward this way — check the pages that hold
Page Builder content before you deploy.

### After upgrading to 0.104.0 {#after-0-104-0}

`pnpm run upgrade 0.104.0` is the whole upgrade: nothing in the instance has to be edited for it.
What follows is one module the upgrade does not add, three things that behave differently
afterwards, and what an existing storefront and your own code may want to take.

**The new module, CRM, is not added by the upgrade.** `0.104.0` is the first release of `crm`
(`@endora-commerce/mod-crm`): sales opportunities with a status workflow, a board, a calendar and
analytics, in the Admin UI. An instance that upgrades does not have it — it is not on **Modules**
and `/crm/board` answers *Page not found*. To add it, in the root of the instance:

```bash
pnpm add -w -E @endora-commerce/mod-crm@0.104.0
pnpm run setup
```

with the version your instance is on in place of `0.104.0` if it has moved since — see
[Adding a module that is new in a release](#adding-a-new-module) for both flags. Then restart the
API and the admin preview.

- **It comes up switched on.** `setup` installs it, and from the restart it is active, with a
  **CRM** section in the sidebar. If you want the package without the feature, switch it off on
  **Modules** (`/platform/modules`): its screens, permissions and settings are withdrawn, its
  routes answer `503 MODULE_DISABLED`, and nothing is deleted.
- **No role is given its permissions.** `crm:read`, `crm:write`, `crm:configure` and
  `crm:analytics` are granted to no role automatically. A platform administrator holds every
  permission and sees the module at once; give the four to any other role that should.
- **Demo data.** In an instance seeded with the demo shop, `pnpm run cli demo seed` adds a demo
  sales pipeline. Once it has, run `pnpm run cli demo reset` only while CRM is switched on: while
  it is off the reset stops at the organizations with a foreign-key refusal.

See [CRM](./modules/crm.md) for what the module does.

**Three things behave differently after the upgrade.** None needs a step unless you want the
earlier behaviour.

- **A search phrase is answered by the search module.** `GET /api/v1/catalog/products` with a
  phrase (`q`) — what the storefront's `/search` page reads — used to be answered from the database
  unless `CATALOG_SEARCH_BACKEND=meilisearch` was set. With the variable unset, a phrase now goes to
  the `search` module whenever it is switched on: results are ranked by relevance and forgive a
  typo, and a fragment from the middle of a word or a SKU no longer matches. Set
  `CATALOG_SEARCH_BACKEND=postgres` in the instance's `.env` to keep the previous behaviour.
- **A quote request with an unpriced line cannot be approved or ordered.** Accepting, approving
  and converting a quote request now answer `409` while a line has no agreed unit price. A request
  that is already `Approved` with such a line can no longer be converted into an order; its lines
  cannot be edited in that status, so the way forward is to resubmit it. To find them:

  ```sql
  select distinct qr.id, qr.business_id
    from quote_requests qr
    join quote_request_items it on it.quote_request_id = qr.id
   where qr.status = 'Approved' and it.agreed_unit_price is null;
  ```

  The same query with `qr.status = 'Completed'` lists the requests already ordered that way;
  their orders are not touched.
- **The Dictionary lists every ISO 639-1 language.** The rows that are missing are added on the
  first boot after the upgrade, inactive, so nothing that reads the active languages changes;
  `en-US` and `pl-PL` stay the only active ones until you activate another. An added row you
  delete returns on the next boot — leave it inactive instead.

**In an existing storefront**, which keeps the source it was created with:

- In `lib/api/cms.ts`, change the cache tag of the `getCmsPageIndex` fetch from `'cms:page'` to
  `CMS_STOREFRONT_CACHE_TAGS.pageIndex`, imported from `@endora-commerce/contracts`. Without it
  everything keeps working, and a newly published CMS page reaches `sitemap.xml` only when the
  60-second cache window runs out.
- A category can now carry Page Builder content, edited from the **Content** action on the
  category tree. A storefront shows it only if it renders it. One written by the `0.104.0` CLI
  does: `app/(catalog)/c/[slug]/page.tsx` reads `getCategoryPageContent(node.id, ctx)`, a function
  of `lib/api/catalog.ts`, and draws the result with `components/CategoryContent.tsx`. To take
  them, create a storefront to copy from the way
  [Module blocks in an existing storefront](#storefront-block-renderers) does.

**`@dnd-kit/core` is a new peer dependency of `@endora-commerce/admin-kit`.** pnpm installs a
missing peer by itself unless you have turned that off, so an instance needs to do nothing. If
your `.npmrc` sets `auto-install-peers=false`, add `"@dnd-kit/core": "^6.3.1"` to the
`dependencies` of `admin/package.json`, which declares the kit, and run `pnpm install`.

**If your own code implements a platform port or builds one of its records** — an overlay module,
or a test double — four shapes of `@endora-commerce/contracts` gained a required member, and that
code does not compile until it has it: `CartRecord.sourceQuoteRequestId` (`null` when the cart
came from no quote request), `CatalogAttributeView.isPriceRule` (`false`),
`AuthSessionReadPort.lastSeenByAdminUser` and `LanguageSeedPort.ensureSeeded`.

How far this has been exercised: the upgrade from `0.103.1`, on an instance created with the demo
module set, ran to the end with pnpm 9 and nothing edited by hand, and the admin and an unchanged
storefront built and served their pages afterwards; `crm` was then added with `pnpm add -w` and
`setup`, and came up switched on. The exact form of `pnpm add` above was run on a scratch
workspace and not on an upgraded instance. Switching `crm` off, the two storefront changes, an
instance with `auto-install-peers=false` and one with overlay modules were not exercised; what
this section says about them is what the release's changelogs state.

## An instance that is mixed from the start

The installer of `0.101.x` or earlier wrote every package of the release with a `^` except
`@endora-commerce/contracts`. Run after a newer patch was published, it installed that patch of
every package except `@endora-commerce/contracts`, which stayed at the older one; the install
prints *unmet peer @endora-commerce/contracts* once per module. `pnpm run upgrade` — or, before
the command, the two commands above — puts every package on one version. Later installers write
every package of the release at exactly the version you install, so a new instance is never
mixed.

## Without the CLI

What the command does can be done by hand: in every `package.json` of the instance and the
storefront, set each `@endora-commerce/*` package that is part of the release to the new
version, keeping `^` and exact pins as they are; delete `pnpm-lock.yaml` and run `pnpm install`
(which also moves your other dependencies within their ranges); then run `pnpm run setup`, and
`pnpm install` in the storefront.
