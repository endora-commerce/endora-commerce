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
