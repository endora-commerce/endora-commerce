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
  the one in `0.103.0`, [After upgrading to 0.104.0](#after-0-104-0) for the two in `0.104.0` and
  [After upgrading to 0.105.0](#after-0-105-0) for the ones in `0.105.0`.

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
release is not among them, so after the upgrade it is neither installed nor listed on **Modules** —
unless a module the instance installed requires it: `setup`'s first step, `endora generate`,
declares and installs such a module itself. To have any other one, declare its package in the root `package.json` and run `setup`, in the root of the
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
analytics, in the Admin UI. An instance created by `0.103.x` or earlier does not have it after
the upgrade — it is not on **Modules** and `/crm/board` answers *Page not found*. (One created by
the `0.104.0` installer already declares the package, and `pnpm add` answers *Already up to
date*.) To add it, in the root of the instance:

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
  sales pipeline. `pnpm run cli demo reset` withdraws it whether or not CRM is switched on; the
  three demo tags are withdrawn only by a reset run while it is on.

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

### After upgrading to 0.105.0 {#after-0-105-0}

`pnpm run upgrade 0.105.0` moves the packages and applies the release's migrations, and the
instance starts afterwards with none of its files edited. What the release changes is behaviour:
how administrators sign in and how long a session lasts, which sales channel an order and a
method belong to, who reads a custom field, and a number of the API's answers. This section says
what to do, in order, and then what behaves differently for each reader:
[operators](#after-0-105-0-operators), [API clients and integrators](#after-0-105-0-api),
[module and overlay authors](#after-0-105-0-authors) and the owner of
[an existing storefront](#after-0-105-0-storefront).

#### What to do, in order {#after-0-105-0-steps}

Before the upgrade:

1. **Read `quote_requests.expiry_days`** — *Auto-expire pending after (days)* on the Quote Requests
   tab of **Settings** — for the default sales channel. With `0`, the default, nothing follows.
   With any other value, the expiry sweep, which runs from this release on, expires on its first
   runs after the upgrade every open quote request that has been inactive for that long. Set it
   to `0` first if you want to look at the open requests before that happens; *Quote requests
   expire* under [For operators](#after-0-105-0-operators) has the rule.
2. **On an instance with one sales channel, read `orders.min_order_value`.** Set for the default
   channel rather than for all channels, it was not enforced on storefront orders and now is.
3. **If a job of yours runs `demo reset`**, decide whether its command line needs
   `--force-delete-financial-records`: without the flag the reset now refuses a demo on which a
   payment was taken or an invoice issued.

After the upgrade, before the instance takes traffic again:

4. **Behind a reverse proxy, check that `TRUSTED_PROXY_HOPS` or `TRUSTED_PROXY_ADDRESSES` is set**
   in the backend's environment. Neither variable is new. What is new is a limit on wrong
   administrator passwords that is counted per client address: without one of the two, every
   request has the proxy's address, so five wrong passwords for an account, from anybody, delay
   sign-in to that account from every device that has not signed in to it before.
   [G3 of the first-deployment checklist](./deployment/first-deployment-checklist.md#g3-tell-the-backend-which-proxy-may-name-the-clients-ip-address)
   says how to choose the value.
5. **On an instance with more than one sales channel** — every instance seeded with the demo data
   is one — review every delivery and payment method
   (*Delivery and payment methods are offered per sales channel* below) and make the edits under
   [In an existing storefront](#after-0-105-0-storefront).
6. **Review your custom-field definitions** on the Custom Fields screen. The upgrade marks every
   existing definition `customer`, so nothing that customers and integrations were answered is
   withdrawn. Move to `internal` each field whose values are for administrators only.
7. **If a script or an integration calls `POST /api/v1/admin/i18n/reload` or
   `GET /api/v1/admin/i18n/coverage`**, give the role of the administrator it signs in as
   `settings:write` for the first and `settings:read` for the second.
8. **Only on a public demo that publishes an administrator password on purpose**, consider
   `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off` — *Administrator sign-in is limited* below says when and
   what it switches off.
9. **Rebuild your own modules against this release.** Source that implements one of the ports
   listed under [For module and overlay authors](#after-0-105-0-authors) does not compile until it
   is changed, and a module that seeds a delivery or payment method has to be released again.

Whenever it suits you:

10. Add three lines to the instance's `.gitignore`, which keeps the content it was created with:

    ```
    docs/build/
    docs/.docusaurus/
    backend/var/
    ```

    Building the instance's documentation site writes the first two directories, and with them
    tracked the diff of an upgrade is no longer the `package.json` per member and the lockfile —
    in the upgrade described at the end of this section it was 162 files. If either is already
    committed, run `git rm -r --cached docs/build docs/.docusaurus` once: git never ignores a
    file it tracks. `backend/var/` is where files uploaded to the asset library are stored while
    `assets.local.base_dir` has its default, `var/assets`. No release's `.gitignore` covers it,
    so it shows as untracked beside the upgrade's diff. It is your shop's data and not source:
    keep it out of the repository and back it up together with the database — a database
    restored without it lists assets whose files are missing.
11. In an instance seeded with the demo shop, run `pnpm run cli demo seed` again. The demo
    `sales_representative` role was seeded with a permission code no module declares, which makes
    the role editor refuse every save of that role with
    `400 Unknown permission(s): organizations:read.assigned`; seeding again withdraws the code
    from the role and changes nothing else on it.

#### For operators {#after-0-105-0-operators}

**Administrator sign-in is limited.** A password or a second-factor code for an administrator
account can be tried only a few times in a row: five wrong attempts from one address on one
account, or twenty on one account from all addresses together, start a delay of one minute that
doubles with each further wrong attempt up to fifteen minutes. During a delay the attempt is
answered `429 ADMIN_AUTHENTICATION_THROTTLED` and a correct password is refused too. Nothing is
locked permanently: the count is cleared by a successful attempt and forgotten thirty minutes
after the first wrong one.

- A completed password sign-in leaves a cookie, `b2b_admin_device`, on the device. It is not a
  session and grants nothing; a device that holds it is counted on its own budget of five and not
  on the account's twenty, so wrong passwords sent by somebody else do not keep an administrator
  out of a device they have used before.
- To clear every count for one account, from the root of the instance:

  ```bash
  pnpm run cli admin_users unlock --email=<their e-mail>
  ```

  In a production image the same command is `node dist/cli.js admin_users unlock --email=<their e-mail>`,
  run in the backend container. Its first line of output names the Redis it acted on.
- Each delay that starts for an existing account writes one audit entry,
  `admin_user.authentication_throttled`.
- The counts are kept in Redis. While Redis does not answer, sign-in is refused with
  `503 ADMIN_AUTHENTICATION_UNAVAILABLE`.
- **A public demo.** The limit of twenty assumes the password is a secret. On an instance that
  publishes an administrator's e-mail address and password on purpose, every visitor is a
  first-time device and shares that budget. For such an instance, and only for such an instance,
  set `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off` in the backend's environment and restart it. It switches
  off the account-wide count of wrong **passwords** and nothing else — the limit per address, the
  limit per known device, both limits on second-factor codes and the delays stay — and the backend
  logs a warning on every start while it is off. Only the exact value `off` does it. It is not a
  Setting and cannot be changed from the Admin UI. A `compose.prod.yml` written by an earlier
  release does not hand the variable to the backend: add
  `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT: ${ADMIN_AUTH_ACCOUNT_WIDE_LIMIT}` beside the
  `TRUSTED_PROXY_ADDRESSES` line. Do not set it where administrator passwords are not public.

The numbers are fixed in the module and are not Settings. See
[Repeated wrong passwords and codes are throttled](./modules/admin_users.md#repeated-wrong-passwords-and-codes-are-throttled).

**A credential change ends the sessions obtained before it.** Expect administrators and customers
to be signed out on their other devices where they were not before:

- an administrator changing their own password, or switching their own two-factor authentication
  off, ends every other session of the account and keeps the one the change was made from;
- deactivating or deleting an administrator ends every session of the account, and a session of
  an account that is not active is refused whether or not anything revoked it;
- `pnpm run admin:create` run again for an account that already exists replaces its password, as
  before, and now also ends every session of that account;
- a customer changing their password, or switching their two-factor authentication off, ends
  every other session of the account; redeeming a password-reset link ends all of them, and so
  does an administrator's reset of a customer's second factor.

Each of these also withdraws a sign-in that had been started and not finished — a pending
second-factor challenge or setup ticket. API keys are not sessions and are not affected. See
[Sessions and password changes](./modules/admin_users.md#sessions-and-password-changes).

**An administrator types the current password to change their own.** The profile screen has a
*Current password* field above *New password*, asked for only when a new password is typed, and
a new password equal to the current one is refused. Resetting another administrator's password
from **Users** and `admin:create` are unchanged.

**The idle-logout window applies to every administrator.** `admin.idle_logout_minutes` is now
delivered to every signed-in administrator. An administrator whose role does not include
`settings:read` was signed out after the built-in 60 minutes whatever the setting said, and is
now signed out after the configured time.

**A custom field has an audience.** Every definition says who its values are answered to:
`internal` — administrators only — or `customer` — also the customer's own order and
quote-request replies and the external (API-key) order replies. Definitions that existed before
the upgrade are `customer`; a field created from now on is `internal` unless its author chooses
otherwise in the definition form (*Who can see the value*). A change of audience takes effect on
the next read and can take up to five seconds to reach every API process. See
[Audience: who reads a field's values](./architecture/custom-fields.md#audience-who-reads-a-fields-values).

**Quote requests expire.** The expiry sweep the `quote_requests` module documents now runs: every
30 minutes, in every process that consumes queues, while the module is switched on.
`quote_requests.expiry_days = 0`, the default, disables it. Otherwise a request that is still
`Pending` or `Created from admin`, has had nothing added to its history for that many days and
carries no offer whose validity date is still ahead becomes `Expired`.

- **Turning the setting on, or lowering it, expires the backlog.** The rule applies to everything
  that is open, not from the day it is set — and an instance that already has the setting set
  meets that backlog on the first runs after this upgrade.
- A run expires at most 500 requests, oldest first; a larger backlog is worked off over the
  following runs.
- No notification record is written for a request that became due more than 24 hours before the
  run that reached it. It still gets its history entry, and `rfq.expired.v1` is still emitted.
- The sweep reads the default sales channel's value and applies it to the requests of every
  channel; a channel set to `0` is not exempt.

See [Background jobs](./modules/quote_requests.md#background-jobs).

**An order placed on the storefront is recorded on the sales channel the request was made on.**
`POST /api/v1/orders` used to take the order's channel from an optional `salesChannelId` in the
body and otherwise use the system-default channel; it now uses the channel the request resolves —
`X-Sales-Channel`, `?salesChannel=`, the host map, else the default — and refuses a body that names
a different one. What that means depends on how many sales channels the instance has. An
instance seeded with the demo data has two — `pl_retail`, the default, and `pl_b2b_vip` — so
*More than one* is the branch that applies to it, here and for the methods below.

- **One sales channel.** One thing can change. If `orders.min_order_value` is set **for the default
  channel** rather than for all channels, it was not enforced on storefront orders and now is.
  Check the value on **Settings** before upgrading if you are not sure which of the two it is.
- **More than one.** New orders placed on a non-default channel's storefront are recorded on that
  channel rather than on the default one, and its minimum order value, warehouses, fulfilment
  settings, order numbering, invoice seller details and numbering, and e-mail language apply to
  them. Existing orders are not rewritten. Baskets are still created on the default channel, so
  the line prices and the promotions of such an order are still the default channel's, and each
  product was checked against the channel of the request that added it to the basket, not against
  the order's — see *Which sales channel an order records* on the `orders` module page.

**Delivery and payment methods are offered per sales channel.** On `/delivery-methods` and
`/payment-methods` each method now has a **Sales channels** field, and the choice is enforced: the
storefront lists only the methods offered in the channel the buyer is shopping, and an order is
refused for a method its channel does not offer. A method assigned to no channel is offered in
every channel.

- **One sales channel.** Nothing changes: every method is offered on the one channel, whether it
  is assigned to it or to none.
- **More than one: review every method.** The **Sales channels** column on the two screens shows
  where each one stands.
  - Assigned to the **default channel only**, and so gone from the other channels' checkouts after
    the upgrade: every method created in the Admin UI so far, because the screens offered nothing
    else, and every method a gateway or carrier module created **under an earlier release** on an
    instance that had already been started. Nothing widens these for you — such a method cannot be
    told apart from one restricted on purpose.
  - Assigned to **no channel**, and so offered on every channel: every method a module creates
    from this release on, whenever it is installed; methods a module created under an earlier
    release during the instance's first setup, before its first start; and methods from the demo
    data.

  Open each method and choose its channels, or untick all of them to offer it everywhere.
- **A delivery method created in the Admin UI under an earlier release may be offered at no
  checkout at all**, on an instance with any number of channels, and was not before the upgrade
  either. The screen sent no adapter, so the method was saved with its own code as its adapter,
  and unless that code is the key of a registered adapter there is nothing to offer it with. This
  release marks such a row *Not offered at checkout*, with the reason. Open it and choose an
  adapter in the new **Adapter** select — *Own courier (manual)*, for one you ship yourself. It is
  then offered on the channels it is assigned to, which for a method created that way is the
  default channel only. Payment methods are not affected: one could not be created with an
  adapter that is not registered.

Assigning sales channels needs `delivery_methods:write` / `payment_methods:write` and nothing
else; the sales-channel permissions are not required.

**An Organization's method allow-lists bind every way of placing an order.** A delivery or payment
method outside a non-empty allow-list of the Organization the order is for is refused at
placement and at the order preview — on the storefront, through the API-key order intake, and
when an administrator creates the order for a customer. No setting exempts an administrator: the
create form lists every method, and the preview and the create refuse one the Organization does
not allow. An empty list is no restriction, as before. See
[Method allow-lists at placement](./modules/orders.md#method-allow-lists-at-placement).

**The adapter of a delivery method is chosen on `/delivery-methods`.** The form has a required
**Adapter** select. A method whose adapter no switched-on module provides is marked *Not offered
at checkout* with the reason, and is repaired by opening it and choosing a registered adapter;
nothing is rewritten or deleted for you. The adapter of a method that shipments reference cannot
be changed: set the method inactive and create another for the other adapter.

**The Webhooks screen offers the event types that are delivered, and no others.** A stored
subscription that names a type nothing delivers is kept, is marked as not delivered on the screen
and receives nothing, as before. Six types are delivered that were not: `product.created.v1`,
`product.updated.v1`, `product.archived.v1`, `rfq.created.v1`, `rfq.expired.v1` and
`credit_limit.adjusted.v1`. Nothing is batched — a subscription to `product.updated.v1` receives
one delivery per product an import or a bulk edit writes. See
[Which events are delivered](./modules/webhooks.md#which-events-are-delivered).

**An e-mail that was only written to the server log is not recorded as sent.** On an instance
with no `SMTP_URL`, rows of `email_deliveries` are written with `status = 'logged'` instead of
`'sent'` (rows written earlier keep `sent`), issuing an invoice or sending its e-mail again from
the Admin UI says that the e-mail was not sent because no mail server is configured, and a CRM
Event reminder is recorded as delivered to the bell alone.

**`demo reset` is one transaction, and refuses a demo that holds financial records.** It either
completes or changes nothing. It also withdraws what using the demo left behind under the demo
organization — orders, carts, quote requests, addresses and the like; these rows are deleted, and
another organization's data is not touched. It exits 1 before deleting anything when the demo
organization holds a payment that was paid or refunded, an invoice or a correction, an
accounting-system record or a refund, and prints how many of each it found. Orders that were
placed and never paid do not count. To delete the financial records with the rest:

```bash
pnpm run cli demo reset --force-delete-financial-records
```

The flag is read from that command line only. See
[Getting started](./getting-started.md) for the full list of what counts.

**The health endpoint reports the release.** `version` in `GET /api/v1/_health` is the version of
the `@endora-commerce/platform` package the process loaded — `0.105.0` — or `unknown`, where every
instance used to report `0.0.0`. A monitor that compared the field against `0.0.0`, or a
deployment that set `npm_package_version` to steer it, has to change. The Admin UI shows the same
release as a badge under the wordmark in the sidebar. See
[The `version` field](./operations/health-endpoint.md#the-version-field).

**The audit log gains entries and loses noise.** Every admin write to a CMS block, template or
hook now leaves an audit entry (`cms_block.*`, `cms_template.*`, `cms_hook.*`), as page writes
already did. An administrator's own password change is recorded as `admin_user.change_password`
with `via: 'self_service'` rather than as an `admin_user.update`. And four scheduled jobs — the
order follow-up sweep, the CRM event reminders, the product-feed reaper and the price-list status
sweep — no longer write a `tenant.escape_hatch` row on a run that finds nothing to do, which on a
quiet instance was several thousand rows a day.

Three smaller things: an administrator whose account holds no role is told so by a notice in the
Admin UI; the tabs of a CRM Opportunity show counts, and the migration that adds unread-message
counts marks every message written before it as read for everybody; and a newsletter campaign
with no sales channel is previewed and sent with the default channel's branding.

#### For API clients and integrators {#after-0-105-0-api}

Authentication and authorisation:

- **A guard is answered before the body is validated.** On every route that declares a session,
  permission or API-key guard, a request without valid credentials answers `401`, and one without
  the permission `403`, whatever its body. A client that expected `400 VALIDATION_FAILED` for an
  invalid body sent without credentials sees `401`/`403` instead. An authorised caller with an
  invalid body gets the same `400` as before, and a body the parser itself refuses — malformed
  JSON, an unsupported media type, a body over the limit — is still answered first.
- **`PATCH /api/v1/admin/me` needs `currentPassword` to change the password.** `password` without
  it answers `400 VALIDATION_FAILED`; a wrong one answers `403 CURRENT_PASSWORD_INVALID`; a new
  password equal to the current one answers `400 NEW_PASSWORD_UNCHANGED`. A refused request
  changes nothing, a name sent with it included. A request without `password` is unchanged.
- **Administrator credential routes can answer `429 ADMIN_AUTHENTICATION_THROTTLED`**, with a
  `Retry-After` header and the same number in `error.details.retryAfterSeconds`, or
  `503 ADMIN_AUTHENTICATION_UNAVAILABLE`: `POST /api/v1/auth/admin/login`, the current password on
  `PATCH /api/v1/admin/me`, `POST /api/v1/auth/admin/mfa/verify`,
  `POST /api/v1/admin/account/mfa/disable` and
  `POST /api/v1/admin/account/mfa/recovery-codes/regenerate`. Customer routes are unchanged.
- **A second-factor challenge admits five codes**, for customers and administrators, however they
  arrive; a code beyond that answers `429 MFA_TOO_MANY_ATTEMPTS` and the sign-in starts again.
- **A session of an administrator account that is deactivated or deleted answers
  `401 UNAUTHORIZED`** on every admin route; a permission-gated route answered it `403 FORBIDDEN`.
  An active account that lacks the permission still gets `403`.
- **On customer sign-in, `403 ACCOUNT_BLOCKED` is answered only when the password is correct.** A
  wrong password for a blocked account answers `401 INVALID_CREDENTIALS`.
- **`POST /api/v1/admin/i18n/reload` requires `settings:write` and
  `GET /api/v1/admin/i18n/coverage` requires `settings:read`**; a session without the code gets
  `403`.
- **Push subscriptions belong to whoever created them.** `DELETE /api/v1/storefront/pwa/subscriptions`
  removes a subscription only when the request carries the subscription's own keys —
  `{ endpoint, keys: { p256dh, auth } }` — or the session of the customer it belongs to; it
  answers `204` either way. `POST` to the same path updates an already registered endpoint on the
  same proof, and otherwise answers `201` with a fresh `id` and writes nothing.

Orders, methods and quote requests:

- **`POST /api/v1/orders` records the channel the request resolved.** A `salesChannelId` in the
  body that names a different channel answers `422 VALIDATION_FAILED` with
  `details.code = "order_sales_channel_mismatch"`. Stop sending the field and name the channel in
  `X-Sales-Channel`.
- **Placement and preview refuse a method the order's channel or Organization does not allow** —
  `400 VALIDATION_FAILED` with `error.details.code` one of `delivery_method_not_in_sales_channel`,
  `payment_method_not_in_sales_channel`, `delivery_method_not_allowed_for_organization` or
  `payment_method_not_allowed_for_organization`, on `POST /api/v1/orders`,
  `POST /api/v1/orders/preview-total`, `POST /api/v1/admin/orders`,
  `POST /api/v1/admin/orders/preview` and `POST /api/v1/external/orders`. On the last of these the
  allow-list refusal existed already; its `error.message` now ends *"… is not available to this
  Organization."*, `error.details` is present, and when both methods are outside the lists the
  delivery method is the one named. Match on `error.details.code`.
- **`GET /api/v1/delivery-methods` and `GET /api/v1/payment-methods` list the methods of the
  channel the request resolved.** A client that sends no `X-Sales-Channel` is answered for the
  default channel. One-click buy follows:
  `GET /api/v1/quick-order/one-click/eligibility` answers `{ enabled: false, reason: "missing_defaults" }`
  when the buyer's default method is not offered in the request's channel.
- **`salesChannelIds` on `PUT /api/v1/admin/{delivery,payment}-methods/:code`**: omitted, it leaves
  the assignment as it is (and assigns a new method to the default channel), as before; **`[]`
  now removes every assignment**, offering the method on every channel, where it was ignored; an
  id that names no sales channel answers `400 VALIDATION_FAILED` rather than `500`.
- **`PUT /api/v1/admin/delivery-methods/:code` answers `409` to a change of `adapter`** on a method
  that shipments reference. Rows of `GET /api/v1/admin/delivery-methods` carry
  `availability: { ownerModule, available, ownerPresence }`, and
  `GET /api/v1/admin/delivery-methods/adapters` lists the adapters that can be chosen. A create
  that omits `adapter` still takes the method's code as the adapter: send it, and read
  `availability.available` in the answer.
- **Order replies.** Customer-facing and external order replies carry `placedOnBehalf: boolean`
  and no longer carry `placedOnBehalfByAdminUserId`; admin replies carry both. Replace
  `order.placedOnBehalfByAdminUserId !== null` with `order.placedOnBehalf`. `customFieldValues`
  on those replies holds only the fields whose audience is `customer`.
- **Customer-facing replies carry no administrator identifier.** Quote-request replies to a
  customer no longer carry `createdByAdminUserId` and `assignedAdminUserId`, and their `events[]`
  no `actorAdminUserId` (`actorRoleLabel` still says who acted); order-comment replies to a
  customer no longer carry `authorAdminUserId` — a comment whose `authorCustomerAccountId` is
  `null` was written by staff. Admin replies are unchanged.
- **Two concurrent transitions of one quote request have one winner.** A buyer's accept or
  decline, a customer's edit and a seller's approve, revise, cancel or assign that lose to another
  transition, or to the expiry sweep, answer `409 VERSION_CONFLICT`.

Custom fields, webhooks and events:

- **`POST /api/v1/admin/custom-fields/definitions` without `audience` creates an `internal`
  field.** Send `"audience": "customer"` for a field customers and integrations are to read.
  Re-creating, as `customer`, a deleted key that still has stored values answers
  `409 CUSTOM_FIELD_DEFINITION_INVALID`: create it as `internal`, then change the audience.
  `PATCH …/definitions/:id` accepts `audience`, and no longer resets `config` when the body does
  not name it.
- **Webhook `eventTypes` are validated.** `POST /api/v1/admin/webhooks` and
  `PATCH /api/v1/admin/webhooks/:id` answer `422 WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`, with the
  refused names in `error.details.eventTypes`, for a type that is neither built in nor contributed
  by a module that is switched on. Only a name a write adds is checked; a stored subscription
  keeps the names it has. Deliverable in this release: `order.created.v1` and
  `order.status_changed.v1`; `crm.opportunity.created.v1`, `crm.opportunity.status_changed.v1` and
  `crm.opportunity.closed.v1` while `crm` is on; and the six new ones while their module is on —
  `product.created.v1`, `product.updated.v1`, `product.archived.v1`, `rfq.created.v1`,
  `rfq.expired.v1` and `credit_limit.adjusted.v1`. `GET /api/v1/admin/webhooks/event-types` answers
  the contributed ones. Product events reach platform-wide subscriptions only.
- **A contributed event type is delivered only while its module is switched on**; stored
  subscriptions are kept and receive nothing meanwhile.
- **`order.created.v1` is announced after the order's transaction has committed**, so a placement
  that fails announces nothing. `rfq.expired.v1` gains `organizationId`, and occurs only where the
  expiry sweep runs. `product.archived.v1` is now emitted whenever a product's status moves to
  `inactive`.

Error codes and smaller changes:

- **Two refusals of a cart line have their own code instead of `VALIDATION_FAILED`**:
  `400 CART_PRODUCT_QUOTE_ONLY` (`details.productId`), which quick order, one-click buy, a
  shopping list added to the cart, admin order creation and the API-key order intake can answer
  as well as `POST /api/v1/cart/items`; and `422 CART_QUANTITY_INVALID`, which no HTTP route
  reaches — a module calling `CartWritePort.addItem` in-process is answered it.
- **`details` gained fields**, with code and status unchanged: `409 LIMIT_INSUFFICIENT` —
  `availableAmount`, `orderTotal` (two-decimal strings) and `currency`; `409 STOCK_UNAVAILABLE` —
  `productId`, `sku`, `productName` and `requestedQuantity`; `413 ASSET_UPLOAD_TOO_LARGE` —
  `maxFileSizeMb`; `403 API_KEY_OUT_OF_SCOPE` — `requiredScope`. A client that compared
  `error.message` sees longer sentences, now also in Polish.
- **`details` changed shape on `400 SETTING_VALUE_SHAPE_MISMATCH`.** It is an object with
  `details.code` — `wrong_type` or `not_an_option` — and `settingCode`; the array of
  `{ path, issue }` a wrong-type refusal used to answer as `details` itself is now
  `details.issues`, and an option refusal carries `allowedValues` and `enumOptions`.
- **A malformed id answers `404`, not `500`**, on every `/api/v1/admin/customers/:id…` route
  (`CUSTOMER_NOT_FOUND`) and on the self-service address routes (`CUSTOMER_ADDRESS_NOT_FOUND`).
- **`GET /api/v1/catalog/products` cuts its page from the products that match.** On the default
  listing path a page holds `limit` matching products whenever that many exist and `hasMore` is
  `true` only when another exists. `filter[category]` naming a category that does not exist
  answers one empty page with `hasMore: false`. The shape and the cursor format are unchanged.
- **`POST /api/v1/organizations/register` answers `emailVerificationSent: false`** on an instance
  without a mail server, where the message was only logged.
- **Additions**: `idleLogoutMinutes` on `GET /api/v1/admin/me`; `GET /api/v1/admin/platform-info`
  (`{ "version": string | null }`, any signed-in administrator); `noteCount`, `attachmentCount`
  and `unreadMessageCount` on a CRM Opportunity, and
  `POST /api/v1/admin/crm/opportunities/:id/messages/read`.

#### For module and overlay authors {#after-0-105-0-authors}

**A route-level guard runs before validation.** The `preHandler` chain a route declares in its
own options is moved to that route's `preValidation` when the route is registered; no call site
changes, and a module built against an earlier platform is covered without being rebuilt. Two
things to check in your own code:

- A function you pass as a route's `preHandler` sees `request.body` parsed but **not validated** —
  any JSON value — and `request.params` / `request.query` without the schema's coercions and
  defaults. Work that needs the validated request belongs in the handler, in an API interceptor,
  or in a `preHandler` added with `addHook` on your plugin scope.
- An `addHook('preHandler')` on a plugin scope now runs **after** the route's guards. Whatever a
  route guard reads from the request has to be put there in `onRequest` or `preValidation`.

See [When the gate runs](./architecture/permissions.md#when-the-gate-runs).

**Code that implements a published port, or builds one of its records, does not compile until it
has the new member** — an overlay module's own implementation, or a test double typed as the port:

| Where | New required member |
| --- | --- |
| `AdminPermissionChecker` (`@endora-commerce/platform`) | `isActiveAdministrator(adminUserId)` |
| `SalesChannelMembershipPort` (`@endora-commerce/platform`) | `entityIdsInChannelSubquery`, `filterEntityIdsAvailableInChannel`, `clearChannelsForEntity` |
| `MfaLoginPort` | `invalidatePending(subject)` |
| `CustomFieldValuePort` | `projectForCustomer(entityType, bag)` |
| `DeliveryMethodReadPort`, `PaymentMethodReadPort` | `isAvailableInChannel(id, salesChannelId)` |
| `CustomFieldDefinitionRecord`, `CreateCustomFieldDefinitionRequest` | `audience` |
| `Order` (the inferred type) | `customFieldValues` (`{}`), `placedOnBehalf` |

The rows that name no package are in `@endora-commerce/contracts`. A module that answers
custom-field values to a non-administrator passes the stored bag through
`CustomFieldValuePort.projectForCustomer` in its serialiser.

**Removed.** `AdminAuthService.changePassword` in `@endora-commerce/mod-admin-users`, with the
fourth argument of that class's constructor — `AdminUserService.updateSelf` is the one
implementation, and `AdminUserService.update` no longer accepts `password`.
`ChallengeStore.recordFailedAttempt` in `@endora-commerce/mod-mfa`, replaced by `takeAttempt` and
`returnAttempt`. And `bindToDefaultChannel`:

**If your own module seeds a delivery or payment method from its install hook**,
`bindToDefaultChannel` is gone from the seed surface: delete the call after
`ensureMethodForAdapter`. Nothing replaces it — the seeded method is offered on every channel. The
module's source does not compile until you do. A build of it that was published earlier is not
compiled again, so it fails later instead — with a `TypeError` in its install hook the first time
it creates its method — and has to be re-released for this version. An instance that already has
the method's row is not affected, because the hook makes the call only for a row it has just
created. There is no seam for seeding a method restricted to particular channels; restrict it in
the Admin UI.

**Mail outcomes gained `logged`.** `EmailMailerSendOutcome`, `TransactionalSendOutcome`,
`EmailDeliveryStatus` and `InvoiceEmailNotSentReason` each have the new member, which the console
mailer answers instead of `sent`. Code with an exhaustive `switch` over one of them stops
compiling until it handles `logged`; code that reads `outcome.reason` after
`outcome.status !== 'sent'` has to narrow to `'suppressed'` first; code that compares with
`=== 'sent'` keeps compiling and now treats a logged message as not sent. `logged` is not a
failure and there is nothing to retry.

**A demo composition and a demo reset body run inside the reset's transaction.**

- The object `createDemoComposition` returns must declare `withdrawsInsideTransaction: true`. A
  reset over a composition that does not is refused before it starts.
- A module's `demo.reset` body and a composition's `withdraw` must write through the
  `EntityManager` they are handed (`em.nativeDelete`, `em.execute`), not through
  `em.getConnection().execute(…)`: the bare connection is outside the transaction, and while a
  reset runs a second connection is refused with *a reset body wrote outside the reset
  transaction*.
- `@endora-commerce/platform/demo` exports `DemoResetRefusedError`, for a composition to decline
  a reset with a message, and `DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`.

**Behaviour your code may meet.**

- `AdminPasswordVerificationPort.verifyPassword` can now reject with the `429` or the `503` of
  the sign-in limit instead of always resolving to a boolean, and takes an optional third
  argument naming the request's origin. A module that verifies an administrator credential itself
  adopts the same counters through `adminAuthenticationThrottlePort`.
- `AuthSessionPort.destroyAllForAdmin` and `destroyAllForCustomer` take an optional
  `{ exceptSessionId }`. An implementation that ignores it still type-checks and ends the calling
  session too.
- A payment or shipping adapter's `validateUseOnStorefront` receives the order's channel id in
  `salesChannelId` on a storefront placement, where it received `null`.
- A subscriber of `order.created.v1` or `promotion.used.v1` on the in-process bus runs after the
  order's transaction has committed. `product.archived.v1` is now emitted on every path that moves
  a product to `inactive`, and the write waits for its subscribers.
- A module offers its own events to webhooks by pushing their names into `webhookEventRegistry`
  from a boot hook and declaring the edge as `contributes-to`.
- `CustomFieldValuesPanel` in `@endora-commerce/admin-kit` hands `save` and `onChange` `null`,
  not `undefined`, for a cleared number, date or select.
- A theme override that styles the bottom border of `.b2b-sidebar__brand` should move it to
  `.b2b-sidebar__brand-row`, which owns the divider now.
- `npm_package_version` is no longer a declared platform environment input.

**If you construct these classes yourself** rather than through `composeApp` or the test kit:
`CmsBlockService`, `CmsTemplateService` and `CmsHookService` take the `CommandBus` as their second
constructor argument; `PasswordResetService` takes the session port as its second argument and the
audit port as its third; `makeEnqueuer` in `@endora-commerce/mod-google-analytics` takes a second,
required argument; and the scheduled consumers of `mod-orders`, `mod-crm`, `mod-product-feeds` and
`mod-price-lists` take a question that says whether a run has work — the changelog of each package
names the members.

#### In an existing storefront {#after-0-105-0-storefront}

**In an existing storefront**, which keeps the source it was created with, neither the order calls
nor the two method catalogues tell the backend which channel the buyer is on: they are made without
the request context, so no `X-Sales-Channel` header is sent and the backend resolves the default
channel for them. On an instance with one sales channel that is the right answer and nothing has to
change. On an instance with more than one, make all of these edits together — with only some of
them the checkout would list one channel's methods and place the order on another, and the order
would be refused:

- In `lib/api/orders.ts`, add `import type { RequestContext } from './client';`, add a last
  parameter `ctx: RequestContext` to `placeOrder`, `previewOrderTotal` and `cloneOrderToQuote`,
  and add `ctx,` to the options object each of them hands to `apiMutate`.
- In `lib/api/quick-order.ts`, which already imports `RequestContext`, do the same for
  `placeOneClickOrder` (`apiMutate`) and `getOneClickEligibility` (`apiGetAuthed`).
- In `lib/api/methods.ts`:
  - change the first import to `import { apiGet, type RequestContext } from './client';`;
  - give the two exported functions a parameter and hand it on —
    `listDeliveryMethods(ctx: RequestContext)` returning
    `withModuleAbsence(() => fetchDeliveryMethods(ctx), [])`, and
    `listPaymentMethods(ctx: RequestContext)` returning
    `withModuleAbsence(() => fetchPaymentMethods(ctx), [])`;
  - give the two private functions the same parameter, `fetchDeliveryMethods(ctx: RequestContext)`
    and `fetchPaymentMethods(ctx: RequestContext)`, and in each pass `ctx` as the second argument
    of its `apiGet` call.
- In `test/checkout/delivery-catalogue-absence.test.tsx` and
  `test/checkout/payment-catalogue-absence.test.tsx`, which a created storefront carries and its
  `tsconfig.json` includes, the two functions are called without an argument — four times in each
  file. Change every `listDeliveryMethods()` to `listDeliveryMethods({})` and every
  `listPaymentMethods()` to `listPaymentMethods({})`. Without this the storefront's type-check
  fails with `Expected 1 arguments, but got 0` in those two files. Skip it if you have deleted them.
- Pass the context at the call sites. `getServerContext` is already imported in all four files:
  - `app/(commerce)/checkout/page.tsx`: the page component reads
    `const { locale } = await getServerContext();` — change it to
    `const { locale, ctx } = await getServerContext();` and pass `ctx` to the `listDeliveryMethods`
    and `listPaymentMethods` calls below it. In `submitAction`, a separate function, add
    `const { ctx } = await getServerContext();` before the `placeOrder` call and pass `ctx` as its
    last argument.
  - `app/(account)/preferences/page.tsx`: the same change to
    `const { locale } = await getServerContext();`, and pass `ctx` to the two list calls.
  - `app/(catalog)/p/[slug]/page.tsx`: the page component **already has** `ctx` in scope, so pass
    it to `getOneClickEligibility` and declare nothing; in `oneClickAction`, a separate function,
    add `const { ctx } = await getServerContext();` before the `placeOneClickOrder` call and pass
    `ctx`.
  - `app/(account)/orders/[id]/page.tsx`, in `reorderToQuoteAction`: add
    `const { ctx } = await getServerContext();` before the `cloneOrderToQuote` call and pass `ctx`.

`getServerContext()` takes the channel from the `x-sales-channel` header of the request the
storefront itself receives, which is what your reverse proxy or middleware already stamps per
host for the pages to render in the right channel.

Three more changes a storefront created by an earlier release does not receive:

- **Removing a push subscription.** In `lib/api/pwa.ts`, `unsubscribeFromPush()` sends the
  endpoint alone, which the backend now acts on only for the signed-in customer the subscription
  belongs to. Send the keys with it — read `const json = subscription.toJSON();` before the
  `fetch`, and make the body

  ```ts
  body: JSON.stringify({
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
  }),
  ```

  Without it, switching notifications off in a signed-out browser leaves the subscription
  registered on the backend until the push service reports it gone.
- **Catalogue blocks in the server-rendered HTML.** `ProductGrid`, `ProductSlider`, `ProductCard`,
  `CategoryList` and `CategoryGrid` on a CMS page keep fetching in the browser, as before, until
  the storefront resolves their data on the server. One written by the `0.105.0` CLI does: take
  `components/CatalogBlockData.tsx` and `lib/page-builder/catalog-block-data.ts` from it, take its
  `components/CmsPageRenderer.tsx` and `components/Hook.tsx`, and pass `ctx` to `CmsPageRenderer`
  in `app/page.tsx` and `app/(content)/[...slug]/page.tsx` — the prop is required there. Create a
  storefront to copy from the way
  [Module blocks in an existing storefront](#storefront-block-renderers) does.
- **Your own types.** `lib/api/rfq.ts` declares `createdByAdminUserId`, `assignedAdminUserId` and
  `actorAdminUserId`, which customer replies no longer carry; the reference storefront read none
  of them. If code of yours reads them, or `placedOnBehalfByAdminUserId` on an order, it now
  reads `undefined`.

A storefront written by the `0.105.0` CLI also credits the platform in its footer; an existing
one does not gain the line.

How far this has been exercised: an instance created by the `0.104.0` installer with its demo
data — API, admin and storefront — was upgraded with `pnpm run upgrade 0.105.0` under pnpm 9,
against the packages of the release served from a local registry, and the command ran to the end.
What was observed on it:

- exactly two migrations applied, the custom-field audience and the CRM message read markers;
  health and the badge in the Admin UI report `0.105.0`;
- five wrong administrator passwords answer `401` and the sixth
  `429 ADMIN_AUTHENTICATION_THROTTLED` with `Retry-After: 60`, cleared by the delay or by the
  `unlock` command; a request without a session and with an invalid body answers `401`;
- the methods created in the Admin UI before the upgrade are listed on the default channel only,
  the seeded ones on every channel, and a method assigned to another channel is listed there; the
  delivery method created in the Admin UI was marked *Not offered at checkout* and choosing an
  adapter repaired it;
- an order or a preview is refused for a method its channel does not offer, for a body naming
  another channel and for a method outside the Organization's allow-list, and after each refusal
  the basket and the number of orders were unchanged;
- with the storefront as `0.104.0` wrote it, the checkout of a non-default channel lists the
  default channel's methods and the order is recorded on the default channel; with the edits
  above — applied exactly as written to the seven source files and the two test files, every
  quoted string found — it lists that channel's methods and the order is recorded on that
  channel, and `tsc --noEmit`, the storefront's tests and `next build` pass;
- every custom-field definition that existed stays `customer` and its value is still in the
  buyer's order, and one created afterwards is `internal` and absent from it;
- a CRM Opportunity from before the upgrade shows no unread count for anybody, and a message
  written afterwards is unread for the other administrator only;
- a webhook subscription from before the upgrade loads, and an unknown event type answers `422`.

Not exercised: an instance older than `0.104.0`, one with overlay modules, and a module that
still calls `bindToDefaultChannel`; the proxy variables, the account-wide limit and
`ADMIN_AUTH_ACCOUNT_WIDE_LIMIT`, the limit on second-factor codes, and sessions ended by a
credential change; the quote-request expiry sweep; one-click buy, the preferences page and
ordering again as a quote request, at runtime; the admin order-creation form and the API-key order
intake; `demo reset`; a delivered webhook; the push and catalogue-block edits in a storefront, the
`compose.prod.yml` line and the `.gitignore` lines for `backend/var/`; and restoring the backup.
What this section says about those is what the release's changelogs state, read against the
source of the release.

### After upgrading to 0.106.0 {#after-0-106-0}

`pnpm run upgrade 0.106.0` moves the 73 packages of the release from `0.105.0` and applies its one
migration, which adds a column to `settings` and rewrites no row; the instance starts afterwards
with none of its files edited, and the release adds no environment variable and no permission.
What it adds is on the SEO tab of **Settings**: a sales channel's storefront can be taken out of
search engines, given rules of its own in `robots.txt`, and given an `llms.txt` — and none of the
three reaches a storefront created by an earlier release until that storefront's files are
updated. This section says what to do, in order, and then what behaves differently for each
reader: [operators](#after-0-106-0-operators),
[API clients and integrators](#after-0-106-0-api),
[module and overlay authors](#after-0-106-0-authors) and the owner of
[an existing storefront](#after-0-106-0-storefront).

#### What to do, in order {#after-0-106-0-steps}

Before the upgrade: nothing beyond [Before you start](#before-you-start). The migration,
`Migration20261011T135250CoreSettingsMultiline`, adds `settings.multiline boolean not null default
false`, needs no backfill, and changes no setting's value or meaning. Take it back only together
with the packages: this release's code expects the column, so reverting the migration on its own
leaves an instance that fails at boot, while reverting it as part of downgrading
`@endora-commerce/platform` and `@endora-commerce/mod-settings` loses nothing but the flag.

After the upgrade, before the instance takes traffic again:

1. **Decide whether the storefront takes the release's files.** The three new settings on the SEO
   tab — *Default robots*, *Custom robots.txt instructions* and *Additional llms.txt content* —
   appear on every upgraded instance, and a storefront created by an earlier release acts on none
   of them: a channel set to `NOINDEX` stays indexable, `robots.txt` stays the file the storefront
   was built with, and nothing serves `llms.txt`. The *Default robots* row and the two previews say
   so while that is the case. The edits are under
   [In an existing storefront](#after-0-106-0-storefront); until they are made, do not rely on the
   settings.
2. **On a storefront that serves more than one sales channel behind a reverse proxy or a CDN**,
   make the proxy set `X-Sales-Channel` itself, per host, and not pass on a value a visitor sent.
   Once the storefront is updated, `robots.txt` and `llms.txt` differ per channel, and the channel
   is the one that header names. In nginx it is one line in the storefront's `location` block —
   `proxy_set_header X-Sales-Channel "<this host's channel code>";` for a multi-channel deployment,
   or `proxy_set_header X-Sales-Channel "";` to drop the header on a single-channel one, which is
   otherwise unaffected. The `nginx.example.conf` an instance was scaffolded with does not carry the
   line; the platform repository's `deploy/nginx.example.conf` shows both, commented. A shared
   cache that ignores `Vary` on that header must include it in its cache key or not cache
   `/robots.txt`.
3. **Set *Default robots* on each sales channel whose storefront should be out of search** —
   `NOINDEX, FOLLOW` or `NOINDEX, NOFOLLOW`, under **Settings → SEO** — and do not add
   `Disallow: /` to the custom `robots.txt` instructions on top of it: a crawler that may not fetch
   a page never reads its `noindex`. With the storefront updated,
   `curl -sI https://<your shop>/ | grep -i x-robots-tag` shows the header within a minute or two.
4. **Check that the storefront's `robots.txt` still serves what it should.** After the files under
   [In an existing storefront](#after-0-106-0-storefront) are applied, the build's route list must
   show `ƒ /robots.txt` and not `○ /robots.txt`, and
   `curl -sI https://<your shop>/robots.txt | grep -i x-endora-crawler-files` must print the header.
   If the route list still shows `○`, `app/robots.ts` was not deleted and the old build-time file
   is still winning — silently. If you had edited the `disallow` list in `app/robots.ts`, the same
   lines must now be in `ROBOTS_SYSTEM_RULES` in `lib/seo/robots-system-rules.ts`.

Whenever it suits you:

5. If you maintain the `cms.reserved_slug_segments` setting, add `robots.txt` and `llms.txt` to it,
   as the storefront edits add them to `RESERVED_TOP_LEVEL_SEGMENTS` in `app/reserved-segments.ts`.
6. **Rebuild your own modules against this release only if** a test of yours constructs a
   `SettingWriteValidationInput` or renders `SettingRowEditor` or `SettingsPage` on its own —
   [For module and overlay authors](#after-0-106-0-authors) says what each needs. A module that
   only contributes a `SettingWriteValidator`, or only declares settings, needs no change.

#### For operators {#after-0-106-0-operators}

**A sales channel's storefront can be taken out of search engines with one setting: Settings → SEO
→ Default robots.** It offers `INDEX, FOLLOW` (the default), `NOINDEX, FOLLOW`, `INDEX, NOFOLLOW`
and `NOINDEX, NOFOLLOW`, for all sales channels or per channel. For a channel whose value restricts
something, an updated storefront adds the directive to what it serves for that channel: an
`X-Robots-Tag` header on pages (not-found pages and the offline page included), on `/sitemap.xml`,
on `/_next/image` and on the files under `public/`, and one extra `<meta name="robots">` in the
`<head>` of the pages it renders for a request. Not-found pages and the statically built
`/offline` page carry the header without the extra element — both already declare
`noindex, nofollow` themselves — and redirects declared in `next.config.js` and the files under
`/_next/static` carry neither. It only adds restrictions: a page that declares `noindex` for
itself keeps its own tag, and `robots.txt` is not changed. With the default nothing is added. A
saved change is in force on the storefront within a minute or two. Two limits: files the backend
serves (product images and other uploaded media) carry no `X-Robots-Tag`, and a storefront that
starts while its backend is unreachable serves pages without the directive until its first
successful read. The setting is also reachable from the command palette, as *Search engine
robots*, for a holder of `settings:read`. See
[Search engine robots](./modules/seo.md#search-engine-robots).

**Rules can be added to a sales channel's `robots.txt`: Settings → SEO → Custom robots.txt
instructions.** The text is appended to the rules the storefront generates itself — after them,
separated by one blank line — for all sales channels or per channel. The generated rules (the
closed address families and the `Sitemap:` line) are unchanged and cannot be edited or removed
from the Settings screen. With no text, `robots.txt` is byte for byte what it was; resetting the
setting removes the text; a saved change is served within about two minutes.

- The text is served as written: every character is kept, in order, and nothing in it is
  validated. Two things about line breaks are made uniform — every line break is served as a line
  feed (`LF`), whether it was saved as `LF`, `CRLF` or `CR`, and the file ends with exactly one —
  and one byte order mark (`U+FEFF`) at the very start of the text is not served, because a crawler
  does not recognise the line it is attached to.
- The generated lines cannot be changed, but their effect on one crawler can: a group written for a
  crawler by name replaces the `*` group for that crawler. Repeat the generated rules in such a
  group if they should still apply to it. Indexing does not depend on it — the pages those rules
  close declare `noindex` themselves.
- A text may be at most **64 KiB** (65 536 bytes of UTF-8). A larger one is refused when saved,
  with `400 SEO_CRAWLER_TEXT_TOO_LARGE` and a message naming the limit, and the stored text is
  kept.
- **`robots.txt` does not take pages out of search results.** It controls what a crawler may fetch.
  To keep a storefront out of search use *Default robots* = `NOINDEX`, and do not add `Disallow: /`
  on top of it. The setting's description says so, in English and in Polish.

See [Custom `robots.txt` instructions](./modules/seo.md#custom-robotstxt-instructions).

**Below the field there is a preview of the file the selected channel's storefront serves**, as
one block that is the file: the lines the storefront generates, labelled read-only, then a blank
line, then your own lines, marked with a bar and a label. With nothing unsaved the heading reads
*robots.txt as served now*; as you type, the block follows the field and the heading becomes
*robots.txt after saving* — the file the storefront will serve once you save; until then it keeps
serving the previous version. Under **All channels** you pick the channel to preview, and the
preview names the channels that have a value of their own and are therefore not affected. On a
channel whose *Default robots* is `NOINDEX` it says that `robots.txt` stays open on purpose, and it
warns when your text forbids every crawler to fetch anything. An administrator who may read
settings but not change them sees it too, and one who may not list sales channels is shown the
system default channel. Nothing the storefront serves changes when you preview.

The generated rules are not copied into the backend or the Admin UI: each time, the backend asks
the channel's storefront for them. So **the storefront must be reachable from the backend at the
address the channel is configured with** — the channel's **Storefront URL** setting, else
`STOREFRONT_BASE_URL`. When it is not, the preview says so and shows your text on its own; saving
is never blocked. The three messages and what to do about each:

- *The storefront could not be reached* — no answer within three seconds, a refused connection,
  an error, a redirect, or an answer that is not a plain-text file. Check that the storefront runs
  and that the configured address is the one it answers at itself. The server log line
  `seo: the crawler-file preview could not show the storefront’s part` carries the reason.
- *This sales channel has no storefront address configured* — set **Storefront URL** for the
  channel, or `STOREFRONT_BASE_URL`.
- *This storefront did not confirm that it supports custom instructions* — it answered without the
  `X-Endora-Crawler-Files` header. Usually the storefront was created by a release before these
  settings existed: it serves only its generated rules and ignores both the custom instructions
  and *Default robots*. A proxy that strips the header, or a storefront updated only in part, looks
  the same. A matching notice appears on the *Default robots* row, so a shop is not believed to be
  out of search while its storefront may be ignoring the setting. Apply the edits under
  [In an existing storefront](#after-0-106-0-storefront), and check that the header arrives.

What the backend sends is one request per preview: `GET <origin>/robots.txt?part=system`, to the
origin of the configured address only, with the channel's code in `X-Sales-Channel`. It follows no
redirect, waits at most three seconds, reads at most 512 KiB, accepts only `text/plain`, sends no
cookie or credentials, and stores nothing. A path or query in the configured address is not used.
Private and loopback addresses are **not** refused, because an instance's own storefront is
routinely reached at one; who may point a channel at an address is whoever holds `settings:write`,
as before.

**The storefront serves an `llms.txt` per sales channel, and you can add to it: Settings → SEO →
Additional llms.txt content.** `/llms.txt` is a plain-text file that tells AI assistants what a
shop is and where its public pages are. An updated storefront serves one for each sales channel: a
part it generates — the shop's name, links to the home page, the catalog, search, the blog and the
contact page, and the sitemap — followed by the text you save in the setting. The setting is empty
by default, takes a value for all sales channels and a value per channel like any other, and holds
at most 64 KiB, the limit of the `robots.txt` instructions. A saved change is served within about
two minutes. The addresses in the generated part use the storefront's one public origin
(`NEXT_PUBLIC_SITE_URL`, fixed when the storefront is built), as the sitemap does: a storefront
that serves several sales channels names that origin in every channel's file, with each channel's
own shop name. Two things to know before relying on it:

- **A sales channel whose *Default robots* is `NOINDEX` has no `llms.txt`.** The storefront answers
  `/llms.txt` with "not found" there, whatever the setting holds: a shop that asks search engines
  to stay away does not invite AI assistants in. The text is kept and is served again when the
  channel allows indexing. `robots.txt` is unaffected — it stays open on such a channel, as before.
- **Switching the `seo` module off withdraws the file**, with the *Default robots* policy and the
  custom `robots.txt` instructions (below).

Below the field there is a preview, the same as the one beside *Custom robots.txt instructions*:
one block that is the file, your lines marked inside it, under a heading that reads *llms.txt as
served now* or *llms.txt after saving*. On a `NOINDEX` channel it says *llms.txt is not served*,
with the reason, in place of the block. The messages for a storefront that cannot be reached, has
no address configured or did not confirm that it serves the file are the ones the `robots.txt`
preview shows, and the request the backend makes for it is bound the same way — one
`GET <origin>/llms.txt?part=base`, no redirect followed, three seconds, 512 KiB, `text/plain` only,
nothing of the administrator's request in it. As before, private and loopback addresses are not
refused, and this preview tells a holder of `settings:read` slightly more about a configured
address than the `robots.txt` one does: a `404` without the storefront's header is reported as
"did not confirm that it serves llms.txt" rather than as "could not be reached", so an address
where some HTTP server answers can be told from one where nothing does. See
[Additional `llms.txt` content](./modules/seo.md#additional-llmstxt-content).

**Switching the `seo` module off withdraws all three.** The storefront sends no default robots
directive, so a channel set to `NOINDEX` becomes indexable again until the module is switched back
on; `robots.txt` is served with the generated rules alone; and `llms.txt` is not served. The
stored values are kept and apply again when the module is switched on. The module's description
and its activation setting on `/platform/modules` say so. See
[When the module is switched off](./modules/seo.md#when-the-module-is-switched-off).

**`robots.txt` no longer depends on *Default robots* being readable.** A *Default robots* value
that is not one of the four choices — which takes a row written around the settings API — made
`GET /api/v1/storefront/seo/crawler-files` answer `500`, so a storefront that had just started
answered that channel's `robots.txt` with `503`, although the file has never depended on that
setting. The endpoint now answers, and names what it could not read. Such a channel keeps its
`robots.txt`; its `llms.txt`, which does depend on the setting, answers `503` until the value is
repaired by saving *Default robots* again. A storefront that has not been updated benefits too:
its `robots.txt` is served as well.

**The audit trail of a setting-value change records the value before the change.** Until now
`setting.global_value_set` and `setting.value_set` carried `stateAfter` only, and the two resets
(`setting.global_value_reset`, `setting.value_reset`) recorded that a value was removed without
recording which. Each of the four now also carries `stateBefore`:

```json
{ "settingCode": "your_module.base_url", "value": "https://old.example", "valueType": "string", "stored": true }
```

plus `salesChannelId` on the two per-channel actions. The audit log viewer already renders
`stateBefore` beside `stateAfter`, so the previous value appears there with no further change.
`value` is the value **stored** at the level being written — the all-channels value for an
all-channels write or reset, that channel's own value for a per-channel one — and not the value
the channel resolved to: a first write records `"value": null, "stored": false`, not the manifest
default and not an inherited all-channels value. `stored` is what separates "nothing was stored"
from a stored `null`, which a `json` setting may legitimately hold. A `secret` setting's previous
value is recorded as `"[redacted]"`, exactly as its new value already was — neither the plaintext
nor the stored ciphertext reaches the audit trail — and a `credential_ref` records the
configuration code on both sides, as before. Nothing about the write itself changes, a refused
write still records nothing, and entries written before this release keep an empty before-state.

**The Settings screen can show a setting's name and description in the administrator's language.**
It used to show the `name` and `description` a settings manifest declares, in English, whatever
language the administrator works in. It now looks in the owning module's own translation bundle
first and falls back to the declared string when a key is absent; the filter on the screen
matches the translated name and description as well as the declared ones, and the choices of an
`enumOptions` setting are stored values and stay untranslated. **Nothing changes for an operator
until a module ships these keys.** The release adds the lookup only, and no setting that existed
before it is translated by it; the one module that ships the keys in this release is `seo`, for
its group and its four settings (*SEO enabled*, *Default robots*, *Custom robots.txt
instructions*, *Additional llms.txt content*), in English and Polish. A module of your own adds
them as [For module and overlay authors](#after-0-106-0-authors) describes.

**A setting can be multi-line.** A `string` setting whose module declares it so is edited on the
Settings screen in a multi-line field that keeps line breaks, blank lines, indentation and a
trailing line break exactly; the field is named after the setting for assistive technology, and
the line under it that previews the default and current value shows one shortened line rather than
the whole text. In this release the two SEO texts are such settings. Every setting that existed
before stays single-line, so the Settings screen looks and behaves exactly as it did until a module
you install declares the flag.

#### For API clients and integrators {#after-0-106-0-api}

- **Two public, channel-resolved storefront endpoints.** `GET /api/v1/storefront/seo/robots-policy`
  answers `{ "data": { "index", "follow" } }`, with `Cache-Control: no-store`; `503 MODULE_DISABLED`
  while the `seo` module is off; and `500` — never a permissive answer — when the stored value is
  not one of the four choices. `GET /api/v1/storefront/seo/crawler-files` answers
  `{ "data": { "index", "follow", "robotsTxtCustom", "llmsTxtAdditional", "shop": { "name" } } }`,
  with `Cache-Control: no-store`, `503 MODULE_DISABLED` while the module is off, and `500` — never
  an empty text — when the stored `robots.txt` instructions cannot be served. Its `data` has an
  optional member **`unreadable`**: the names of the members the backend could not read from what
  is stored — `'policy'` (`index` and `follow` are then both `false` and mean "not known") and
  `'llmsTxtAdditional'` (that member is then `''` and means "not known"). It is absent when
  everything was read, and a consumer that reads `index`, `follow` or `llmsTxtAdditional` from this
  endpoint should treat a named member as unknown rather than as its value. Both schemas drop
  members they do not know, so a later release can add one without an older consumer refusing the
  answer. The sales channel is the request's resolved channel, as on every storefront route.
- **A preview endpoint for administrators.**
  `GET /api/v1/admin/seo/crawler-files/preview?file=robots|llms&salesChannelCode=<code>`, gated by
  `settings:read`. `salesChannelCode` is optional and means the system default channel; the answer
  names the channel it is about and one of five states: `ok`, `storefront-outdated` (the storefront
  answered without the `X-Endora-Crawler-Files` header; no `base`), `not-served` (a `404` **with**
  the header — no file for that channel, which `llms.txt` on a `NOINDEX` channel is),
  `storefront-unreachable` and `address-unknown`.
- **Saving an over-long crawler text answers `400 SEO_CRAWLER_TEXT_TOO_LARGE`**, with a message
  naming the limit of 65 536 bytes of UTF-8; the stored text is kept.
- **`SettingDto` gains `multiline: boolean`**, which `GET /api/v1/admin/settings` and
  `GET /api/v1/admin/settings/:code` now always send. Read it if you render your own editor for a
  setting.
- **Four audit actions gain `stateBefore`** — `setting.global_value_set`, `setting.value_set`,
  `setting.global_value_reset` and `setting.value_reset` — in the shape given under
  [For operators](#after-0-106-0-operators). `stateAfter` keeps its shape.
- **The detail of a newsletter automation** — `GET /api/v1/admin/newsletter/automations/:id`,
  and the answer of every write that returns the detail — carries `salesChannelId: null` for an
  automation with no sales channel assigned, including after the record was reloaded from the
  database; the member was missing from it. The list, which never carried the member, is
  unchanged.
- **New in `@endora-commerce/contracts`**, all exported from the package root and from the `seo`
  subpath: `storefrontRobotsPolicySchema`, `storefrontRobotsPolicyResponseSchema` and the types
  `StorefrontRobotsPolicy` and `StorefrontRobotsPolicyResponse`; `storefrontCrawlerFilesSchema`,
  `storefrontCrawlerFilesResponseSchema`, the types `StorefrontCrawlerFiles` and
  `StorefrontCrawlerFilesResponse`, `CRAWLER_FILES_UNREADABLE_POLICY` and
  `CRAWLER_FILES_UNREADABLE_LLMS_TXT`; `composeCrawlerFile(base, extra)` — the join of a
  generated part and an operator's text described above, which the storefront serves with and the
  preview renders with; `CRAWLER_TEXT_MAX_BYTES` and `ERROR_CODES.SEO_CRAWLER_TEXT_TOO_LARGE`;
  `adminCrawlerFilePreviewQuerySchema`, `adminCrawlerFilePreviewResponseSchema`,
  `adminCrawlerFilePreviewSchema`, `adminCrawlerFilePreviewStateSchema`, `adminCrawlerFileSchema`
  and their inferred types; and `CRAWLER_FILES_CAPABILITY_HEADER` (`X-Endora-Crawler-Files`), the
  response header by which a storefront says it serves crawler files the current way.
- **`SettingWriteValidationInput` gains `proposedValue`** — the value a settings write proposes,
  beside the per-channel projection it already carried. An all-channels write reaches no channel
  that has a value of its own, so on an instance where every channel has one the proposed value
  was in no channel's projection, and a validator whose rule is about the value itself could not
  see it. Code that *constructs* the input must now supply the member; see
  [For module and overlay authors](#after-0-106-0-authors).

#### For module and overlay authors {#after-0-106-0-authors}

**A `string` setting can be declared multi-line.** Add `multiline: true` to its entry in the
module's settings manifest:

```ts
defineModuleSettingsManifest({
  moduleCode: 'your_module',
  settings: [
    {
      code: 'your_module.footer_note',
      name: 'Footer note',
      valueType: 'string',
      defaultValue: '',
      multiline: true,
    },
  ],
});
```

Nothing else changes: the value is still a `string`, is read through `SettingsService.get` as
before, and resolves per sales channel like every other setting. What is typed is what is stored.
`SettingManifestEntrySchema` accepts `multiline` only on `valueType: 'string'` and not together
with `enumOptions`; any other combination fails when the manifest is parsed, with the issue on
`multiline`. The flag is presentation, kept in step with the manifest by `ManifestReconciler` on
every boot in both directions, so adding or removing it later is not a breaking change and never
touches a stored value.

**A module can contribute below a setting it declared: the `settings.setting.after` zone.**
`AdminZoneNameSchema` has the new member, mounted by the Settings screen once per setting row,
below the field. Contribute to it to show what a setting amounts to — a preview, a consequence, a
warning:

```ts
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

export const contributions: AdminContributions = {
  zones: [
    zoneComponent('settings.setting.after', () => import('./zones/FooterNotePreview.js'), {
      match: { settingCode: 'your_module.footer_note' },
      requiredPermission: 'settings:read',
    }),
  ],
};
```

The component receives `SettingsSettingAfterZoneProps`: `settingCode`, `ownerModule`,
`channelCode` (the sales channel being edited, or `null` for the all-channels value), `draftText`
(the text in the field **now**, saved or not, for a `string` setting; `null` for every other value
type) and `dirty`. Narrow with `match` on `settingCode` or `ownerModule` — an unmatched
contribution's chunk is never fetched. The props go one way: a contribution cannot change the
value or hold up the row's save, and it should say in words when what it shows is not saved yet.
The zone is not mounted for a `secret` setting, so a contribution never receives a secret's draft.
A contribution vanishes with its module, and a failing one does not take the row with it. The two
SEO previews are contributions to this zone.

**If you render `SettingRowEditor` yourself.** `@endora-commerce/mod-settings`' row editor now
mounts a zone, so it must be rendered under `AdminContributionsProvider` and the session providers,
as every host screen that mounts a zone is. The Admin UI already does; a test that renders the row
or `SettingsPage` on its own needs the providers around it.

**A module can translate the names and descriptions of its own settings.** The Settings screen
looks in the owning module's bundle under three key families and falls back to the declared string
when a key is absent:

| Key | Replaces |
| --- | --- |
| `settingLabels.<setting code>.name` | the setting's `name` |
| `settingLabels.<setting code>.description` | the setting's `description` |
| `settingGroups.<group code>.name` | the group's `name` |

The code is written whole, dots included, and the keys are flat like every other key in a bundle.
For a module `your_module` that declares the setting `your_module.base_url` in the group
`your_section`, add to `i18n/pl.json` (and the English wording to `i18n/en.json`):

```json
{
  "settingGroups.your_section.name": "Twoja sekcja",
  "settingLabels.your_module.base_url.name": "Bazowy adres URL",
  "settingLabels.your_module.base_url.description": "Adres, pod którym usługa jest dostępna."
}
```

Resolution is per key — the administrator's language, then English, then the manifest string — so
settings can be translated one at a time. Only the bundle of the module whose settings manifest
declared the row is read (its `moduleCode`, which has to equal the module `id`); a key for another
module's setting is ignored. The text is shown as written, with no parameter substitution. The
manifest `name` and `description` stay required: they are what the API returns and the last
fallback.

**Code that constructs a `SettingWriteValidationInput` must supply `proposedValue`** — a test
calling a validator directly, typically. A module that contributes a `SettingWriteValidator` needs
no change, and one whose rule is about the value itself can now read it there.

**`check:channel-resolution` no longer reports a header that is sent.** The rule's first signal
flags every `x-sales-channel` string literal, because a module must not read that header from a
request — the resolver does. A module that makes a request of its own to another server and names
the sales channel in it was reported as well. The key of an object literal under a `headers:`
property — `fetch(url, { headers: { 'X-Sales-Channel': channel.code } })` — is now exempt, as a
CORS policy's `allowedHeaders` array already was. What stays reported: an element access on a
headers object, a `.get(...)` argument, the name held in a constant, a computed key, a
destructuring declaration, and a destructuring *assignment*
(`({ headers: { 'x-sales-channel': code } } = request)`, also as the variable of a `for…of` or
`for…in`), which has the exempted shape and is refused by its position.

**`@endora-commerce/mod-seo` declares `lucide-react` as an optional peer dependency**, as the other
module packages with an admin surface do; an application that has the Admin UI already has it.

#### In an existing storefront {#after-0-106-0-storefront}

**An existing storefront is not changed by upgrading, and until it is updated it ignores all three
settings.** `endora new storefront` copies the reference once and the project owns it afterwards.
With an upgraded backend and an older storefront the Settings screen shows the three settings and
nothing acts on them: a channel set to `NOINDEX` stays indexable, `robots.txt` stays the file the
storefront was built with, and nothing serves `llms.txt`. To take the features, apply the changes
below from the reference storefront to the storefront project, keeping any edits of your own.
Create a storefront to copy from the way
[Module blocks in an existing storefront](#storefront-block-renderers) does. The three groups
build on one another and **must be applied in this order**; each may be taken without the ones
after it.

**1. *Default robots* — four files, no dependency upgrade.** They import nothing from a package
that an earlier storefront does not already have, so nothing has to be upgraded for them to build
and run:

- `lib/seo/crawler-policy.ts` — new: reads the policy, caches it for a minute per channel, and
  keeps the last value it read while the backend cannot be reached;
- `lib/seo/robots-directive.ts` — new: what the policy puts on a response;
- `middleware.ts` — changed: the policy read, the response header, the request header for the
  layout, and the widened `config.matcher`. The middleware now runs for every path except
  `/_next/static` (it used to skip public files, `/sitemap.xml`, `/robots.txt`,
  `/manifest.webmanifest` and `/_next/image`); for those paths it only adds the header. Measured on
  the reference storefront, that costs a public file about one millisecond. A storefront that
  already knows a channel's policy never waits more than a fraction of a second for a refresh;
  only the first read after a start is waited for, up to two seconds, once;
- `app/layout.tsx` — changed: renders the extra `<meta name="robots">` in both documents it
  returns. Do not move the directive into the layout's `metadata` export: a page's own `robots`
  replaces a layout's there, so it would be dropped on every page that declares one.

Then rebuild the storefront. `curl -sI https://<your shop>/ | grep -i x-robots-tag` shows the
header once a restricting value is saved. The reference storefront's tests for these files
(`test/seo/crawler-policy.test.ts`, `robots-directive.test.ts`, `middleware-robots.test.ts`,
`middleware-effect.test.ts`, `layout-robots.test.ts`, `layout-outage-render.test.tsx` and
`test/conformance/robots-directive.spec.ts`) are optional to copy; one of them,
`crawler-policy.test.ts`, compares the storefront's own check of the answer with the published
schema and therefore needs `@endora-commerce/contracts` at this release or later in the storefront
project; nothing else in this group does.

**2. Custom `robots.txt` instructions — `robots.txt` becomes a route, and the project needs
`@endora-commerce/contracts` at `0.106.0` or later.** `lib/seo/robots-txt.ts` imports
`composeCrawlerFile` from `@endora-commerce/contracts/seo`, which the four files above did not need.
`middleware.ts` and `app/layout.tsx` do not change in this group:

- **delete** `app/robots.ts`. It must go, and nothing will tell you if it has not: with both it and
  `app/robots.txt/route.ts` present, Next builds without a warning, goes on serving the old
  build-time file and never reaches the new route. The build's route list shows which one won —
  `○ /robots.txt` is the old file, `ƒ /robots.txt` is the new route;
- **add** `app/robots.txt/route.ts` — the route;
- **add** `lib/seo/robots-txt.ts` — what the route answers, and when it answers `503`;
- **add** `lib/seo/robots-system-rules.ts` — the generated rules, moved out of `app/robots.ts`
  unchanged. **If you edited the `disallow` list in your `app/robots.ts`, carry your edits into
  `ROBOTS_SYSTEM_RULES` here**;
- **replace** `lib/seo/crawler-policy.ts` with the new version. It now reads the crawler files as
  well as the default robots policy, and gives up a backend read that a frozen process left
  hanging instead of waiting on it for ever;
- **edit** `app/reserved-segments.ts`: add `'robots.txt'` to `RESERVED_TOP_LEVEL_SEGMENTS`, and add
  the same entry to the deployment's `cms.reserved_slug_segments` setting if you maintain one;
- in `test/seo/route-declarations.test.ts`, if you copied it, replace the import of
  `'../../app/robots'` with `ROBOTS_SYSTEM_RULES` and `robotsSitemapUrl` from
  `'../../lib/seo/robots-system-rules'`, as the reference's version does.

Then rebuild the storefront; `curl -sI https://<your shop>/robots.txt | grep -i x-endora-crawler-files`
shows the header once the new route is serving. What the route answers:

- `200` with the generated rules and the channel's text; `Content-Type: text/plain; charset=utf-8`,
  `Cache-Control: public, max-age=60`, `Vary: X-Sales-Channel`, `X-Endora-Crawler-Files: 1`. Before,
  the file was prerendered and sent with `Cache-Control: public, max-age=0, must-revalidate` and
  `Content-Type: text/plain`;
- the generated rules alone while the `seo` module is switched off, and against a backend that
  does not have this feature;
- **`503` with `Retry-After: 120`** when the channel's text cannot be read and the storefront
  process has never read it — rather than a file that silently omits the operator's rules. A
  process that has read the text once goes on serving that version for as long as the backend
  cannot be reached. A storefront started while its backend is down therefore answers
  `robots.txt` with `503` until the backend is back; pages are unaffected;
- `GET /robots.txt?part=system` answers the generated rules alone, without the route asking the
  backend, and is sent with `Cache-Control: no-store`.

The origin in the `Sitemap:` line is still `NEXT_PUBLIC_SITE_URL` as inlined at build time. The
reference storefront's tests for these files (`test/seo/robots-system-rules.test.ts` with its
fixture `test/seo/__fixtures__/robots-before.txt`, `test/seo/robots-txt-route.test.ts` and the
additions to `test/seo/crawler-policy.test.ts`) are optional to copy. The fixture is the
reference's own generated rules with `http://localhost:3000` as the origin; a project that edited
its list edits the fixture to match.

**3. `llms.txt` — assumes groups 1 and 2 are in place**: `lib/seo/crawler-policy.ts`,
`lib/seo/robots-txt.ts`, `lib/seo/robots-system-rules.ts`, `lib/seo/robots-directive.ts` and
`app/robots.txt/route.ts` exist, and `app/robots.ts` is deleted. `middleware.ts` and
`app/layout.tsx` do not change in this group either:

- **add** `app/llms.txt/route.ts` — the route;
- **add** `lib/seo/llms-txt.ts` — what the route answers, and when it answers `404` and `503`;
- **add** `lib/seo/llms-txt-base.ts` — the generated part. It lists `SITEMAP_STATIC_ROUTES` from
  your `app/sitemap.ts`; **if you changed that list, give each of your routes a title in
  `LLMS_TXT_PAGE_TITLES`**, and name in `LLMS_TXT_CONDITIONAL_PAGES` any of them that can answer
  "not found";
- **add** `lib/seo/llms-txt-pages.ts` — whether a conditional page is served right now (today:
  the blog), remembered per channel by the cache `lib/seo/crawler-policy.ts` exports;
- **add** `lib/seo/crawler-file-response.ts` — the headers and the temporary failure the two files
  share;
- **replace** `lib/seo/robots-txt.ts` and `lib/seo/crawler-policy.ts` with the new versions. The
  first now takes its headers from `crawler-file-response.ts`; the second reads `unreadable` and
  exports the channel cache the page question uses;
- **edit** `lib/seo/robots-directive.ts`: `isDocumentPath` must answer `false` for `/llms.txt`, as
  the reference's version does. **Do not skip this one**: without it the storefront still serves
  the file, but while the backend is unreachable it answers `/llms.txt` with the outage page
  instead of the last version it knew;
- **edit** `app/reserved-segments.ts`: add `'llms.txt'` to `RESERVED_TOP_LEVEL_SEGMENTS`, and add
  the same entry to the deployment's `cms.reserved_slug_segments` setting if you maintain one;
- **make sure there is no `public/llms.txt`.** A file there is served instead of the route — for
  every channel, with no operator text, and on a channel set to `NOINDEX` — and neither the build
  nor the server says so. `curl -sI https://<your shop>/llms.txt | grep -i x-endora-crawler-files`
  shows the header when the route is the one answering.

Then rebuild the storefront — the build's route list shows `ƒ /llms.txt`. The reference
storefront's tests for these files (`test/seo/llms-txt-base.test.ts`,
`test/seo/llms-txt-route.test.ts`, and the additions to `test/seo/crawler-policy.test.ts`,
`test/seo/robots-txt-route.test.ts`, `test/seo/middleware-robots.test.ts` and
`test/seo/middleware-effect.test.ts`) are optional to copy.

**The footer credit.** A storefront written by the `0.106.0` CLI shows its "Built with ❤️ using
Endora Commerce" credit as the last line of the footer — a row of its own under everything else
the footer renders (the columns, the copyright row and whatever a module adds through the
`footer.bottom` and `footer.copyright` hooks), centred, on one line while the width allows it,
with the Endora Commerce mark beside the product name — where it used to sit inside the copyright
row, between the company details and the legal links. The link and its UTM parameters are
unchanged. An existing storefront is not changed; to take this layout, apply the same edit to
`components/Footer.tsx` in the storefront project.

**A custom storefront** that is not derived from the reference serves the files on the same
terms: `GET /robots.txt?part=system` answers its generated rules alone and
`GET /llms.txt?part=base` the generated part of `llms.txt`, both as `text/plain` with
`X-Endora-Crawler-Files: 1`, and a channel with no `llms.txt` answers `404` with the same header;
without the header the preview treats the storefront as outdated. It answers `503` rather than a
file while `unreadable` in `GET /api/v1/storefront/seo/crawler-files` names `policy` or
`llmsTxtAdditional`. See
[For a custom storefront](./modules/seo.md#for-a-custom-storefront).

How far this has been exercised: what this section says is what the release's changelogs state,
read against the source of the release — the `seo` module's routes and settings manifest, the
platform migration, the contracts, the reference storefront's files and the nginx example. No
instance had been upgraded from `0.105.0` with `pnpm run upgrade 0.106.0`, and no storefront
created by an earlier release had the three groups of files above applied to it, when this
section was written; the order of the steps, the proxy line and the storefront edits are untried.

### After upgrading to 0.107.0 {#after-0-107-0}

`pnpm run upgrade 0.107.0` moves the packages of the release from `0.106.0` and applies its
migrations — fifteen, one of them the new document templates module's. The release brings three
packages that did not exist before —
`@endora-commerce/mod-document-templates`, `@endora-commerce/mod-admin-search` and
`@endora-commerce/llm-client` — and **one of them is not optional**: an instance that declares
`@endora-commerce/mod-invoices` needs `@endora-commerce/mod-document-templates` as well, and the
upgrade's `setup` step declares and installs it. It adds no environment variable. It adds five
permissions (`platform.api_description.read`, `document_templates:read`,
`document_templates:write`, `admin_search:configure` and `cms.translate`), and it moves the
permissions of import and export onto the modules that own the rows.

What the release changes most is who may use a sales channel. Every channel now has an *Open to
anonymous visitors* switch, which is on after the upgrade, and a signed-in customer is served on a
channel only when the customer's Organization is assigned to it. A data migration makes those
assignments for the Organizations that exist, so nothing changes for a customer who has ordered
where they shop — but the assignments are worth reading before the instance takes traffic again.
Baskets belong to the channel they were filled on, order placement checks the prices of a basket,
the API description is no longer public, and several screens and answers change. This section
says what to do, in order, and then what behaves differently for each reader:
[operators](#after-0-107-0-operators), [API clients and integrators](#after-0-107-0-api),
[module and overlay authors](#after-0-107-0-authors) and the owner of
[an existing storefront](#after-0-107-0-storefront).

#### What to do, in order {#after-0-107-0-steps}

Before the upgrade:

1. **If you designed invoice templates, write down what they hold.** Invoice templates moved into
   the new *Document templates* module, and nothing is carried over:
   `Migration20261017T075839InvoicesDropInvoiceTemplates` drops the `invoice_templates` table, and
   invoice PDFs — downloads and e-mail attachments alike — use the invoice document type's built-in
   layout (the former generic template) until an operator sets an invoice template as the default
   in **Document templates**. Reverting the migration recreates an empty table, not its rows; a
   database backup is the only copy.
2. **Read `assets.soft_delete_retention_days`** — *Soft-delete retention before hard-delete
   (days)* in the *Storage* group of **Settings**, 30 by default. From
   this release, assets moved to the trash are deleted for good by an hourly sweep once that many
   days have passed since their deletion, and **its first runs after the upgrade delete every asset
   that has been in the trash for longer than that**, up to 500 per run. Lengthen the setting
   before upgrading if you want to keep those assets. A value below one is read as one day.
3. **On an instance with more than one sales channel, read `quote_requests.expiry_days`** —
   *Auto-expire pending after (days)* on the Quote Requests tab of **Settings** — for each channel
   that has a value of its own. The expiry sweep now holds every quote request to the value of its
   own channel, where it used to apply the default channel's value to all of them: on its first
   runs a channel with a lower value than the default expires its backlog of requests that have
   been quiet that long, and a channel set to `0` stops expiring.

The upgrade itself:

4. **Run `pnpm run upgrade 0.107.0`.** `invoices` now lists `document_templates` among its
   manifest `dependencies`, and **if the instance declares `@endora-commerce/mod-invoices`** the
   upgrade's `setup` step adds `@endora-commerce/mod-document-templates` to the root
   `package.json`, at the version the platform is declared at, and installs it before anything
   else. Its first step, `endora generate`, comes from the release just installed, and it prints
   the line:

   ```text
   declared @endora-commerce/mod-document-templates 0.107.0 in package.json — invoices needs document_templates (dependencies)
   ```

   Commit the changed `package.json` and `pnpm-lock.yaml` with the rest of the upgrade. If the
   `setup` step did not finish, run `pnpm run setup` again: it continues from there. Only an
   instance whose `setup` was skipped, or that runs no `generate`, has to declare it by hand:

   ```bash
   pnpm add -w -E @endora-commerce/mod-document-templates@0.107.0
   pnpm run setup
   ```

   Without the module a deployment that composes `invoices` refuses to start, naming it:

   ```text
   This deployment will not boot: it composes modules whose declarations it does not satisfy.

     document_templates — not shipped by this deployment, and it is needed:
         invoices — dependencies
   ```

   The rest of [Adding a module that is new in a release](#adding-a-new-module) applies — the
   flags, and what to restart. *Document templates* comes up switched on, and it cannot be switched
   off while `invoices` is on. The other dependencies the release adds — `quote_requests` on
   `price_lists` and `transactional_emails`, `invoices` and `api_keys` on `admin_roles`,
   `assets_library` on `admin_users` — name modules that cannot be switched off and that every
   instance already declares, so they need nothing.

   The migrations `setup` applies, in the order of their stamps:

   | Migration | Module | What it does |
   | --- | --- | --- |
   | `Migration20261014T115049QuoteRequestsItemReferencePrice` | `quote_requests` | Three nullable columns on `quote_request_items` for the reference price |
   | `Migration20261014T115053QuoteRequestsNegotiationPolicies` | `quote_requests` | Two tables, `quote_request_org_policies` and `quote_request_account_policies` |
   | `Migration20261014T170531CatalogProductListSavedViews` | `catalog` | Table `product_list_saved_views` |
   | `Migration20261014T173236QuoteRequestsQuoteRequestListSavedViews` | `quote_requests` | Table `quote_request_list_saved_views` |
   | `Migration20261016T131148PriceListsPriceMatrixEntries` | `price_lists` | Table `price_list_matrix_entries` |
   | `Migration20261016T172243PwaPushNotificationPreferences` | `pwa` | Table `push_notification_preferences` |
   | `Migration20261017T071754DocumentTemplatesInit` | `document_templates` | Table `document_templates`, once the module is declared |
   | `Migration20261017T075839InvoicesDropInvoiceTemplates` | `invoices` | Drops `invoice_templates` — see step 1 |
   | `Migration20261017T142116QuoteRequestsQuoteRequestDocumentTemplate` | `quote_requests` | Nullable `quote_requests.document_template_id` |
   | `Migration20261017T142121QuoteRequestsQuoteRequestEventPdfSent` | `quote_requests` | Admits the `pdf-sent` event type |
   | `Migration20261018T074021CartsCartItemAgreedPrice` | `carts` | Three nullable `cart_items` columns for a quote's agreed quantity and price |
   | `Migration20261018T101912CoreSalesChannelsAnonymousAccess` | platform | `sales_channels.anonymous_access boolean not null default true` |
   | `Migration20261018T104644OrganizationsChannelAccessBackfill` | `organizations` | Assigns every Organization its sales channels — see step 7 |
   | `Migration20261018T141739AssetsLibraryAssetVersionsPermalinks` | `assets_library` | Eleven columns on `assets`, two tables for permalinks and storage clean-up |
   | `Migration20261019T043854CartsChannelBackfill` | `carts` | Records a basket with no channel on the system-default channel |

   An instance that declares `@endora-commerce/mod-admin-search` applies no migration for it: the
   module owns no table.

After the upgrade, before the instance takes traffic again:

5. **Re-grant import and export.** Each entity on the Import / Export screen now asks for the
   permission that guards the same rows in the module that owns them, where every entity used to ask
   for `catalog:write`:

   | Entity | Export | Import |
   | --- | --- | --- |
   | `products`, `categories` | `catalog:read` | `catalog:write` |
   | `stock` | `inventory:read` | `inventory:write` |
   | `customers` | `customers:read` | — |
   | `orders` | `orders:read` | — |

   A role that exported customers, orders or stock, or imported stock, on the strength of
   `catalog:write` needs `customers:read`, `orders:read`, `inventory:read` or `inventory:write`
   granted on **Admin roles** (`/admin-roles`). A role holding `catalog:read` can now export
   products and categories. The screen and its sidebar entry open for a role holding any of the
   codes in the table, and each entity card shows only the controls the role permits.
6. **Grant `platform.api_description.read` to whoever reads the API description.**
   `GET /api/v1/_openapi.json` and `GET /api/v1/_docs` answer only an administrator whose role
   holds the code, or an API key issued with it among its scopes; anybody else gets `401` (no
   administrator session or key) or `403` (a session or key without the code). The platform
   administrator's role holds every permission and needs nothing. A script or a build that fetches
   the document — a client generator, a contract test — needs an API key with the
   `platform.api_description.read` scope, issued by an administrator who holds the code, and sends
   it as it sends any key. In the Admin UI the document is on the new **System → API description**
   screen.
7. **Read the sales-channel assignments of your Organizations, and keep every channel open until
   the storefront is updated.** After the upgrade, every channel is open to anonymous visitors, as
   every channel was before, and a signed-in customer is served on a channel only when the
   customer's Organization is assigned to it. The migration
   `Migration20261018T104644OrganizationsChannelAccessBackfill` assigned each Organization the
   system-default channel and every channel it has at least one order on. On an instance with one
   sales channel that is everybody, and nothing changes. On an instance with more than one, **an
   Organization whose customers use another channel without having ordered there** — one that
   registered on a second store and has not ordered yet, or one that only sent quote requests there
   — is now refused on that channel at sign-in, with *"This account does not have access to this
   store."* Open each such Organization in the admin and tick the channel in its **Sales channels**
   panel. Then decide, per channel, whether it stays open to anonymous visitors —
   [Sales channels and who may use them](#after-0-107-0-channel-access) says what each choice does —
   but **switch *Open to anonymous visitors* off only once the storefront has the files under
   [In an existing storefront](#after-0-107-0-storefront)**, and on the system-default channel only
   once you know how the payment and carrier callbacks of modules from outside the release arrive.
8. **On a storefront that serves more than one sales channel through the `X-Sales-Channel` header**
   rather than `SALES_CHANNEL_HOST_MAP`, update the storefront before customers fill baskets again.
   A basket now belongs to the channel it is filled on, and a storefront created by an earlier
   release names the channel only on the backend calls that pass it explicitly; every other call is
   resolved by the backend itself — the host map, else the system-default channel. Until this
   release that made no difference to the basket, which lived on the default channel whatever store
   it was used on. From now on the default channel's basket and the store's basket are two baskets.
9. **Check who may hand out which permission.** An administrator now grants only permissions their
   own role holds — in a role, in an administrator account's role, in an API key's scopes — and a
   role the platform or a module seeds, `platform_admin` included, is changed only by a holder of
   the wildcard `*`. If a delegated administrator manages roles, users or API keys for others, give
   their role the permissions they hand out, or leave those changes to a holder of `*`.

Whenever it suits you:

10. **Decide about the quote push notifications.** On a shop with push notifications enabled, quote
    requests now send them: when an administrator creates a request for a customer, modifies,
    approves or cancels one, and when one expires. They never did, although the switch existed.
    Turn the category off with `pwa.push_quote_status_enabled` on the PWA screen if you do not want
    it.
11. **Install `@endora-commerce/mod-admin-search` if you want the command palette to find
    records** — orders, quote requests, opportunities, organizations, customers, products and
    categories. It is optional; without it the palette finds screens and actions as before. Declare
    it as [Adding a module that is new in a release](#adding-a-new-module) describes; it comes up
    switched on.
12. **Rebuild your own modules against this release.** Source that implements or constructs one of
    the ports and shapes listed under [For module and overlay authors](#after-0-107-0-authors) does
    not compile until it is changed, and a module that receives a provider's callback has a
    declaration to add.
13. **Update the storefront**, as [In an existing storefront](#after-0-107-0-storefront) describes.
    The checkout, the product page and the sign-in work as before without it; closed stores, the
    no-access screen, push choices, the price-negotiation lock and the comparison PDF's language do
    not.

#### For operators {#after-0-107-0-operators}

##### Sales channels and who may use them {#after-0-107-0-channel-access}

**Each sales channel has an *Open to anonymous visitors* switch**, on the channel form under
**Sales channels**. It is on for every existing channel and for a new one.

- **On** — anyone may browse the store; a signed-in customer may use it when their Organization is
  assigned to the channel.
- **Off** — the store serves signed-in customers only. An updated storefront takes a visitor who is
  not signed in to the sign-in page from every page, with a notice that the store is for signed-in
  business customers; nothing of the catalogue, the prices or the content is served to them, its
  sitemap is empty, its `robots.txt` disallows everything and names no sitemap, and its `llms.txt`
  names the store and says its content is for signed-in customers only. Business registration stays
  on the sign-in page, and an Organization registered there is assigned the channel — so with
  automatic moderation anyone who registers a business gets in, and with manual moderation nobody
  does until an operator approves the Organization. Individual (B2C) self-registration is not
  offered, and a federated sign-in (Google, Microsoft) creates no new account there. The list of
  channels marks a closed channel with a *Sign-in required* badge. Showing prices to anonymous
  visitors is a separate setting and only matters on an open store.

The backend applies the rule to every request outside `/api/v1/admin/` once its channel is resolved:
an anonymous request on a closed channel is answered `403 SALES_CHANNEL_SIGN_IN_REQUIRED`, and a
customer request — an administrator acting as the customer included — on a channel its
Organization is not assigned to `403 SALES_CHANNEL_NOT_PERMITTED`. Administrators and API keys are
not subject to it. A few routes are reachable on every active channel because their caller has to
reach them to become a shopper, or is not one: sign-in and sign-out, the second factor and
federated sign-in, password reset, e-mail verification, business registration, invitations, the
channel's identity, the language configuration, the dictionaries the registration form reads, the
robots policy and crawler files, product-feed downloads and the newsletter links in e-mails.

**Which Organizations may use a channel is set on the Organization**, in the new **Sales channels**
panel of its page: read with `customers:read` or `customers:manage`, changed with
`customers:manage`. An Organization keeps at least one channel. Each channel added or removed is
one row in the audit log, and a change applies at once on the server that made it and on every
other within 30 seconds. A customer whose Organization is not assigned is refused at sign-in —
password, second factor or federated sign-in — before a session is created; one whose assignment is
removed while signed in sees, on an updated storefront, a *No access to this store* screen listing
the stores they may use, each linked when the channel's **Storefront URL** setting is filled in.

**Which channel a new Organization gets.** A business registered on a store gets that store's
channel; a personal Organization created for an individual registration or a federated sign-in gets
the channel the visitor registered on; an Organization created in the admin gets the channels chosen
on its form; any other creation path gets the system-default channel. Accepting an invitation
changes no assignment. **New organization** (`/organizations/new`, a button on the roster and the
palette action `new-organization`, `customers:manage`) creates an Organization in the admin — a
duplicate tax id is refused, as in registration.

**Before closing the system-default channel**, know where your provider callbacks arrive. A payment
gateway's notification, a carrier's webhook or a provider's return URL arrives without a session and
usually without a channel, so it is an anonymous request on the system-default channel: unless the
module that receives it declares the route open, it is refused with `403` once that channel is
closed, and the provider's notifications stop arriving. `POST /api/v1/payments/receive` and
`POST /api/v1/shipments/receive` are called with an administrator's session or an API key, which the
rule does not apply to; a gateway or carrier module that receives the provider's own request must
declare that route, as [For module and overlay authors](#after-0-107-0-authors) describes.

See [Opening and closing a store to anonymous visitors](./modules/sales_channels/admin-usage.md#anonymous-access)
and [Sales channels](./modules/organizations.md#sales-channels) on the Organizations page.

##### Baskets, prices and order placement

**A basket belongs to the store it is filled on.** A customer holds one active basket per sales
channel, priced, promoted and checked for "sold on request only" on that channel, where every basket
used to be created and priced on the system-default channel. An anonymous visitor's basket token
names a basket on one store only, and filling a basket on another store starts a new one. Merging
at sign-in merges only the anonymous basket of the store signed in on. Placing an order with a
basket of another channel is refused with `422 ORDER_SALES_CHANNEL_MISMATCH` before anything is
reserved or written, and the basket is kept. The migration
`Migration20261019T043854CartsChannelBackfill` recorded every basket that had no channel on the
system-default one; where a customer already had an active basket there, the channel-less one is
left as it was and is no longer reached. See
[One basket per store](./modules/carts.md#one-basket-per-store).

**A basket line's price is always the price for its current quantity**, and order placement checks
it:

- adding more of a product, changing a quantity, merging a basket at sign-in and reordering store
  the price for the resulting quantity, so a quantity bracket applies to the quantity ordered, and
  a reorder is priced at today's prices;
- a product that no price list and no price of its own prices is refused with
  `422 CART_PRODUCT_UNPRICED`, where it used to be added at `0.00`; a product sold on request only
  is refused with `400 CART_PRODUCT_QUOTE_ONLY` whether or not a price list holds it;
- a line seeded from an accepted quote request keeps the agreed price only at the agreed quantity,
  and is priced from the list at any other. A basket converted from a quote **before** this release
  carries no agreed quantity, so its lines are priced from the list at placement; converting the
  quote again restores the agreed prices;
- at placement, a line whose stored price is no longer the price it may be ordered at answers
  `409 CART_PRICE_CHANGED`. Nothing is written, the basket is brought up to date, and the buyer
  places the order again after reviewing it. An existing storefront shows the refusal on its
  checkout failure page with the error code in front of the sentence; an updated one shows the
  sentence alone.

See [Line prices](./modules/carts.md#line-prices).

**Create order in the admin uses the channel you choose.** `POST /api/v1/admin/orders` checks the
products against the assortment of the order's channel, not the admin request's, and refuses a
sales channel that does not exist with `404`, where it used to place the order on the system-default
channel. The **Create order** screen shows *Items* and the summary once the customer and the channel
are chosen, adds products through the shared product browser (up to 200 at once) or a quick search,
and says per line why a product cannot be ordered: the customer may not see it, or it is not in the
channel's assortment. The order preview likewise refuses an unknown channel with `404`.

##### Permissions and who may grant them

- **Import and export** follow the owning modules' permissions — step 5 has the table.
- **The API description** is read with `platform.api_description.read` — step 6. The new screen
  **System → API description** (`/api-description`, also in the command palette) shows the
  document's title, version and number of endpoints, downloads it as JSON, and opens the
  interactive reference on the API's own address. The reference page loads a pinned
  `swagger-ui-dist` release, `5.33.3`, from jsDelivr, with an integrity digest on each file, where
  it used to load whichever release was current.
- **An administrator grants only what their role holds.** Saving a role that holds a permission the
  actor lacks, or changing a role that already does, answers `403 ADMIN_ROLE_GRANT_EXCEEDED`, naming
  the codes; a seeded role is changed only by a holder of `*` (`409 ADMIN_ROLE_PROTECTED`
  otherwise). Assigning a role answers `403 ADMIN_ROLE_GRANT_EXCEEDED` unless the actor holds every
  permission it grants, and an administrator whose role holds something the actor lacks is not
  edited, given a password, deactivated or deleted by them (`403 ADMIN_USER_OUTRANKS_ACTOR`). An
  API key is issued only with scopes the issuing administrator's role holds
  (`403 API_KEY_SCOPE_NOT_HELD`).
- **New permissions.** `document_templates:read` and `document_templates:write` (a one-time step at
  the first start gives every role holding `invoices:read` the first, and every role holding
  `invoices:write` the second as well, and records it in the audit log), `admin_search:configure`
  (which fields global search reads, when that module is installed), `cms.translate` (the Page
  Builder's *Translate* action) and `platform.api_description.read`. `invoices:write` is now
  labelled *Issue/correct invoices and configure invoicing*.

##### Sign-in and accounts

- **The `mfa` module cannot be switched off while administrators are required to use a second
  factor.** Switching it off on **Modules** answers `409 MFA_DEACTIVATION_BLOCKED` while
  `mfa.admin.totp_enforced` is on, and changes nothing; turn the requirement off first. Switching
  `mfa` back on is never refused.
- **Changing where a stored credential sends its secrets requires entering the secrets again.**
  Saving a credential whose endpoint field changed — an LLM's *Base URL*, an SMTP host — answers
  `422 CREDENTIAL_SECRET_REENTRY_REQUIRED` unless every stored secret of the record is entered again
  in the same save; the form marks those fields as soon as the endpoint is edited. A credential
  saved without changing its endpoint keeps its secrets as before.
- **Customer sign-in, the customer second factor and password-reset requests are limited per
  account**, as administrator sign-in already was: 50 wrong passwords in 30 minutes from a device
  the account has not signed in on, 10 from one it has; 20 wrong second-factor codes in 30 minutes,
  10 from a known device; 5 reset requests an hour. Beyond the limit the answer is
  `429 CUSTOMER_AUTHENTICATION_THROTTLED` with `Retry-After`. A completed sign-in sets the
  `b2b_customer_device` cookie that marks a known device — an existing storefront does not forward
  it, so its shoppers are counted on the first budget until the storefront is updated. Asking for a
  new reset link retires the earlier unused ones.
- **Federated sign-in follows the password sign-in's rules**, in the storefront and the Admin UI:
  it completes only in the browser that started it, an account with a second factor is handed to
  the second-step screen instead of being signed in, and a blocked customer account is refused with
  the password sign-in's sentence. A customer session whose account is blocked, deleted or gone is
  treated as signed out.
- **A wrong code or password on the signed-in two-factor screens no longer signs the administrator
  out.** Confirming the set-up, switching the second factor off and regenerating recovery codes
  answer a wrong code with `403 MFA_INVALID_CODE` and a wrong password with
  `403 CURRENT_PASSWORD_INVALID`; they answered `401`, which the Admin UI treats as an expired
  session.

##### Media library

- **HTML, XHTML, XML (XSL included) and JavaScript files cannot be uploaded**, whatever
  `assets.allowed_file_types` says: `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`, judged by the declared type
  and by the extension. SVG is still accepted, and is stored as `image/svg+xml`. A file of these
  types uploaded earlier stays in the library and is served as a download.
- **Files are served with a fixed content policy header** and `X-Content-Type-Options: nosniff`;
  raster images, SVG, video, audio, PDF and plain text are shown in the browser, every other type
  is downloaded. A private asset on S3 or GCS is redirected to its storage only with a valid signed
  link, as a local one already was (`403 ASSET_ACCESS_DENIED` otherwise).
- **An asset's file can be replaced in place**, keeping its id, folder, label, visibility, every
  reference and every URL already handed out; the replaced file stays restorable as the previous
  version for `assets.soft_delete_retention_days`. An asset can have a **permalink**, served at
  `/assets/file/<permalink>`. Both are in the asset's drawer, behind `assets.write`; the library is
  also in the command palette as *Assets library*.
- **Embedded asset URLs carry `?v=<content version>`**, so a replaced file is picked up and the
  embed can be cached for a year; `GET /assets/file/<id>` is now sent `Cache-Control: public,
  no-cache`. A CMS page cached before a replace can serve the previous version for up to five
  minutes.
- **Assets in the trash are deleted for good** after `assets.soft_delete_retention_days` — step 2.
  Each run of the sweep writes one `assets_library.retention.sweep` log line.

See [Which URLs are stable](./modules/assets-library/index.md#which-urls-are-stable) and
[Retention and purge](./modules/assets-library/index.md#retention-and-purge).

##### Documents and PDFs

- **Document templates** (`document_templates`) is where PDF layouts are designed, in the Page
  Builder, per document type and per sales channel, one layout per language. It serves the invoice,
  the product comparison and the quote request. The invoice template screens moved there:
  `/invoices/templates` redirects to it, and the e-mailed invoice PDF is now rendered exactly like
  the download. See [Document templates](./modules/document-templates.md).
- **The quote request screen offers *Export PDF* and *Send PDF to customer*** in every state while
  document templates are switched on. A send e-mails the PDF to up to five addresses through the new
  transactional e-mail `quote_request_pdf`, editable and switchable like every other, and appears on
  the quote's history.
- **The comparison PDF** follows the template, in the language the buyer browses in when the
  channel offers it: a buyer browsing in Polish now gets a Polish PDF.

##### Quote requests

- **Every quote line records a reference price** — what the customer would pay on a normal order on
  the request's channel — shown in the admin beside the customer's proposal and the agreed price.
  A cart converted into a quote request no longer records the cart's prices as the customer's
  proposal.
- **A price negotiation lock per customer.** On the organization (allowed by default) and, as an
  override, on the customer account, an administrator decides whether customers may propose prices.
  A create or draft edit that proposes a price while the request owner may not is refused with
  `422 RFQ_PRICE_PROPOSAL_NOT_ALLOWED`. The panels need `customers:read` to be seen and
  `customers:manage` to be changed.
- **A readable history** on the quote request screen, merging the records of one decision and
  naming who acted.
- **A sales representative outside a request's organization gets `404`**, as for a request that
  does not exist, where it got `403`.
- **At most 200 lines** on a customer create or draft edit (`400` beyond). A customer may edit a
  pending draft repeatedly until an administrator modifies it, up to 30 edits a minute per request.

##### Pricing, catalogue and lists

- **Price lists gain a price matrix** (*Price matrix* tab on a price list): one entry prices a
  product, a category, an attribute value, a category and an attribute value, or every product,
  for an optional organization and a quantity window, at a fixed price or a percentage. Attribute
  selections use attributes flagged *Price list rules*. See [Price lists](./modules/price_lists.md).
- **Adding products to a price list** opens the shared product browser and adds up to 200 products
  in one step. The system *Default* price list still takes no products this way.
- **Storefront catalogue reads can be priced in the shopper's currency** when the channel lists it.
  In another currency than the channel's default, a product that no price list prices has no listing
  price, rather than its own price quoted in the wrong currency.
- **Saved views** on the product list and the quote request list, and on the order list a save and
  delete through dialogs instead of browser prompts. Two of one administrator's views on one list
  may not differ only in letter case.
- **A newly created product is searchable at once**, without a first edit.
- **The CMS lists** — Pages, Blocks, Templates, Hooks — are in the command palette.

##### Notifications, newsletter and AI

- **Status push notifications.** Two settings, `pwa.push_order_status_enabled` and
  `pwa.push_quote_status_enabled` (on by default, global and per channel), switch the two
  categories; a customer chooses for their own account on an updated storefront. Order pushes are in
  the channel's language, name the status as the shop does and open the order. Quote pushes start —
  step 10.
- **Newsletter open and click tracking** is switched by two new settings,
  `newsletter.tracking.opens_enabled` and `newsletter.tracking.clicks_enabled`, both off by default.
  With them off, campaigns are sent untracked, as before.
- **The Page Builder can translate** the canvas of a language tab, or a selection, with the LLM
  configured under *Settings → Page Builder* (`cms.page_builder.translation.enabled`, off by
  default), behind `cms.translate`. Every request is recorded in the audit log.
- **LLM configurations reach DeepSeek and any OpenAI-compatible endpoint**, through the new provider
  *OpenAI-compatible (custom endpoint)*; every LLM *Base URL* must be an absolute `http://` or
  `https://` URL.

##### Everything else an operator can see

- **Admin global search**, when `@endora-commerce/mod-admin-search` is installed (step 11): the
  palette searches records after the minimum length (`admin_search.minimum_query_length`, 3 by
  default), each type following the visibility of its own admin list; `/global-search` shows the
  full results. See [Admin search](./modules/admin-search.md).
- **The Settings screen** no longer shows one sales channel's values under another channel's heading
  when the list was still loading as "Editing for" changed.
- **The sidebar** shows the release number in a section of its own, under the logo.
- **E-mail previews** in the e-mail editor and the newsletter campaign preview are drawn in frames
  that run no scripts.
- **`order.cancelled.v1` is emitted** when an order is cancelled, so a subscriber written against it
  now runs.

#### For API clients and integrators {#after-0-107-0-api}

- **The API description is gated.** `GET /api/v1/_openapi.json` and `GET /api/v1/_docs` need an
  administrator session whose role holds `platform.api_description.read` or an API key with that
  scope: `401 UNAUTHORIZED` without either, a customer session included, `403 FORBIDDEN` without the
  code. Both answers carry `Cache-Control: private, no-store`. `GET /api/v1/admin/api-description`
  serves the same document on the admin namespace. `apiKeyScopeSchema` accepts the new scope.
- **Sales-channel access.** Every storefront request is decided after its channel is resolved:
  `403 SALES_CHANNEL_SIGN_IN_REQUIRED` for an anonymous request on a closed channel,
  `403 SALES_CHANNEL_NOT_PERMITTED` for a customer whose Organization is not assigned, both with
  `details.channelCode`. `POST /api/v1/auth/customer/login` answers the second after a correct
  password (a wrong one is still `401` first) and sets no cookie.
  `GET /api/v1/storefront/sales-channel`
  carries `anonymousAccess`, and the new `GET /api/v1/storefront/sales-channel/access` tells the
  caller whether it may use the store and, for a refused customer, which stores it may use; it never
  refuses. Admin: `GET`/`PUT /api/v1/admin/organizations/:id/sales-channels`,
  `GET /api/v1/admin/organizations/sales-channel-options`, `POST /api/v1/admin/organizations`;
  `anonymousAccess` on the sales channel admin shapes (`true` by default on create).
  `GET /api/v1/storefront/seo/crawler-files` carries an optional `anonymousAccess` — read its
  absence as `true`.
- **Baskets per channel.** Every storefront cart route addresses the basket of the request's channel;
  a line of another channel's basket answers `404`. Order placement with a basket of another channel
  answers `422 ORDER_SALES_CHANNEL_MISMATCH`.
- **Order placement checks prices.** `409 CART_PRICE_CHANGED` with `details.lines` — `productId`,
  `variantId`, `quantity`, `previousUnitPrice`, `currentUnitPrice` (`null` when the line may no
  longer be ordered) and `currency`. Re-read the basket and place again. Adding a product with no
  price answers `422 CART_PRODUCT_UNPRICED`.
- **Admin orders.** `POST /api/v1/admin/orders` and `POST /api/v1/admin/orders/preview` answer an
  unknown `salesChannelId` with `404 NOT_FOUND`. The preview reports two more reasons a line is
  unavailable, `PRODUCT_NOT_VISIBLE_TO_CUSTOMER` and `PRODUCT_NOT_IN_SALES_CHANNEL`, one per line in
  the order `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE` gives; `messages[].code` stays a string, so map
  a code you do not know to a generic "unavailable".
- **Import and export.** `GET /api/v1/admin/import-export/entities` lists only what the caller may
  export or import, each entry with `canExport` and `canImport`; the export and import routes answer
  `403` without the entity's own permission, and `405` for an import of an export-only entity the
  caller may export.
- **Changed status codes.**
  - The two-factor self-service routes (`…/activate`, `…/disable`, `…/recovery-codes/regenerate`
    under `/api/v1/admin/account/mfa` and `/api/v1/account/mfa`) answer `403 MFA_INVALID_CODE` and
    `403 CURRENT_PASSWORD_INVALID`, where they answered `401`. Sign-in challenges keep their `401`.
  - A sales representative outside a quote request's organization gets `404` on every admin quote
    request route.
  - A rate-limited request answers `429 RATE_LIMITED` in the standard error envelope, with
    `Retry-After`, where it answered `500 INTERNAL`.
  - A body the server cannot parse answers `400` (empty with `Content-Type: application/json`, or
    malformed), `413` (over the body limit) or `415` (no parser for the type), each with
    `VALIDATION_FAILED`, where it answered `500`.
  - `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId` for a block not attached answers
    `404 CMS_BLOCK_NOT_FOUND`.
  - `POST /api/v1/admin/assets` with two file parts answers `201` for the first one.
- **New refusals.** `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED` for an HTML, XHTML, XML or JavaScript
  upload; `409 MFA_DEACTIVATION_BLOCKED` on switching `mfa` off while admin TOTP is enforced;
  `422 CREDENTIAL_SECRET_REENTRY_REQUIRED` (`details.fields`) on changing a credential's endpoint
  without its secrets; `403 ADMIN_ROLE_GRANT_EXCEEDED`, `409 ADMIN_ROLE_PROTECTED`,
  `403 ADMIN_USER_OUTRANKS_ACTOR` and `403 API_KEY_SCOPE_NOT_HELD` from the grant rule;
  `429 CUSTOMER_AUTHENTICATION_THROTTLED` and `503 CUSTOMER_AUTHENTICATION_UNAVAILABLE` on customer
  sign-in; `422 RFQ_PRICE_PROPOSAL_NOT_ALLOWED`; and `400` for more than 200 lines on a customer
  quote request create or draft edit.
- **Analytics ingest.** `POST /api/v1/analytics/events` stores the identity the server resolved —
  the signed-in customer, the request's channel — and ignores `customerAccountId`, `organizationId`
  and `salesChannelId` in the body, which still validate. It is limited to 60 batches a minute per
  client address.
- **Newsletter tracking links** are `GET /api/v1/newsletter/open.gif?token=…` and
  `GET /api/v1/newsletter/click?token=…&u=…`. The former path forms, which a signed token was too
  long to reach, are gone.
- **Asset URLs.** `url` and `storageUrl` of a public asset carry `?v=<contentVersion>`; the stable
  form is the new `fileUrl`. Summaries and details gain `fileUrl`, `permalink`, `permalinkUrl` and
  `contentVersion`; details gain `previousVersion`, `retentionDays` and `replaceable`. New routes:
  `POST /api/v1/admin/assets/:id/replace`, `POST …/previous-version/restore`,
  `PUT`/`DELETE …/permalink`, `GET /api/v1/admin/assets/folders/:folderId/permalink-count`.
- **Removed: the invoice template API.** `/api/v1/admin/invoice-templates` and its routes are gone;
  use `/api/v1/admin/document-templates` with `documentType: 'invoices.invoice'`.
- **New in this release**, all additive: the quote request history
  (`GET /api/v1/admin/quote-requests/:id/history`), price negotiation
  (`…/organizations/:id/quote-price-negotiation`, `…/customers/:id/quote-price-negotiation`,
  `GET /api/v1/quote-requests/price-negotiation`), the quote request PDF
  (`/api/v1/admin/quote-requests/:id/pdf`, `…/pdf/send`, `…/document-templates`,
  `…/document-template`), the price matrix (`/api/v1/admin/price-lists-engine/:id/matrix`) and bulk
  add (`…/:id/products/bulk-add`), saved views (`/api/v1/admin/catalog/products/list-views`,
  `/api/v1/admin/quote-requests/list-views`), push preferences
  (`GET`/`PUT /api/v1/storefront/pwa/preferences`), global search
  (`/api/v1/admin/global-search…`), Page Builder translation
  (`/api/v1/admin/cms/page-builder/translat…`), `?currency=` on the catalogue reads, and
  `salesChannelId` on `GET /api/v1/admin/products/:id/resolved-price`, which now answers `404` for a
  buyer that does not exist or that a sales representative may not see.
- **Order saved views.** Items carry `ownedByCaller` and `canModify`; a name taken by another of the
  owner's views answers `409 ORDER_SAVED_VIEW_NAME_TAKEN`; a `PATCH` that changes nothing writes
  nothing; a non-UUID id answers `404`; no admin session answers `401`.

#### For module and overlay authors {#after-0-107-0-authors}

**Declare every route a visitor reaches before signing in, or that arrives with no storefront
channel, open to the sales-channel access rule.** That covers sign-in, registration and recovery
routes, links in e-mails, feed downloads and — the case easiest to miss — **payment-provider and
carrier callbacks and provider return URLs**:

```ts
app.post(
  '/api/v1/payments/acme/notify',
  { config: { salesChannelAccess: 'open' } },
  async (request, reply) => {
    // Still resolved to a channel, and still behind this route's own guards.
  },
);
```

Without it the route is refused with `403` the moment an operator closes the channel it resolves
to — for a callback, the system-default channel. The option is typed on Fastify's
`FastifyContextConfig` through the platform's `./http` barrel. It skips the access step only: the
route is still resolved to a channel and keeps its own guards. Do not declare it on anything that
shows or changes a store's catalogue, prices, basket or orders. `SalesChannelAccessPort`
(`salesChannelAccessPort`, `./kernel`) decides the rule for a path that has no session yet. See
[Channel access: routes that must stay open](./modules/sales_channels/developer-guide.md#channel-access-routes-that-must-stay-open).

**Changes that stop code compiling or composing.** Source that implements, constructs or calls one
of these has to change:

| What | Change |
| --- | --- |
| `CartCustomerContext` (`@endora-commerce/contracts`) | `salesChannelId` is **required**: every caller of `CartReadPort` / `CartWritePort` names the channel whose basket it means |
| `PersonalOrganizationProvisionInput` (`@endora-commerce/mod-organizations/ports`) | required `salesChannelId: string \| null` |
| `CatalogProductReadPort` | new required `listProductIdsByAttributeValue({ key, value, match })` |
| `OrderReadPort` | new required `findStatusDefinition(code)` |
| `DocumentRenderPort` | new required `listChoices({ documentType, salesChannelId })` |
| `CartPlacementApplyPort` (`@endora-commerce/mod-carts/ports`) | new `findPriceDrift` and `refreshLinePrices` |
| `CartService` | new required `ProductDisplayModePort` constructor argument after `channelMembership`; `getOrCreateForAnon(em, token, salesChannelId)` returns `Cart \| null` |
| `CartsDeps` | `cartCouponService`, `cartConversionService`, `pushLineToShoppingList` and `appendShoppingListToCart` are required |
| `PriceListTargetReads` | required `catalogAttributeRead` — for a hand-built `PriceListService` or `PricingService` |
| `MfaModuleOptions` | required `customerChannelAccess` |
| `AnalyticsIngestService.ingest` | required `context` (`IngestContext`) |
| `customerOrgResolver` (`mod-customer-accounts`) | answers `{ organizationId, active }` or `null`; upgrade `mod-auth` with it |
| `customerSocialLoginPort` | `resolveByEmail` answers `{ id, organizationId, blocked }`, `autoCreate(email, { salesChannelId })` answers `{ id, organizationId }` |
| `AssetSummary`, `AssetDetail`, `AssetRecord` | new required members (`fileUrl`, `permalink`, `permalinkUrl`, `contentVersion`; `retentionDays`, `replaceable`) for code that builds one |
| `OrderSavedView` | required `ownedByCaller` and `canModify` for code that builds one |
| `buildServer` | no longer mounts the API description routes; read `app.apiDescription()` in-process, and `registerOpenApiRoutes` is gone |

**New ports and seams.** `BuyerLinePricePort` (`buyerLinePricePort`, from `price_lists`) — the
net unit price a buyer would pay per line on a channel; `ProductDisplayModePort`
(`productDisplayModePort`); `MfaDeactivationGuardPort`; `CustomerAuthenticationThrottlePort` and,
on `./kernel`, `AuthenticationAttemptThrottle`; `AdminSearchProviderRegistryPort`
(`adminSearchProviderRegistry`) — push a provider from a contribution-only boot hook to make a
module's records findable; `DocumentTypeRegistryPort` (`documentTypeRegistry`) and
`DocumentRenderPort` (`documentRenderPort`) — register a document type and render it;
`AdminRolePort.upsertByCode(input, { grantor })` — pass the grantor for a write made on an
administrator's behalf; `@endora-commerce/llm-client`'s `createLlmAdapter`, moved out of
`mod-prompt-actions`. `BlockDefinition` gains optional `translatable` paths, and a block without
them is never sent to a model. A credential field that names where secrets are sent declares
`endpoint: true` unless it is a `format: 'url'` field, which counts by default.

**`order.cancelled.v1` is emitted**, with a payload grown from `{ orderId }` to `orderId`,
`organizationId`, `salesChannelId`, `from`, `actor`, `reason` and `businessId`. It stays on the
in-process bus; outbound webhooks keep delivering a cancellation as `order.status_changed.v1`.

**Admin kit.** `ProductBrowserDialog`, `ProductBrowserTrigger` and `productSelectability`;
`ModalDialog` and `SavedViewsControl`; `AssetUploader` gains `upload` and `accept`. Their strings
are in the `core` bundle of `@endora-commerce/mod-i18n` at this release.

**Peer dependencies.** `mod-quote-requests` declares `@fastify/rate-limit` (`^10`), which the
platform host already registers; `mod-cms` and `mod-prompt-actions` declare
`@endora-commerce/llm-client`, which pnpm installs with them as it does the other peers.

#### In an existing storefront {#after-0-107-0-storefront}

**An existing storefront is not changed by upgrading.** `endora new storefront` copies the
reference once and the project owns it afterwards; the upgrade moves its packages, which the files
below need at `0.107.0`. Until its files are updated it keeps working against the upgraded backend
on a store open to anonymous visitors: catalogue, basket, checkout and sign-in behave as before,
within the limits named in each group. What it does not do is listed per group. Create a storefront
to copy from the way [Module blocks in an existing storefront](#storefront-block-renderers) does,
and take the groups in this order. Where you have edited a file, apply its difference by hand;
`diff -ru` between your storefront and the new one shows each difference beside your own changes.
Several files belong to more than one group — take the new version once.

**1. Sales-channel access — required before any channel is closed to anonymous visitors, and on a
storefront that serves several channels through `X-Sales-Channel`.** The storefront names its
channel on every backend call, sends a visitor of a closed store to the sign-in page, shows a
refused sign-in and the no-access screen, and stops offering individual registration on a closed
store. Without it a closed store answers the storefront's pages with `403` and a refused customer
has no screen that says why.

- **new**: `components/ChannelAccessDenied.tsx`, `lib/api/channel-headers.ts`,
  `lib/auth/sign-in-errors.ts`, `lib/channel/channel-header.ts`, `lib/channel/channel-identity.ts`,
  `lib/channel/closed-store.ts`, `lib/actions/sign-out.ts`, `lib/dictionary/browser.ts`,
  `lib/dictionary/types.ts`, `components/account/SignOutButton.tsx`, `lib/cart-action-failure.ts`;
- **changed**: `middleware.ts` — it stamps `x-sales-channel` with the channel the backend resolves
  for this storefront when no proxy did, and sends a visitor of a closed store to sign in;
  `app/layout.tsx`, `app/page.tsx`, `app/sitemap.ts`, `app/globals.css`;
  `app/(auth)/login/page.tsx`, `app/(auth)/login/mfa/page.tsx`,
  `app/(auth)/register-customer/page.tsx`; `app/(catalog)/c/[slug]/page.tsx`,
  `app/(catalog)/catalog/page.tsx`, `app/(catalog)/p/[slug]/page.tsx`,
  `app/(catalog)/search/page.tsx`; `app/compare/page.tsx`, `app/compare/share/[token]/page.tsx`;
  `app/pwa/subscriptions/route.ts`; the components `CompareToggle`, `ComparisonTable`, `Header`,
  `MfaCodeForm`, `ProductCard`, `ProductCardActions`, `ProductGrid`, `SearchAutocomplete`,
  `SharedComparisonTable`, `SocialLoginButtons`, `analytics/AnalyticsProvider`,
  `analytics/GtmProvider`, `inventory/NotifyWhenAvailableDialog` and
  `mobile/MobileSearchOverlay`; and under `lib/`: `analytics/gtag.ts`, `analytics/gtm/dataLayer.ts`,
  `api/cart.ts`, `api/client.ts`, `api/comparisons.ts`, `api/mutations.ts`, `api/newsletter.ts`,
  `api/pwa-server.ts`, `api/rfq.ts`, `api/sales-channel.ts`, `api/search.ts`,
  `api/speculation-rules.ts`, `dictionary/DictionaryProvider.tsx`, `dictionary/client.ts`,
  `i18n/messages.ts` and `server-context.ts`. The same change touches `lib/seo/crawler-policy.ts`
  and `lib/seo/crawler-file-response.ts`, which exist only in a storefront that took the SEO groups
  of 0.106.0; group 2 replaces them.

The reference holds every backend call to a channel helper with a static test; copy the
storefront's tests under `test/` with the files if you keep them.

**2. Crawler files on a closed store — assumes the three SEO groups of
[0.106.0](#after-0-106-0-storefront) and group 1 above.** Replace `lib/seo/crawler-policy.ts`,
`lib/seo/crawler-file-response.ts`, `lib/seo/robots-txt.ts`, `lib/seo/llms-txt.ts` and
`lib/seo/llms-txt-base.ts`, and add the new function `renderClosedStoreRobotsTxt` to
`lib/seo/robots-system-rules.ts` — the rest of that file, `ROBOTS_SYSTEM_RULES` with any rules of
your own, does not change. On a closed store `robots.txt` then disallows everything and names no
sitemap, and `llms.txt` names the store and says its content is for signed-in customers only; the
operator's custom instructions and additional content are kept and come back when the store is
opened. An open store's files do not change.

**3. Customer sign-in limits.** `lib/session.ts`, `lib/api/auth.ts`, `lib/api/mfa.ts` and
`app/(auth)/password-reset/request/page.tsx`: the storefront forwards the `b2b_customer_device`
cookie with the sign-in, the second step and the reset request, and keeps the one the backend sets.
Without them every attempt is counted on the budget of a device the account has not signed in on.

**4. Push notification choices and sign-out.** `app/(account)/account/page.tsx`,
`app/(account)/layout.tsx`, `components/account/SignOutButton.tsx`,
`components/pwa/PushNotificationsToggle.tsx` (new), `components/pwa/PushPreferencesForm.tsx` (new),
`components/pwa/PushOptIn.tsx`, `lib/api/pwa.ts` and `lib/api/pwa-server.ts`. The account profile
gains the order and quote push choices and a switch to turn pushes off; signing out releases the
browser's push subscription. Without them a customer receives both categories the operator offers.

**5. Price-negotiation lock on the quote request draft.** `app/(commerce)/quote-request/actions.ts`,
`app/(commerce)/quote-request/page.tsx`, `components/rfq/RfqDraftView.tsx` and `lib/api/rfq.ts`.
Without them a customer whose proposals are locked is shown the proposal field and is refused with
`422` on sending one.

**6. Smaller fixes.** `app/(commerce)/checkout/page.tsx` — the failure page shows the backend's
sentence, `CART_PRICE_CHANGED` included, without the code in front; `app/(catalog)/p/[slug]/page.tsx`,
`lib/cart-action-failure.ts` and `lib/i18n/messages.ts` — the product page words its basket failures
in the shopper's language; `app/compare/page.tsx`, `components/ComparisonTable.tsx` and
`lib/api/comparisons.ts` — the comparison PDF is asked for in the shown language and rows;
`lib/api/catalog.ts` — catalogue reads in the selected currency; `components/Breadcrumbs.tsx` and
`app/(catalog)/p/[slug]/page.tsx` — the product and breadcrumb structured data rendered through
`JsonLd`.

Then run `pnpm run typecheck`, `pnpm test` and `pnpm run build`, and delete the directory you copied
from. **A custom storefront** that is not derived from the reference has three things to do to
work with a closed store: name its channel on every backend call, browser calls included; send a
visitor to sign in on `403 SALES_CHANNEL_SIGN_IN_REQUIRED`; and show
`403 SALES_CHANNEL_NOT_PERMITTED`, reading `GET /api/v1/storefront/sales-channel/access` for the
stores the customer may use.

How far this has been exercised: what this section says is what the release's changesets state,
read against the source of the release — the manifests, the migrations, the routes and the
reference storefront's history between `v0.106.0` and `0.107.0`. No instance had been upgraded from
`0.106.0` with `pnpm run upgrade 0.107.0`, no instance declaring `mod-invoices` had had
`mod-document-templates` added after it, and no storefront created by an earlier release had the
groups of files above applied to it, when this section was written; the order of the steps and the
storefront edits are untried.

### After upgrading to 0.108.0 {#after-0-108-0}

`pnpm run upgrade 0.108.0` moves the packages of the release from `0.107.0` and applies its
migrations — twenty-eight, twelve of them for the new pricing model and its editor, three that
widen unit prices to four decimal places and three that record how VAT and a discount were applied.
**The release
replaces how prices are stored and resolved, in one step and with no compatibility period**: the
price lists of earlier releases, with their Application rules, rosters and quantity brackets, become
**price books**, and a product no longer carries a price of its own. The base prices an instance
charged from the *Default* price list are kept; **every other price list is deleted** by the
upgrade, and nothing converts it — the one exception being a list a product feed is pinned to,
which is kept as an empty, expired book (step 3). Read the steps below before you run the command.
The other changes of the release follow the pricing one in each part of this section: minimum
order quantities and returnable products, groups of lines on quote requests and orders, custom-field
list filters and the carrying of custom-field values between records, unit prices kept at four
decimal places from the price book to the invoice, inline editing of sales
opportunities, per-channel product texts on the storefront, an operator action that prepares a
customer's basket from a quote, and a new module, `admin_feedback`. This section says what to do, in
order, and then what behaves differently for [operators](#after-0-108-0-operators),
[API clients and integrators](#after-0-108-0-api),
[module and overlay authors](#after-0-108-0-authors) and the owner of
[an existing storefront](#after-0-108-0-storefront). The model itself is described on the
[Price books](./modules/price_lists.md) page, and the full list of what was removed with its
replacement in the developer guide's
[migration note](./modules/price_lists/developer-guide.md#upgrading-from-the-old-model-migration-note).

#### What to do, in order {#after-0-108-0-steps}

Before the upgrade:

1. **Write down every price list other than *Default*: its prices, who it priced and on which
   channels.** `Migration20261022T111815PriceListsPriceBooksConversion` deletes every price list
   that carries an Application rule — customer-group and organization contracts, sales, catalogue
   lists — with its roster, brackets, rule and price-matrix entries, and drops the old tables. A
   list a product feed is pinned to is retired instead (step 3), but it is kept empty, so its prices
   are lost all the same. What they priced has to be entered again as price books after the
   upgrade; the database backup of [Before you start](#before-you-start) is the only copy of the
   rows.
2. **Write down the price of every product that has a *Default unit price* but no row on the
   *Default* list.** `Migration20261022T111811CatalogPriceFieldsRemoved` strips `defaultPrice` and
   `price` from every product's attribute values and drops `product_variants.price_override`;
   neither is converted. A product that was priced only by its *Default unit price* has **no price**
   after the upgrade — the basket refuses it with `422 CART_PRODUCT_UNPRICED` — until a base price
   is entered for it. A variant's *Price override* was never charged, so dropping it changes no
   price.
3. **A product feed pinned to a price list other than *Default*: no action is needed.** A product
   feed pinned to a price list the upgrade removes is kept pinned to a retired copy of that list: an
   empty, expired book for everyone, with no sales channel and the list's id, named
   `<name> (removed by the 0.108.0 upgrade)` (the old name is cut so the whole fits 200
   characters). The feed page warns that its price book is not active, and the feed's next
   generation run withdraws its published file, so its link answers as if the feed had never been
   generated, until you pin the feed to a price book that applies, or unpin it (step 9). You can
   delete the retired book once you no longer need it; a feed still pinned to it then warns that
   its price book no longer exists.
4. **If an integration of yours writes prices through `priceListAdminPort`** — a PIM connector's
   price import, typically — have its new version ready: the port is removed, and
   `priceBookWritePort` replaces it. A connector built against the old port cannot write prices on
   this release. The method-by-method mapping is in the developer guide's
   [migration note](./modules/price_lists/developer-guide.md#upgrading-from-the-old-model-migration-note).

The upgrade itself:

5. **Run `pnpm run upgrade 0.108.0`.** `setup` applies the migrations module by module, in the
   order of the modules' dependencies, and each module's own in the order of their stamps — so
   every `catalog` migration, the removal of the price fields included, runs before the
   conversion. Grouped by module:

   | Migration | Module | What it does |
   | --- | --- | --- |
   | `Migration20261016T082008CatalogOrderRules` | `catalog` | `products.min_order_quantity`, `products.returnable`, `product_packaging_units.min_order_units` |
   | `Migration20261022T111811CatalogPriceFieldsRemoved` | `catalog` | Drops `product_variants.price_override`, strips `defaultPrice` and `price` — see step 2 |
   | `Migration20261022T182523CatalogAdminNameKeys` | `catalog` | Stored, indexed admin name and search keys on `products`, and the `pg_trgm` extension |
   | `Migration20261019T103522CustomFieldsDefinitionListFilter` | `custom_fields` | `custom_field_definitions.list_filter`, `false` for every existing field |
   | `Migration20261020T110920CustomFieldsDefinitionCarryTo` | `custom_fields` | `custom_field_definitions.carry_to`, empty for every existing field |
   | `Migration20261016T082022OrdersOrderItemReturnableAtPurchase` | `orders` | Nullable `order_items.returnable_at_purchase` |
   | `Migration20261020T172007OrdersOrderItemGroups` | `orders` | Table `order_item_groups`, `order_items.group_id` and `position` |
   | `Migration20261021T164807OrdersOrderCommentSystemNote` | `orders` | Nullable `order_comments.system_note` |
   | `Migration20261021T165247OrdersOrderItemsPriceSource` | `orders` | Nullable `order_items.price_source` |
   | `Migration20261024T145147OrdersVatMethod` | `orders` | Nullable `orders.vat_method`, `per_rate` for an order placed on this release; nothing is backfilled |
   | `Migration20261025T031732OrdersUnitPriceFourPlaces` | `orders` | Widens `order_items.unit_price` to `numeric(14,4)` |
   | `Migration20261018T122118QuoteRequestsItemPackagingUnitId` | `quote_requests` | Nullable `quote_request_items.packaging_unit_id` |
   | `Migration20261020T171341QuoteRequestsQuoteRequestItemGroups` | `quote_requests` | Table `quote_request_item_groups`, `quote_request_items.group_id` and `position` |
   | `Migration20261021T164808QuoteRequestsQuoteRequestEventCarrySkipped` | `quote_requests` | Admits the `custom-field-carry-skipped` event type |
   | `Migration20261025T031736QuoteRequestsUnitPriceFourPlaces` | `quote_requests` | Widens `quote_request_items.desired_unit_price`, `agreed_unit_price` and `reference_unit_price` to `numeric(14,4)` |
   | `Migration20261020T131018PwaPreferencesOrganizationAttributionCheck` | `pwa` | A `CHECK` on `push_notification_preferences` |
   | `Migration20261021T165244CartsCartItemsPriceSource` | `carts` | Nullable `cart_items.price_source` |
   | `Migration20261025T031727CartsUnitPriceFourPlaces` | `carts` | Widens `cart_items.unit_price`, `recomputed_unit_price` and `agreed_unit_price` to `numeric(14,4)` |
   | `Migration20261024T145631InvoicesVatSummary` | `invoices` | Nullable `invoices.vat_summary`, the per-rate summary a document is issued with; nothing is backfilled |
   | `Migration20261024T174052ReturnsCaseItemDiscount` | `returns` | `return_case_items.default_discount_amount`, `0` for every existing line |
   | `Migration20261023T195611ProductFeedsRunWithdrawalReason` | `product_feeds` | Nullable `product_feed_runs.withdrawal_reason`, for a run that withdrew the published file |
   | `Migration20261023T234605ProductFeedsPriceListFkDropped` | `product_feeds` | Drops `product_feeds_price_list_fk`, so a retired book can be deleted later; runs after the conversion |
   | `Migration20261021T165239PriceListsPriceBooksExpand` | `price_lists` | The price-book header, audience and channel sets, the evolved rows, precedence version 1, the price-surface tables |
   | `Migration20261021T232310PriceListsPriceBooksVersion` | `price_lists` | `price_lists.version` and `ever_activated` |
   | `Migration20261022T012134PriceListsPriceSurfaceGenerations` | `price_lists` | Generations of the price surface |
   | `Migration20261022T111815PriceListsPriceBooksConversion` | `price_lists` | The conversion — see step 1 and below |
   | `Migration20261022T182527PriceListsProductLines` | `price_lists` | Table `price_list_product_lines`, backfilled from the stored rows |
   | `Migration20261023T152351PriceListsPriceSurfaceTargetedMarks` | `price_lists` | Table `price_profile_stale_products` and `price_profiles.revision`, for the targeted refresh of the price surface |

   The conversion runs in one transaction: it creates one **base price book** per currency a
   *Default*-list bracket uses, plus the platform's default currency; makes every *Default* bracket
   a fixed row of its currency's base book; deletes every other price list, except one another
   table still refers to — a feed pinned to it — which it retires as an empty, expired book that
   keeps its id (step 3); and drops the old tables and columns. `Migration20261022T182523CatalogAdminNameKeys` adds four generated columns
   to `products`, and each rewrites the table under an exclusive lock — 3.5–7 s per column at
   50 000 products in the platform's measurement — which is one more reason to keep the API stopped.

After the upgrade, before the instance takes traffic again:

6. **Make sure a queue consumer runs.** Price-sorted and price-filtered listings are ordered from
   prices the `price_lists.surface` worker precomputes; it runs in a process that consumes queues
   (`BACKEND_ROLE` unset, `all` or `worker`) with a queue Redis connection —
   [Queue consumers](./operations/queue-consumers.md). The upgrade builds nothing: the first
   price-sorted request on each sales channel and currency registers what it needs and asks the
   worker for it, and is served in the catalogue's default order — product cards correctly priced —
   until the worker has built it. Without a consumer, price sorting never orders by price.
7. **Check the base prices.** Open a few products' *Pricing* tab: the prices that came from the
   *Default* list are there, per currency. Enter a base price for each product of step 2.
8. **Recreate the price books** that replace the lists of step 1, on **Price books**
   (`/price-lists`, or ⌘K / CTRL+K → *Price books*). A book has one currency, a set of sales
   channels, an audience — everyone, chosen customer groups or chosen organizations — and lines;
   it prices nothing until it is activated. *Why this price?* (`/price-lists/explain`) shows, for a
   buyer and a product, which line decided the price.
9. **Pin the feeds of step 3 again, or unpin them**, through the product feeds API
   (`PATCH /api/v1/admin/product-feeds/:id` with `priceListId` — the book's id, or `null`); there is
   no admin control for it yet (issue #414). Pin each to a price book that applies to anyone on the
   feed's channel: *Active* or *Scheduled* within its dates, assigned to the feed's channel and for
   everyone. A feed pinned to any other book publishes no prices from it — the feed's page says
   why — and its next run ends *Withdrawn* and withdraws the published file, so the link answers as
   for a feed that has never been generated until the book applies again. A withdrawn run is not a
   failure: it raises no notification and delivers nothing.
10. **Mark the products buyers may return.** `Migration20261016T082008CatalogOrderRules` adds a
    **Returnable** flag to every product, off: the line of an order placed after the upgrade is
    returnable only if its product was returnable when the order was placed, and a return
    (`kind: 'return'`) naming any other line is refused with `422 RETURN_LINE_NOT_RETURNABLE`.
    Orders placed before the upgrade are unaffected — their lines record no value and stay
    returnable — and complaints are never restricted. Select the products on the product list and
    use **Bulk edit → Returnable → Yes — returnable**; one product's flag is in the **Order rules**
    card on its *Inventory* tab.

Whenever it suits you:

11. **Give `catalog:read` to every role that holds `price_lists:write`.** Adding product lines to a
    price book uses the catalogue's product browser, which `catalog:read` guards; the role editor on
    *Admin roles* (`/admin-roles`) shows the shortfall for a role that lacks it, with a one-click
    add. The two price-list permission codes are unchanged; their
    labels now read *View price books and display modes* and *Edit price books, base prices and
    display modes*.
12. **In an instance seeded with the demo shop**, run `pnpm run cli demo reset` and then
    `pnpm run cli demo seed`: the conversion removed the demo's old price lists, and the seed brings
    back its base prices and the price books of the worked examples on the
    [Price books](./modules/price_lists.md) page.
13. **Decide whether to add `admin_feedback`.** The release brings a new package,
    `@endora-commerce/mod-admin-feedback`, which lets an administrator send feedback to the makers
    of Endora Commerce from a *Send feedback* link in the Admin UI sidebar. No module depends on
    it, so the upgrade does not declare it; [Adding a module that is new in a
    release](#adding-a-new-module) says how. Once declared it is **switched on and sends to
    Endora** (`admin_feedback.relay_url`, by default
    `https://commerce.endora.software/api/platform-feedback/`): each message carries the words
    typed, the sender's e-mail and optional phone, the Admin UI's language and address, the release
    the instance runs, its configured public API address and the sending administrator's name and
    id. Switch it off under
    **Settings → Feedback** (`admin_feedback.module_enabled`), or empty the relay address, if the
    instance must not send data to Endora. Nothing is stored on the instance.
14. **Mark the custom fields the admin lists should filter on.** The Orders, Quote Requests and
    Opportunities lists offer a filter for each Order, Quote Request or Opportunity custom field
    whose new *Use as list filter* option is on, and every existing field has it off. Turn it on in
    the field's editor on `/custom-fields`, which now edits existing fields.
15. **Raise `vite` and `nodemailer` in your own manifests.** The admin shell's optional peer range
    for `vite` is now `^7.3.7`; an instance whose admin member still resolves an earlier `vite` 7
    gets an *unmet peer* warning ([After it finishes](#after-it-finishes)) — raise `vite` in
    `admin/package.json` to `^7.3.7`. `mod-email` and `mod-newsletter` still accept any
    `nodemailer` 10, so an instance keeps the one it resolved; the platform now builds against
    `^10.1.4` (10.2.1 in its lockfile), which tightens address parsing, strips credentials from a
    cross-origin redirect and caps the work one message can cause. Raise `nodemailer` where the
    instance declares it to `^10.1.4` to have those fixes, then run `pnpm install`.

#### For operators {#after-0-108-0-operators}

##### Pricing

- **Price lists are price books.** The sidebar entry *Price books* opens the list of books; the
  product editor's *Default unit price* field, the variant table's *Price override* column and the
  product's *Linked price lists* zone are gone, and a product's base prices are on its *Pricing*
  tab. *Pricing settings* (⌘K / CTRL+K) holds the display modes, the *Show list price beside the
  buyer's price* switch (`pricing.show_list_price`, off by default) and the precedence, read-only.
- **How a price is decided** — the base price, a catalogue price for everyone on a channel, a
  buyer's contract price, and a sale charged only when it is lower — is on the
  [Price books](./modules/price_lists.md) page, with worked examples.
- **A price change shows in a price-sorted listing within about half a second** in the platform's
  measurements; a change that reaches the whole catalogue — a line for all products or for an
  attribute value alone, more than 10 000 products at once, a sales-channel change — takes under
  about a minute and a half with some 200 groups of buyers with their own books (measured 85 s at 202,
  on 50 000 products, where it took about 4.5 minutes before issue #416). Prices on product cards
  never lag.
- **The products import refuses a file with a price column** — `default_price`, `defaultPrice`,
  `price`, `price_override` or `priceOverride` — with `400 PRICE_SET_IN_PRICE_BOOKS`, and imports
  nothing. Prices are imported through the price books' CSV import, or by a PIM connector through
  `priceBookWritePort`.
- **A signed-in customer is priced on their own customer group** wherever their account has one
  that differs from their Organization's — listings, the product page, search and its
  suggestions, comparisons, the basket and placement. The basket also shows the price placement
  will charge: a line from an accepted quote shows its agreed price at the agreed quantity, and a
  line placement would refuse reads as unavailable.
- **A reorder leaves out the lines nothing prices any more** for the buyer, or that are sold on
  request only, and reports them; such a line used to be seeded at the old order's price and the
  basket then refused at placement.

##### Amounts, VAT and invoices

- **VAT is computed one way on every document**: per rate, on the sum of the net amounts at that
  rate, rounded half-up once, and the gross is the net plus that VAT (art. 106e ust. 1 pkt 13–14 of
  the Polish VAT Act). The checkout, the order, the payment and proforma it opens, the invoice, a
  correction and a refund show the same figures. A basket whose lines carry two VAT rates can come
  to a cent more or less than before the upgrade: 29.50 at 23 % with 4.30 at 5 % was 40.80 gross
  and is 40.81, which is also what its invoice says. A line's gross on an order, its confirmation,
  an invoice and the order screens is **the line's own rounding** — 29.50 at 23 % shows 36.29 —
  shown for information; the VAT and the totals are the per-rate figures, so a document's line
  grosses may add up to a cent more or less than its total.
- **Invoices issued before the upgrade for orders of VAT payers overstated their net, VAT and
  gross.** Issuance read each order line's gross amount as its net amount and taxed it again: a line
  of 100.00 net at 23 % was invoiced as 123.00 net and 151.29 gross. The upgrade changes how
  invoices are issued from now on. **It does not correct the invoices already issued, and the
  platform does not issue corrections for them**; they keep the amounts they were issued with, and
  their per-rate summary is shown as they were issued.
- **An order placed before the upgrade keeps what it charged.** Its returns refund what it stored
  and was paid. An invoice issued for it after the upgrade takes VAT per rate and can be a cent
  above what was paid — 40.81 for an order that charged 40.80 — and records as paid only what was
  paid, so it shows the cent as still due (*Do zapłaty: 0.01*) rather than as paid.
- **Returns refund by default what was paid, across all of an order's returns.** Each return refunds
  what everything returned so far is worth, minus what earlier returns already refunded, so no
  sequence of returns refunds more than the order charged and a complete return refunds exactly
  that: two returns of one of two items at 29.50 + 23 % refund 36.29 and then 36.28 (72.57 paid),
  where each used to refund 36.29. A complaint about a line that cannot be returned counts in the same
  total, and an order-level discount is taken off what the goods refund — the order charged the goods
  less the discount, so a full return refunds that, never the goods' full price. A correction credits
  the same way: the goods' VAT as the invoice charged it, and the discount back on a line of its own,
  so all corrections of an invoice together credit exactly what it charged. For an order placed
  before the upgrade, the refund is what the order charged and the correction credits exactly that.
- **A settlement checks its correction before it moves any money.** A refusal — a case line named
  twice, an invoice line the correction cannot match, `invoices` switched off — leaves the case
  unsettled with nothing refunded or credited. A settlement refunds every line of the case: a line
  the request leaves out is refunded and credited at its stored approved amount, so the refund and
  the correction always agree. Two returns of one order are settled one after the other.
- **An order refunded in full before it is invoiced is not invoiced.** Issuing its VAT invoice is
  refused — *This order's payments were refunded in full before it was invoiced, so there is no sale
  left to invoice.* — and draws no number, and automatic issuance on an order status skips it. An
  order refunded in part is invoiced, with only what was kept as paid.
- **An amount with more than two decimal places is refused, not rounded** — a delivery cost, a
  payment method's surcharge, an approved refund, a return cost, a credit limit, an opportunity's
  value, and a promotion's fixed amount, step or minimum spend. The screen answers *An amount may
  have at most two decimal places.* A unit price is not an amount: see the next section.

##### Unit prices at four decimal places

- **Unit prices are no longer rounded to grosze at the cart.** A price book has always stored four
  decimal places, but until this release the basket rounded the price to two as it took it in: a
  screw priced 0.0125 PLN was charged 0.01 PLN, so 10 000 of them cost 100.00 PLN instead of
  125.00 PLN, and one priced 0.0150 PLN was charged 0.02 PLN — a third too much. A unit price now keeps
  its four places, unrounded, on the basket line, the order line, the quote request's lines and
  the invoice line.
- **The line value is the rounding point.** A line's net value is the unit price × the quantity,
  rounded half-up to the grosz once: 0.0125 × 10 000 = 125.00, and 0.0150 × 3 = 0.045, so 0.05.
  VAT stays as described above — per rate, on the sum of the line values. Refunds and corrections
  work from what the order stored and charged, as before.
- **The columns were widened**: `cart_items.unit_price`, `recomputed_unit_price` and
  `agreed_unit_price`, `order_items.unit_price`, and `quote_request_items.desired_unit_price`,
  `agreed_unit_price` and `reference_unit_price` are now `numeric(14,4)`, like the price books and
  `invoice_lines.unit_net_price`. Widening is lossless: no stored value changes, and orders placed
  before the upgrade keep the two-place prices they were placed at.
- **A unit price shows its significant places, up to four**: `0,0125 zł`, `1,505 zł` — and two
  places when the third and fourth are zero (`1,50 zł`). Line values and totals always show two. This holds
  in the Admin UI, the storefront, the invoice PDF's *Cena netto* column, the quote PDF and the
  e-mails. A product feed still publishes two places.
- **A quote's agreed or proposed unit price may be typed with up to four decimal places**; a fifth
  is refused with *A unit price may have at most four decimal places.*
- **A basket line added before the upgrade** carries its two-place price. If the product's price
  has a third or fourth decimal place, that is no longer the current price, and the basket reprices
  the line before the order is placed — at 0.0125 instead of 0.01, for example.

##### Minimum order quantities and returnable products

- **A product can have a minimum order quantity** (pieces, on simple and configurable products)
  and a packaging unit a minimum number of units — the **Order rules** card on the product's
  *Inventory* tab and the **Minimum (units)** column of its packaging units. Existing products have
  none, so nothing changes until one is set. A minimum is judged on the product's total over every
  line and variant of a basket.
- **Where it is enforced.** The basket refuses an add or a change that would leave a product below
  its minimum, and *Submit for approval*, checkout, one-click buy, reorder, admin *Create order*
  and the external order API refuse a basket below one. A line from an accepted quote request is
  exempt at the quote's agreed quantity while that quote is still valid. A buyer's quote request
  is refused below a minimum; one an operator creates or modifies is saved, with a *Below minimum*
  badge on the line. The operator's quick-order import marks such rows as warnings; the buyer's
  rejects them. One-click buy orders the product's minimum instead of 1.
- **Returns follow the Returnable flag** (step 10): a return of a line that was not returnable at
  purchase is refused; a complaint about such a line is accepted, with an approved refund of `0`
  pre-filled, and the case marks it *Not returnable at purchase*.
- **Limits.** Admin *Create order*, the external order API and quick-order builds take at most
  200 lines; `quick_order.import_max_rows` is held to 1–10 000 whatever its stored value.

##### Groups of lines on quote requests and orders

- **A quote request's lines can be arranged in named, ordered groups**, on its *Modify* tab and
  on the create screen, with a per-group summary; *Split line* puts part of a line's quantity on
  a new line, and one product may sit on several lines. An order placed from an accepted quote
  takes the quote's groups, and admin *Create order* has the same editor. An order's groups cannot
  be changed after placement. The quote PDF prints the groups as sections, and so does every
  document template whose line-items table has no grouping chosen, templates saved before the
  upgrade included — its default is now *Document's groups*. A document with no group prints as
  before; choose *No grouping* in the template editor to keep a table flat whatever the document
  says.

##### Custom fields

- **List filters** (step 14) on the Orders, Quote Requests and Opportunities lists: kept in the
  address, in saved views and, on Orders, in the CSV export.
- **Existing definitions can be edited** on `/custom-fields`: labels, *Required*, *Use as list
  filter*, and the options of a select field; the key and the value type stay fixed.
- **Values can be carried between records.** A definition's *Carry value to …* options carry its
  values from a Quote Request to the Order placed from it and to its Sales Opportunity, from an
  Order to its Opportunity, and from an Opportunity to the Quote Request or Order an administrator
  creates from it — into empty fields only. A value that cannot be carried is named in an internal
  system note on the Order, or in the Quote Request's history. Every existing definition carries
  nothing.
- **Quote Request custom fields follow the `quote_requests` module**: while it is switched off
  they are neither listed nor writable on `/custom-fields`, and they return unchanged with it.
- **An Opportunity's change history shows custom-field values only to a role holding
  `custom_fields:read`.**

##### Sales opportunities

- **The Opportunity screen is edited in place** — title, description, expected close date,
  contact, sales channel and typed values each where they are shown — and descriptions, notes,
  messages and event descriptions are written in a formatted-text editor. An Order reference shows
  the Order's status, total, date and customer.

##### Quote requests

- **An approved quote request's *Prepare the customer's basket*** puts its lines into the basket of
  the customer who owns it, at the agreed prices, replacing what that basket held, for the customer
  to complete at checkout. The earlier *Place order* button signed the administrator out.

##### Storefront product texts

- **A product's per-sales-channel texts reach the storefront.** The name, description, SEO fields
  and attribute values written for a sales channel in the product's scope editor are what the
  storefront's product page shows on that channel, and the name written there is what its listing
  cards, search results and suggestions show.

##### Feedback from the Admin UI

- **`admin_feedback`** (step 13) adds *Send feedback* beside the release in the sidebar, for every
  signed-in administrator, at most five messages per administrator in ten minutes.

#### For API clients and integrators {#after-0-108-0-api}

##### Pricing

- **The old admin pricing routes are removed**: `/api/v1/admin/price-lists-engine/…`,
  `/api/v1/admin/pricing/rule-targets/…`, `/api/v1/admin/products/:id/price-lists` and
  `/api/v1/admin/products/:id/resolved-price`. Their replacement is `/api/v1/admin/price-books/…`:
  `GET ?productId=` for a product's books and `POST /api/v1/admin/price-books/resolve` for a
  resolved price with its explanation.
- **A catalogue write that names a price is refused**: `POST`/`PATCH
  /api/v1/admin/catalog/products[/:id]` with `attributeValues.defaultPrice` or
  `attributeValues.price`, and a variant write with `priceOverride`, answer
  `400 PRICE_SET_IN_PRICE_BOOKS` and write nothing. Base prices are written with
  `PUT /api/v1/admin/price-books/base-prices/:productId`.
- **`GET /api/v1/storefront/products/:id/resolved-price` answers an unpriced product honestly**:
  `baseListId`, `basePrice` and `quantityBracket` are all `null`, where `baseListId` used to be an
  empty string. Amounts are decimal strings (`{ "amount": "199.0000", "currency": "PLN" }`), as the
  route always sent them. The answer also carries `source` (which tier priced it), `compareAt` and,
  when the shop shows it, `listPrice`.
- **The price-matrix error codes are gone** (`PRICE_MATRIX_ENTRY_NOT_FOUND`,
  `PRICE_MATRIX_ENTRY_OVERLAP`, `PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE`, `PRICE_MATRIX_ENTRY_LIMIT`);
  the price-book codes, `PRICE_BOOK_*` and `PRECEDENCE_CHANGE_UNAVAILABLE`, replace them.
- **A product feed pinned to a price book** publishes only while the book is *Active* or
  *Scheduled* within its dates, on the feed's channel and for everyone. A run of a feed whose book
  does not apply ends with the new run status `withdrawn` and `withdrawalReason` (the reason; `null`
  on every other run), clears the published file and answers the public URL with `404`; a client
  that switches exhaustively on the run status has one more case. The failure code
  `price_list_unavailable`, which nothing raised, is removed. An admin feed (`GET /api/v1/admin/product-feeds`, `GET …/:id`) carries
  `pinnedPriceBookWarning`: the reason it does not publish, or `null`.
- **`POST /api/v1/orders/:id/reorder`** reports a line it left out because nothing prices it with
  `reason: 'no_price'` in `unavailableItems`.

##### Amounts and VAT

- **A typed money amount with more than two decimal places answers
  `400 AMOUNT_PRECISION_EXCEEDED`** (a new code) and is not stored; it used to be rounded. The fields
  are `cost` of a delivery method, `additionalPrice` of a payment method, `approvedRefundAmount` of a settlement, `returnCost` of
  a return delivery method, `amount` of an admin order refund, `grantedAmount` of a credit limit,
  an opportunity's `manualValue`, a promotion's `amount`, `spendStep`, `minCartSubtotal` and the
  `value` of an `amount_off` promotion, and an ERP integration's `netTotal`, `taxTotal`,
  `grossTotal` and `paidTotal` of a sale document. `details` names each field with the issue
  `AMOUNT_PRECISION_EXCEEDED`, and the message is in the reader's language. A request that also
  fails anything else answers `400 VALIDATION_FAILED`, with the same issue among its details.
  Trailing zeros are not significant (`"123.4500"` is 123.45); a string that is not a decimal at
  all is `400 VALIDATION_FAILED` with a format issue.
- **A unit price carries up to four decimal places**.
  A quote request line's `desiredUnitPrice` and `agreedUnitPrice` (`POST /api/v1/quote-requests`,
  the admin create and `PATCH` routes) accept four places; a fifth answers
  `400 UNIT_PRICE_PRECISION_EXCEEDED` (a new code, *A unit price may have at most four decimal
  places.*), with `details` naming the field. A request refused both for an amount and for a unit
  price answers `400 VALIDATION_FAILED`. Responses carry the four-place unit price: the numbers
  (`unitPrice` of a cart and an order line, `agreedUnitPrice`, `unitNetPrice` of an invoice line)
  as the value — `0.0125` — and the decimal strings as four places — the admin order preview's
  `unitPrice` is `"0.0125"` or `"29.4950"`, where it was rounded to `"29.50"`, and so are
  `previousUnitPrice` and `currentUnitPrice` in the `details.lines` of `409 CART_PRICE_CHANGED`. **A line's value is
  `unitPrice × quantity` rounded half-up to two places once**: compute it that way rather than
  from a unit price rounded to two. An order placed before the upgrade keeps its two-place prices.
- **VAT is taken per rate on the sum of the net amounts at that rate**, rounded half-up once: an
  order's `taxTotal` and `total`, the checkout and admin previews, an invoice's `vatSummary`,
  `taxTotal` and `grossTotal`, and a correction's amounts. An order line's `lineTotal` and an
  invoice line's `grossValue` are the line's own rounding, `round(net × (1 + rate))`, and may add up
  to a cent more or less than the total. The shapes are unchanged. An order at two rates can differ
  by a cent from the same basket before the upgrade.
- **An invoice's `paidTotal` is what was paid for the order** — each captured payment attempt less
  what was refunded from it, or the order's stored total when it is recorded as paid with nothing
  captured — never the invoice's own gross, so `amountDue` can be `0.01` for an order placed before
  the upgrade. An order refunded in part before it is invoiced is invoiced, with only what was kept
  as paid.
- **An order refunded in full before it is invoiced is not invoiced.** When its payments' refunds
  equal what was captured and cover the whole order total, there is no sale left to document:
  issuing a VAT invoice answers `422 INVOICE_ORDER_REFUNDED` (*This order's payments were refunded
  in full before it was invoiced, so there is no sale left to invoice. Nothing was issued.*) and draws
  no number, and automatic issuance on an order status skips the order and logs
  `[invoices] the order was not auto-invoiced: its payments were refunded in full`.
- **A settlement naming one case line twice answers `400 VALIDATION_FAILED`** (issue `duplicate_line`)
  and moves nothing; a settlement whose correction would be refused is refused before the refund.
- **A settlement's `totalRefundAmount` covers every line of the case**, not only the lines in
  `lines`: a line left out counts at its stored `approvedRefundAmount`, and the correction credits
  the same lines. Settlements of one order run one at a time; one that waits more than 15 seconds
  for another answers `409 VALIDATION_FAILED` (`details.code: settlement_in_progress`), with nothing
  moved, and can be retried.
- **A correction of a discounted order** credits the goods at their invoiced value and the discount
  back on a negative 0 % line; a cancelled correction no longer counts against later ones.
- **A correction refuses a `total` above the sum of its lines** with `400 VALIDATION_FAILED`
  (`details.code: correction_total_exceeds_lines`), and corrections of one invoice credit
  cumulatively: together never more than it charged.
- **Invoices issued before the upgrade are not changed.** One issued for an order of a VAT payer
  overstates `netTotal`, `taxTotal` and `grossTotal` (each line's net was the order line's gross);
  its per-rate summary is shown as it was issued.

##### Minimum order quantities and returnable products

- **New refusals.** `422 PRODUCT_BELOW_MINIMUM_QUANTITY` and
  `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (`details.lines[]`) from cart adds and changes,
  `POST /api/v1/cart/submit-for-approval`, placement, the external order API and a buyer's quote
  request writes; `422 PACKAGING_UNIT_MISMATCH` from a quote request line whose packaging unit is
  not one of the product's; `422 RETURN_LINE_NOT_RETURNABLE` from `POST /api/v1/returns` with
  `kind: 'return'`. A product name in such a refusal is in the language the response is answered
  in — the q-sorted `Accept-Language`, else the channel's default language — and so are the line
  names of `GET /api/v1/cart`, which are no longer English by default.
- **200-line bound.** `POST /api/v1/admin/orders`, `POST /api/v1/admin/orders/preview`,
  `POST /api/v1/external/orders` and the quick-order builds refuse more than 200 lines with
  `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`; on the external
  API this is checked before the `Idempotency-Key` header is required.
- **New fields.** `minOrderQuantity` on product, search and comparison summaries;
  `minOrderUnits` on packaging units; `minOrderQuantity` and `belowMinimum` on cart lines;
  `belowMinimumLines[]` on `POST /api/v1/orders/preview-total`; `returnable` and
  `notReturnableReason` on the lines of `GET /api/v1/orders/:orderId/returnable`, whose `eligible:
  false` with reason `no_returnable_lines` still allows a complaint. The admin product write takes
  `minOrderQuantity` and `returnable`.
- **`GET /api/v1/cart` answers `5xx`** when the catalogue cannot be read, instead of a cart without
  the minimum flags.

##### Groups of lines

- **Every order and quote request reply** carries `itemGroups` and each item's `groupId` and
  `position`, with `items` in display order — the replies had no defined order before. Admin
  `POST`/`PATCH` of a quote request and admin `POST /api/v1/admin/orders` accept `groups` and a
  per-line `groupKey`. `POST /api/v1/admin/orders/preview` answers each priced line's `taxRate`.

##### Custom fields

- **List filters.** The admin Orders list and its CSV export, the Quote Requests list and the
  Opportunities list accept `customFieldFilters` (JSON keyed by custom-field key); a key the list
  does not offer is refused with `400 CUSTOM_FIELD_FILTER_UNAVAILABLE`. Each list's offered fields
  are at `GET /api/v1/admin/orders/custom-field-filters`,
  `GET /api/v1/admin/quote-requests/custom-field-filters` and
  `GET /api/v1/admin/crm/opportunities/custom-field-filters`. On
  `GET /api/v1/admin/crm/opportunities` without `cardValues=true`, a `custom:` reference in
  `fieldFilters` now follows the list-filter option instead of the board card.
- **Definitions.** Definitions carry `listFilter` and `carryTo`; three 409 refusals that shared
  `CUSTOM_FIELD_DEFINITION_INVALID` now have their own codes (`CUSTOM_FIELD_OPTION_IN_USE`,
  `CUSTOM_FIELD_VALUE_TYPE_LOCKED`, `CUSTOM_FIELD_STORED_VALUES_EXIST`), and an option `PATCH`
  changes only the members it names. Turning a carry on towards a field that cannot take the values
  is refused with `422 CUSTOM_FIELD_CARRY_INCOMPATIBLE`.
- **Carry records.** `GET /api/v1/admin/orders/:id/comments` gives every comment `systemNote`
  (`null` for an ordinary one); the customer's comments read never lists a system note. The
  admin quote-request history gains the `custom_field_carry_skipped` entry. The Opportunity history
  leaves `customFieldValues` out for a caller without `custom_fields:read`.

##### Quote requests

- **`POST /api/v1/admin/quote-requests/:id/prepare-customer-basket`** (`rfqs:handle`) prepares the
  owning customer's basket from an approved request; the Admin UI no longer calls the customer's
  `convert-to-order` route.

##### Storefront product reads

- **`GET /api/v1/catalog/products/:idOrSlug`, `GET /api/v1/catalog/products` and the search
  results and suggestions** return the product's override for the request's sales channel and
  language; a product without one answers exactly as before.

##### Feedback

- **`POST /api/v1/admin/feedback`**, while `admin_feedback` is present: any signed-in
  administrator, `204` when the relay accepts, `429 RATE_LIMITED`,
  `502 ADMIN_FEEDBACK_DELIVERY_FAILED`, or `503 ADMIN_FEEDBACK_NOT_CONFIGURED` when the relay
  address is empty or not an `http(s)` URL.

#### For module and overlay authors {#after-0-108-0-authors}

##### Pricing

- **`priceListAdminPort` is removed; `priceBookWritePort` replaces it** — base prices per currency,
  addressed by product and currency rather than by a list id, written as one audited command.
- **`@endora-commerce/contracts` drops the Application rule and the old list, bracket and matrix
  shapes**, `ListingPrice` loses its `source: 'product'` arm, and `PriceListRecord` /
  `PriceListReadPort` are reshaped for books. Each removal is listed with its replacement in the
  package's changelog.
- **An overlay that decorates `pricingService`** must decorate the batched entry points
  (`resolveLinePrices`, `resolveListingPrices`) as well as the single calls; the cart, the placement
  check and quote reference prices price through the batch.
- **A module whose events decide a price** bumps `PricingGeneration` as before; `bump(change?)` now
  takes a `SurfaceChange` saying what it moved, and a bump without one makes the price surface
  rebuild every profile.
- **A feed-pricing port of your own** must implement `namedListPublishability` beside
  `namedListPrices`, which now takes the feed's `salesChannelId`.

##### Money arithmetic

- **`@endora-commerce/contracts` carries the platform's money arithmetic**: `money-decimal`
  (`roundHalfUp`, exact sums and products, `vatByRate` — the one VAT method, per rate on the sum of
  the net amounts — and its inverse `netForGrossAtRate`) and `money-input` (`twoDecimalAmount`,
  `twoDecimalAmountString`, `addAmountPrecisionIssue` and `ERROR_CODES.AMOUNT_PRECISION_EXCEEDED`).
  An overlay that computes an amount from a price uses them rather than `Number#toFixed(2)` or
  `Math.round(x * 100) / 100`, and a new money input field uses the refinement.
- **A unit price is carried at four places, and the line value is the rounding point** (owner
  ruling of 2026-10-25). `@endora-commerce/contracts` adds `unitPriceHalfUp` (a unit price at its
  four places, as `numeric(14,4)` stores it), `unitPriceFractionDigits` and `unitPriceDisplayText`
  (the one display rule), `grossUnitPriceHalfUp`, and in `money-input` `fourDecimalUnitPrice`,
  `fourDecimalUnitPriceString`, `isUnitPricePrecisionIssue` and
  `ERROR_CODES.UNIT_PRICE_PRECISION_EXCEEDED`. An overlay that stores a resolved or typed unit
  price keeps it with `unitPriceHalfUp` — never `roundAmountHalfUp`, which rounds to two — and
  computes a line with `lineAmountHalfUp(unit, quantity)`. `formatMoney` in
  `@endora-commerce/admin-kit/lib` takes `{ unitPrice: true }`, and a document value of kind `money`
  takes `unitPrice: true`, to show a unit price by the rule.
- **`OrderReturnContext` gains `vatMethod`, `productsPaidTotal` (stored subtotal + tax − discount)
  and `discountTotal`, and `OrderReturnContextLine` gains `unitNetPrice` and `taxRate`**;
  `paidLineAmount` is the line total the order stored. An implementation of `OrderReturnContextPort`
  in an overlay owes these fields and reads them from what the order stored, never recomputes them.
- **`CorrectiveInvoicePort` gains `validateCorrection(input)`**, which refuses what
  `createCorrection` would refuse without writing anything, and `CorrectiveInvoiceLine` gains an
  optional `discount`; an implementation in an overlay owes the method.
- **Two new nullable columns record which method a document was made under**: `orders.vat_method`
  (`per_rate` from 0.108.0) and `invoices.vat_summary` (the per-rate summary an invoice or a
  correction was issued with). `null` is a document from before; nothing is backfilled. A third,
  `return_case_items.default_discount_amount` (default `0`), records the discount a refund carries.

##### Other ports and shapes

- **`CatalogProductReadPort`** gains `listPackagingUnitsByProductIds`, and its records
  `minOrderQuantity`, `returnable` and `minOrderUnits`: a typed stub of the port must add them.
- **`CartWritePort.addItems`** adds lines in batches of up to 200 (`onBelowMinimum`,
  `replaceExisting`, `keepRepeatedLines`); the new `OrderQuoteSourcePort` (`orderQuoteSourcePort`,
  owner `orders`) says whether a basket's quote-seeded lines keep their exemption.
- **Defaulted reply keys** (`itemGroups`, `groupId`, `position`, and `groups` on quote document
  data) make the inferred types require them: code that builds a `QuoteRequest`, `QuoteRequestItem`,
  `Order`, `OrderItem` or `QuoteRequestDocumentData` literal must now supply them.
  `adminPatchQuoteRequestSchema` and `adminCreateQuoteRequestSchema` are refined objects, so
  `.extend()` and `.omit()` on them are no longer available.
- **`CustomFieldDefinitionRecord`** requires `carryTo`, and `CustomFieldEntityTypeInfo` has
  `carryTargets`; a hand-built value needs them. `customFieldListFilterPort` and
  `customFieldCarryPort` are new.
- **`request.responseLanguage()`** is available on every request of a composition that registers
  the error envelope; registering the envelope twice with different language resolvers now throws.
- **A stored `grouping: null`** on a document template's line-items table now means *the
  document's groups* (it meant no grouping); a table that must stay flat stores `{ by: 'none' }`.
- **`mod-crm`'s admin layer** has optional peer dependencies `@tiptap/react` and
  `@tiptap/starter-kit` (`^3`), which the admin application already carries.

#### In an existing storefront {#after-0-108-0-storefront}

The pricing routes a storefront calls keep their paths, so a storefront created by an earlier
release keeps rendering prices. What it does not show until its files are brought over from the
release's storefront: a selected variant's own price on the product page, a sale shown as the list
price struck through beside *Your price*, the buyer price as compare-at on product cards, and the
list price beside a lower buyer price. The files are `app/(catalog)/p/[slug]/page.tsx`,
`app/page.tsx`, `components/ProductCard.tsx`, `components/PriceTag.tsx`,
`components/VariantPicker.tsx`, `components/SearchAutocomplete.tsx`,
`components/pricing/BaseSalePriceBlock.tsx`, `components/pricing/PdpPriceToggle.tsx`,
`lib/api/pricing.ts` (where `ResolvedPrice.baseListId` is now `string | null`) and the pricing
strings in `lib/i18n/messages.ts`. The variant picker of an earlier storefront showed a variant's
*Price override*; that field is no longer sent, so the picker shows no price for a variant until
`VariantPicker.tsx` is brought over.

The release's storefront also shows a unit price with its significant places, up to four
(`0,0125 zł`) — product cards, rows, the product page, the basket, the order and quote pages —
through `formatMoney(…, { unitPrice: true })` and `grossUnitPriceFromNet` in `lib/i18n/money.ts`,
and lets a quote proposal be typed at four places. A storefront created earlier shows such a price
rounded to two places, while the basket charges the four-place price: bring over
`lib/i18n/money.ts`, `components/ProductCard.tsx`, `components/ProductRow.tsx`,
`components/PriceTag.tsx`, `components/VariantPicker.tsx`, `components/SearchAutocomplete.tsx`,
`components/pricing/BaseSalePriceBlock.tsx`, `components/CartLine.tsx`,
`components/orders/OrderItemRows.tsx`, `components/rfq/RfqDraftView.tsx`,
`app/(account)/quote-requests/[id]/page.tsx` and `lib/analytics/ecommerce.ts`.

The release's storefront also shows minimum order quantities (product page, card, basket,
checkout, quick order, quote draft, shopping list), the returnable state of each line in the
return form, and a quote's and an order's line groups. A storefront created earlier does not: its
buyers meet the server's refusals — `422 PRODUCT_BELOW_MINIMUM_QUANTITY`,
`422 RETURN_LINE_NOT_RETURNABLE` — with the server's message, and see an order's or a quote's
lines ungrouped, in display order. The changes are in the reference storefront between `v0.107.0`
and `v0.108.0`: `git diff v0.107.0 v0.108.0 -- storefront` in the platform repository lists them.

This section was written on 2026-10-23, 2026-10-24 and 2026-10-25 against the release branch of
the pricing change (`feat/160-pricing-model-v2`) and `master` since `v0.107.0`, read from the changesets of the
release against its migrations, manifests, routes and the reference storefront's history. No instance had been upgraded with
`pnpm run upgrade 0.108.0` when it was written; the order of the steps and the storefront edits are
untried.

### After upgrading to 0.109.0 {#after-0-109-0}

Each entry below stands on its own: read the ones for the parts of the platform you use.

#### Product feeds: a price below one cent is published as a pack {#after-0-109-0-feed-packs}

- **What changed.** Until this release a product feed rounded every price to two decimal places, so
  a product priced 0.0125 PLN was published as 0.01 PLN while its product page showed 0,0125 zł — a
  price mismatch Google Merchant Center disapproves products for. A price with more than two
  significant decimal places is now published as the price of a **pack** of 10, 100, 1 000 or
  10 000 pieces — the smallest that makes it exact to the grosz: 0.0125 PLN is published as 100
  pieces at 1.25 PLN (1.54 PLN on a gross feed at 23 %). The pack size goes in the template's pack
  fields. **A price with two decimal places is published exactly as before**, byte for byte.
- **The predefined Google Merchant Center template gains three fields**, after `g:sale_price`:
  `g:multipack`, `g:unit_pricing_measure` and `g:unit_pricing_base_measure`. On an existing
  instance the migration `Migration20261025T145041ProductFeedsGoogleTemplatePackFields` adds them
  to the installed template. They are empty, and left out of the file, for every product priced to
  the grosz.
- **A product the template cannot publish as a pack is left out of the feed**, where it used to be
  published with a rounded price. That is every such product in a feed on the Meta, Amazon, eBay or
  Allegro template, and in a feed on your own copy of the Google template. The run lists each one
  under the new reason `sub_cent_price_without_pack_field`. What to do: after the upgrade, open the
  latest run of each feed; if the reason appears and the product belongs in that feed, add a field
  bound to the source *Pack size (prices below one cent)* to the template — in a copy of the Google
  template as `g:multipack`, with `g:unit_pricing_measure` and `g:unit_pricing_base_measure` bound
  to the two *pack as a count* sources. A run that leaves out more than half its items fails with
  `skip_threshold_exceeded` and keeps serving the previous file, which still carries the rounded
  prices — so do not leave such a failure alone.
- **The landing page.** The storefront's product page shows the price of one piece. Google's
  multipack rules ask the landing page to show the multipack's price, so watch the Merchant Center
  diagnostics for products published as packs.
- **For API clients and integrators**: `feedFieldSourceKindSchema` gains `pack_quantity`,
  `pack_unit_pricing_measure` and `pack_unit_pricing_base_measure`, and `feedRunIssueReasonSchema`
  gains `sub_cent_price_without_pack_field` and `sub_cent_price_beyond_pack_limit`. A client that
  validates a template, an exported template document or a run's issues against a closed list must
  accept them.
- **For overlay authors**: `FeedItemPrice` gains `taxRatePercent: number | null`, and
  `ResolveFeedItemInput` an optional `templateFields`. An overlay that replaces the item field
  resolver receives both and publishes whatever it writes: to publish a sub-cent price as a pack it
  applies the same rule, with `feedPackQuantity` from `services/feed-pack.ts`.

#### Quotes: a discount below one grosz prints "—" {#after-0-109-0-quote-discount}

- **On the quote PDF**, and in the document template editor's preview, a line discount or a discount
  total that is real but rounds to 0.00 — 0.0001 PLN a unit over three units, say — prints "—"
  instead of "0,00 zł", which read as "no discount". The amount itself is unchanged, so list value
  − discount = net still holds on the document. Nothing to do.
- **On the admin quote request screen**, the *Difference* column shows a difference of unit prices
  with its significant places, up to four — −0.0001 PLN — instead of rounding it to 0.00.
- **For module and overlay authors**: a document value of kind `money` may carry
  `belowMinorUnit: true`. `formatDocumentValue` prints it as "—" and `sumDocumentValues` keeps the
  mark when the sum is still zero; a custom block that formats values some other way should do the
  same.

#### Invoices, payments and order totals: money rules of issue #428 {#after-0-109-0-money}

**For operators.**

- **An invoice counts every refund made before it was issued** (issue #428). Until this release a
  VAT invoice deducted from what was paid only the refunds the payment gateway reported. It now
  also deducts a return settled with a refund by bank transfer, for an order not paid through a
  gateway, and a return settled as a credit to the credit limit; an order an operator marked as
  refunded counts as refunded in full — with nothing captured, and also with a captured payment
  refunded by hand (for example after a refund anomaly, below), never adding the mark to a gateway
  refund already recorded. So an order refunded in full this
  way before it was invoiced is **not invoiced** any more — issuing answers
  `422 INVOICE_ORDER_REFUNDED`, and automatic issuance skips it and logs why — and one refunded in
  part is invoiced with only what was kept as paid. Invoices issued before the upgrade are not
  changed. With the `returns` module switched off, only the gateway's refunds are deducted.
- **An invoice never shows a negative amount due** (issue #428). When more was paid than the
  invoice's gross, the amount due is 0 and the difference is shown as the **overpayment** — a row
  on the invoice screen and a *Nadpłata* line on the PDF. An invoice template edited before the
  upgrade prints the line too, labelled *Nadpłata*; the label and a switch to hide the line are in
  the totals block of the template editor. A correction, whose gross is negative, now shows 0 due
  and the amount to be returned as its overpayment.
- **The minimum order value takes at most two decimal places** (issue #428). Saving
  `orders.min_order_value` with more is refused with `400 AMOUNT_PRECISION_EXCEEDED`, as every
  other typed amount is; a value already stored is read as before. Nothing to do unless a script
  writes the setting with more places.
- **A gateway refund amount with more than two decimal places is refused, not rounded** (issue
  #428). The payment keeps its refunded amount and status, the refusal is logged with the payment,
  the order, the reported amount and the gateway's refund reference, and the payment's history
  carries `providerDetails.refundAnomaly`. The gateway's webhook is still acknowledged, so it is not
  delivered again: check such a refund with the gateway and settle it by hand.
- **A line group's summary on an order adds up to the order's own VAT method** (issue #428). The
  admin order screen's group summaries took a placed order's gross as the sum of its line totals,
  each line's own rounding, which could be a cent away from the VAT per rate the order charged.
  They now take the VAT per rate on the sum of the group's net amounts; the line totals stay as
  shown.

**For API clients and integrators.**

- **An invoice carries `overpayment`, and `amountDue` is never negative** (issue #428): on
  `GET /api/v1/admin/invoices/:id` and every reply carrying an invoice detail, `amountDue` is
  `max(0, grossTotal − paidTotal)` and the new `overpayment` is `max(0, paidTotal − grossTotal)`.
  A client that read a negative `amountDue` as an overpayment reads `overpayment` instead. The
  template merge field `{{var invoice.overpayment}}` is new beside `{{var invoice.amountDue}}`.
- **`paidTotal` of an invoice issued after the upgrade deducts refunds made outside `payments`**,
  and `POST /api/v1/admin/orders/:orderId/invoices` answers `422 INVOICE_ORDER_REFUNDED` for an order
  refunded in full that way — see the operators' entry above.
- **A gateway module calling `receivePaymentPort.reflectRefund` with more than two decimal
  places** gets `{ paymentId, changed: false }` and nothing recorded, where the amount used to be
  rounded half-up. Report the gateway's amount in major units with at most two places.

**In an existing storefront.**

The release's storefront takes a line group's summary on the order page from the VAT per rate on
the group's net amounts (`orderSectionTotals` in `components/line-groups/GroupedLineRows.tsx`,
called by `components/orders/OrderItemRows.tsx`), where an earlier storefront adds up the line
totals and can show a summary a cent away from the order's VAT. Bring over those two files to
match; nothing breaks without them.

This entry was written on 2026-10-25 against `master` at `9e43c3412` and the branch of issue
#428 (`fix/428-money-followups`). No instance had been upgraded to 0.109.0 when it was written.

#### Sales channels: the public-channel flag is retired into the display modes {#after-0-109-0-channel-prices}

**For operators.**

- **What changed** (issue #492). A sales channel used to carry a price-visibility flag of its own
  (`is_public`, never shown in the admin). With it off — the state of every channel created by the
  admin, by the boot-time default-channel reconciler and of the demo's *PL B2B VIP* — the channel
  sent no price to **anyone**, signed-in buyers included. The flag is gone. Whether a viewer sees a
  price is decided by the display modes alone: *Pricing settings* for every channel, the *Settings*
  screen for one channel, and the organization, category and product overrides.
- **What the migration does.** `Migration20261028T173317CoreSalesChannelsRetireIsPublic` gives every
  channel that had the flag off `pricing.unauthenticated_display_mode = none` as that channel's own
  value, so its anonymous visitors still see no prices, and then drops the column. A channel that
  already had its own value for that setting keeps it.
- **What you will see.** On a channel that had the flag off, **signed-in buyers now see prices**
  according to their display mode, and may sort and filter by price. If that is not what you want
  for a channel, set its *Default price display mode* (`pricing.default_display_mode`) to *None* on
  the *Settings* screen for that channel, or set an override for the organizations concerned. A
  product or category display-mode override applies to anonymous visitors too, as it always did, so
  a product overridden to *Gross only* shows its price to guests on such a channel.
- **Before migrating**, stop the processes running the previous release: the column they read is
  dropped. The migration refuses a database that has a channel with the flag off but no registered
  `pricing.unauthenticated_display_mode` setting (one the platform has never started on); start the
  previous release once so the settings are registered, then migrate.

**For API clients and module authors.** No HTTP response carried the flag, so none changes shape;
a viewer whose display mode is `none` is answered as described in the `price_lists` module's
documentation (`resolvedPrice.displayMode: 'none'` and no amount, where such a channel used to
answer `resolvedPrice: null`). In code, `SalesChannel.isPublic`, `CachedChannel.isPublic`,
`ResolvedSearchChannel.isPublic` and `CatalogResolvedChannel.isPublic` are removed — drop them from
anything you construct — and the channel cache key moves to `sales-channels:v4:`.

This entry was written on 2026-10-28 on the branch of issue #492 (`fix/492-retire-ispublic`).

#### Products: two statuses, Archive and Restore, and data per channel and language {#after-0-109-0-product-status}

This release gives a product's status, publication window, audience, URL key, SEO texts, gallery,
attachments, packaging-unit names and order rules a value per sales channel and per language, and it
changes the product status model. **The status change is breaking**; the rest is additive.

**For operators.**

- **A product's status is `active` or `inactive`; `draft` is gone.** The upgrade's migration turns
  every `draft` product, and every `draft` override per channel or channel × language, into
  `inactive` without archiving anything. New and duplicated products start `inactive`.
- **`inactive` no longer archives.** It switches a product off where it is set — the product is not
  listed, not searchable, not orderable, and its page answers as for a product that does not exist —
  and nothing more. Archiving is its own action, **Archive** / **Restore**, in the product editor,
  in bulk on the product list and from the admin assistant, behind `catalog:write`.
- **Every product `inactive` at the upgrade stays archived and needs an explicit Restore.** Until
  this release `inactive` was how a product was archived, so the migration keeps such products
  archived (with their archived time, or their last-update time when they had none). Setting one
  `active` does **not** bring it back: open the product list's **Archived** tab
  (`/catalog/products/archived`, or **Archived products** in the command palette), select the
  products to sell again and choose **Restore**.
- **An archived product answers "gone" (`410`) only to a buyer who could otherwise see it** — in its
  channel, language and audience; everyone else gets the absent product's `404`. An archived product
  can no longer be added to a basket or put on a quote request.
- **A saved product-list view that used the Draft status** opens on **All**, with a note saying so.
- **After deploying over an existing database, run one search reindex per sales channel** (Bulk
  actions page), so the search index carries each product's per-channel and per-language state.

**For API clients and integrators.**

- `status` takes `active` or `inactive` only. `draft` and the legacy write alias `archived` are
  refused with `400 VALIDATION_FAILED` — on `POST` / `PATCH /api/v1/admin/catalog/products`, the bulk
  update, `POST …/products/resolve-ids`, the API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku`
  and a catalogue import. Send `inactive` where you sent `draft`; to archive, call
  `POST /api/v1/admin/catalog/products/:id/archive` (`…/restore` to bring it back), or the bulk update
  with `fields: { archived: true }` (`false` restores) as the only field.
- **Admin product list:** `counts.draft` is replaced by `counts.archived` (`counts` is
  `{ all, active, inactive, archived }`), and the filter `status=archived` by `archived=only`
  (`archived=exclude|include|only`, default `exclude`; `includeArchived=1` still means `include`).
- **`product.archived.v1`** means "archived by the Archive action", no longer "status moved to
  `inactive`"; Restore sends `product.updated.v1` with `changedFields: ['archivedAt']`.
- **Quote requests** refuse an archived product: an operator's create and edit answer
  `409 PRODUCT_ARCHIVED` with `details.productIds`, a customer's paths the absent product's `404`.
- The Catalog and Quote requests module pages describe the rest — the per-channel and per-language
  values, URL keys and redirects, and the external order intake's `404 PRODUCT_NOT_FOUND` for a
  product the key's Organization cannot see in its channel.

**For module and overlay authors.**

- **`productStatusSchema`** is `active | inactive`; `coerceProductStatusWrite` and
  `productStatusWriteSchema` are removed — use `productStatusSchema`.
- **`CatalogGalleryPort.listForProducts(productIds, channelId)`** and
  **`CatalogGalleryPort.baseImageUrls(productIds, channelId)`** take a required `channelId`
  (`string | null`): pass the sales channel you serve, or `null` for the previous, global answer. An
  overlay implementing the port leaves out the items hidden in that channel.
- **`CatalogBulkImportPort`** has a new required method, `exportScopedStatuses()`.
- **`ProductDetail`** has a required `paths` (`productPagePathsSchema`): a literal you build must
  carry it.
- **`seoMetaOverrideSchema.locale`** and **`cartViewLineSchema.productSlug`** may be `null`.
- **A new admin zone, `product.editor.seo.after`**, at the end of the product editor's SEO tab. Its
  props are `ProductEditorZoneProps` (`productId`). The `seo` module's link to its meta-tag editor
  is a contribution to it, so the Catalog module no longer names `seo`:

  ```ts
  import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

  export const contributions: AdminContributions = {
    zones: [
      zoneComponent('product.editor.seo.after', () => import('./zones/ProductSeoNote.js'), {
        requiredPermission: 'catalog:read',
      }),
    ],
  };
  ```

  A contribution vanishes with its module, and a failing one does not take the tab with it.

**In an existing storefront.** The release's storefront renders the product page's canonical and
alternate-language links from the response's `paths`, and lets the link's `?lang=` beat the
language cookie on the product page. Bring the release's storefront over, so that the product
page's links follow the per-language URL keys.

This entry was written on 2026-10-27 against the branch of spec `163-product-data-scopes` (`feat/163-product-data-scopes`).

#### Storefront: the language is part of the URL {#after-0-109-0-language-in-url}

- **What changed.** A storefront URL now names its language as its first path segment —
  `/pl/p/wiertarka`, `/en/p/drill` — so one URL means one language for every visitor and every
  search engine. Each channel language gets a derived prefix; a sales channel setting,
  **Prefix the default language in URLs**, decides whether the default language is prefixed too.
- **Your existing channels keep their addresses.** The upgrade migration
  (`Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage`) sets the setting **off** on
  every channel that exists when it runs: default-language URLs stay unprefixed (`/p/wiertarka`).
  Channels created afterwards start **on**.
- **Other languages gain prefixes either way.** A non-default-language product link was
  `/p/<key>?lang=<language>`; it now answers a permanent redirect (308) to `/<prefix>/p/<key>`.
  Sitemaps, product feeds, canonical and `hreflang` links and e-mails emit the prefixed URLs.
- **To adopt prefixes for the default language too**, open *Sales channels*, edit the channel and
  switch **Prefix the default language in URLs** on. Every default-language URL then moves under
  its prefix; an unprefixed URL is redirected (307) to the language chosen by `?lang=`, the `lang`
  cookie or the browser's languages. Nothing indexed or bookmarked breaks. Browsers may keep a
  cached permanent redirect for up to an hour after you flip the setting.
- **CMS pages.** A page slug whose first segment is a channel's language prefix (`en`, `pl/…`) can
  no longer be saved. An existing one is marked in the CMS page list as hidden by the language
  prefix: rename its slug.
- **Third-party code** calling `productPath` from `@endora-commerce/contracts` must pass the
  channel's URL facts: `productPath({ key, languageCode, channel })` replaces
  `productPath({ key, languageCode, channelDefaultLanguage })`.

#### Storefront: the message catalogue is split into namespaces {#after-0-109-0-message-namespaces}

- **What changed.** The storefront's message catalogue, `lib/i18n/messages.ts`, was one file: the
  `MessageKey` union and the `en-US` and `pl-PL` blocks. Its header invited a theme to replace the
  file or extend the record. The blocks now live in namespace files under `lib/i18n/messages/`:
  `core.ts` holds every key the old file held, with the same wording, and `commerce.ts`,
  `account.ts`, `auth.ts`, `chrome.ts` and `content.ts` hold the strings the storefront showed in one
  language only and now shows in both. Each namespace is written with `defineMessages` from
  `messages/define.ts`, which refuses, at type-check time, a Polish block that lacks a key of the
  English one or has a key it does not. `messages.ts` composes them: `MessageKey` is derived from the
  namespaces' keys, and `MESSAGES`, `tForLocale`, `CATALOGUE_LOCALES` and `SupportedLocale` keep their
  shape. A new helper, `lib/i18n/format.ts`, fills a message's `{name}` placeholders.
- **Components take the language.** Components that rendered English or Polish only now read their
  words from the catalogue, and a client component receives the page language as a `locale` prop
  from the server component that renders it — `components/contact/ContactForm.tsx`, for example. A
  page of your own that renders such a component passes it the `locale` from `getServerContext()`.
- **If your storefront left `lib/i18n/messages.ts` as it was**, bring over `lib/i18n/messages.ts`,
  the whole `lib/i18n/messages/` directory and `lib/i18n/format.ts` together, with the components.
- **If you changed wording in `lib/i18n/messages.ts`**, bring the files over, then make the same
  change where the key is now declared: `git grep "'<key>'" lib/i18n/messages/` names the file —
  `core.ts` for every key the old file had. Keep a list of those edits; they are edits to the
  release's files and have to be made again after each upgrade.
- **If you added keys of your own**, do not add them to `core.ts`. Put them in a namespace file of
  your own — for example `lib/i18n/messages/theme.ts`, written with `defineMessages({ 'en-US': {…},
  'pl-PL': {…} })` like the others — and add it to `MESSAGE_NAMESPACES` in `lib/i18n/messages.ts`.
  A key may be declared in one namespace only: a second declaration would silently replace the
  first.
- **If you replaced `lib/i18n/messages.ts` with a catalogue of your own**, the release's components
  name keys your file does not have, so the storefront no longer type-checks. Bring the release's
  catalogue over and move your wording into it as above, rather than replacing the file again.

This entry was written on 2026-10-31 against the branch of issue #85
(`debt/85-storefront-i18n-infra` and the area branches stacked on it). No instance had been
upgraded with it when it was written.

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
