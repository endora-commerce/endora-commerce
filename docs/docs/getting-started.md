---
title: Getting started
description: Install a new Endora Commerce instance with two commands — what the installer asks, what you get, how to start it and sign in, and how to stand the API, the admin and the storefront up on machines of their own.
sidebar_position: 2
---

# Getting started

Two commands give you a running Endora Commerce on your own machine: an API, an admin panel and a
storefront. This page is the reference for those two commands — what the installer asks, what it
writes, how to start it and where to sign in — and for the same installer standing the three up on
machines of their own. The repository's `README.md` is the short version.

## What you need

- **Node.js ≥ 22.18** — the instance's own `package.json` declares the same range, and the
  installer refuses to start on an older Node rather than write a tree its manifest rejects.
- **pnpm** — `corepack enable` provides it. Without it the installer still works: it runs the
  pnpm this release pins through corepack, and prints every next command in a form that needs
  only Node and npm — the second command becomes `npx --yes pnpm@<version> run dev:all`. Run
  what it prints. If neither `pnpm` nor `corepack` is on your `PATH`, the installer refuses and
  says so.
- **Docker with Compose v2**, for the development services (PostgreSQL, Redis, Meilisearch and the
  Mailpit mail catcher). Not needed with `--no-services`, when you run those services yourself.

## The two commands

```bash
npx create-endora-commerce@latest my-shop
cd my-shop && pnpm run dev:all
```

`create-endora-commerce` is only a front door: it passes every argument, unchanged, to
`endora install` from `@endora-commerce/cli`. `npx @endora-commerce/cli install my-shop` is the
same command, and `--help` on either prints every flag. Nothing on this page differs between the
two spellings.

### What the first command does

In this order, printing each command before it runs it:

1. **Gets the packages it reads from.** When nothing of Endora Commerce is installed beside the
   target directory — the usual case under `npx` — it installs this release's packages into a
   temporary directory first, because the module set is read from their manifests. The temporary
   directory is removed as soon as the instance is written; if that fails, it is kept and its path
   printed. It runs before anything is written to your directory, so a failure there leaves your
   target untouched.
2. **Checks the machine** — the ports and the Compose project name it is about to use — and moves
   whatever is already taken. See
   [When a port or a name is already taken](#when-a-port-or-a-name-is-already-taken).
3. **Writes the instance** — an ordinary pnpm workspace you own. The platform, the admin shell and
   every module arrive as dependencies; no file of the platform is copied into your tree.
4. **Writes the storefront**, as its own repository beside the instance. Its files come with the
   installer: a copy of the reference storefront, already made standalone — see
   [The storefront](#the-storefront).
5. **Installs the instance's dependencies and starts the development services** with
   `docker compose`, writing their addresses into the instance's `.env`.
6. **Generates, builds and migrates**, installs every module, and creates your administrator.
7. **Seeds demo data**, if you asked for it. A failure in it does not fail the install.
8. **Installs the storefront's dependencies.**
9. **Prints what to run next**, including every answer it took as a recommendation and how to
   reverse it.

A failing step stops the run with that step's own exit code and prints what is left to do, starting
with the step that failed, so you can finish by hand. The administrator's password is never
printed: where a command needs it, the list shows `<password>` and you type yours in its place.

### What you get

Two directories, side by side, both yours:

| Directory | What it is |
| --- | --- |
| `my-shop/` | The **instance**: `package.json` (the module list), `backend/` (the API's and the worker's entry points), `admin/`, `docs/`, `apps/my-shop/` (your own modules — see [Create your first Module](./create-your-first-module.md)), `deploy/` (example production files), `compose.dev.yml` and `.env`. |
| `my-shop-storefront/` | The **storefront**, a Next.js application with its own `.env`. |

After `pnpm run dev:all`:

| What | Address | |
| --- | --- | --- |
| The storefront | `http://localhost:3000` | |
| The API | `http://localhost:3001` | its OpenAPI document is at `/api/v1/_openapi.json` |
| The admin | `http://localhost:3002` | sign in with the administrator's e-mail and the password you chose |
| Mailpit | `http://localhost:8025` | every e-mail the instance sends in development |

These are the defaults. Where the installer moved a port, the closing summary prints the address
it chose, and that is the one to open.

### The modules it installs

With no `--module`, the installer installs **every module of the open-source set**, each switched
on. The run says how many, and why. Anything you do not use can be switched off in the admin under
**Modules** (`/platform/modules`): a module that is off behaves as if it were not installed, keeps
its data, and comes back as it was when you switch it on again. Some modules cannot be switched off
because the platform cannot run without them; the Modules screen shows which.

The list of modules is not repeated here — it is the [Modules](./modules/README.md) section of this
site, generated from the modules themselves.

`--module <id>` (repeatable, or comma-separated) installs an explicit set instead. The set is
closed over the modules' own dependencies, and it is refused if it leaves out a module the platform
cannot run without. Most people never need it: switching a module off is one click, while adding a
module you did not install is a manifest edit, an install and a migration.

## The questions it asks

At a terminal, the installer asks what your flags did not answer — **seven questions** when it
stands up every part. A question answered by a flag is not asked; the installer says which answers
came from flags once, before the first question. Pressing Enter accepts the recommendation where
there is one, and the closing summary names every recommendation you accepted this way.

| Question | Recommendation (Enter) | Flag that answers it |
| --- | --- | --- |
| Which directory it is written to | `./endora-commerce` | the `<dir>` argument |
| Which parts this machine runs | every part | `--only <component>`, `--without <member>`, `--no-storefront`, `--storefront-dir <path>` |
| Whether to start the development services | yes | `--no-services` |
| Whether to load demo data | **none** — you must answer | `--demo` or `--no-demo` |
| The administrator's e-mail | none | `--admin-email <address>` |
| The administrator's password | none | `--admin-password <secret>` |
| The administrator's first and last name | none | `--admin-first-name <text>`, `--admin-last-name <text>` |

**The parts** are a checklist: the three components a run can stand up — `api`, `admin` and
`storefront` — and `docs`, a documentation site for your instance. Type a row's number to toggle
it, Enter to accept. Leaving every row checked is the run this page has described so far.
Unchecking a component is the same as naming the others with `--only`: the run then drops the
questions that no longer apply and asks where the other components are instead — see
[Standing the components up separately](#one-component-per-machine). `docs` is left out with
`--without docs`. The storefront is written as a **sibling** directory, `<dir>-storefront` by
default — never inside the instance, where the instance's workspace would swallow it.

**Demo data has no recommendation on purpose.** A shop you are evaluating wants a catalogue,
customers and orders before the first screen; a shop you will sell from wants none of it. An empty
answer asks again. `--demo` also adds one package to your module list,
`@endora-commerce/demo-composition`: it is what joins the modules' example rows into one shop —
the demo products sold on your default channel, the demo administrators holding their roles.
If you change your mind later, `pnpm add -w @endora-commerce/demo-composition` and then
`pnpm run cli demo seed` add demo data, and `pnpm run cli demo reset` withdraws it, leaving your
own rows alone.

**The administrator is never generated.** The password is the one value you have to remember, so
nothing makes one up for you, and nothing else creates an account. It is not shown as you type it
and no step prints it.

## Running without questions

With `--non-interactive`, with `--dry-run`, in CI, or with no terminal attached, the installer asks
nothing: every answer is a flag. A run that is missing any of them stops with **one** refusal that
names every flag still owed, rather than failing on the first.

```bash
npx create-endora-commerce@latest my-shop --non-interactive --no-demo \
  --admin-email you@example.com --admin-password "$ADMIN_PASSWORD" \
  --admin-first-name Ada --admin-last-name Lovelace
```

`--dry-run` reports every file and every step, writes nothing to your directory and starts
nothing. Where it needs the release's packages it still installs them into a temporary directory
(the module set cannot be derived otherwise), removes it, and says so.

## When a port or a name is already taken {#when-a-port-or-a-name-is-already-taken}

A machine that already runs a PostgreSQL, another shop or a second instance is the ordinary case,
so the installer checks before it writes anything.

- **The development services.** If a port one of them publishes is in use — another PostgreSQL on
  `5432`, say — the installer picks a free one, writes it into the instance's `.env` under the
  variable Compose reads (`POSTGRES_PORT`, `REDIS_PORT`, `MEILISEARCH_PORT`, `MAILPIT_SMTP_PORT`,
  `MAILPIT_UI_PORT`), derives the service's address from it and says so. A port you set in `.env`
  yourself is never moved: if it is taken, the installer stops with nothing written.
- **The API, the admin and the storefront** (`3001`, `3002`, `3000`). A taken default is replaced
  by a free port — the first free one from the default plus 10000, so `13001` — and written as
  `PORT` where that layer reads it: the instance's `.env`, `admin/.env`, the storefront's `.env`.
  Everything that names the address follows: the admin is built against the API's new address,
  the storefront's two backend addresses point at it, and the API's `CORS_ALLOWED_ORIGINS` lets
  the moved admin and storefront in. A `PORT` you set yourself is used as written; if the API's is
  busy, the closing summary says so.
- **The Compose project.** Compose names a project after its directory, so two instances both
  called `shop` would share one set of containers and one database. If a project of that name
  already has containers or volumes on this machine, the development services run under a name of
  their own (`<dir>-<six characters>`), written as `COMPOSE_PROJECT_NAME` into `.env` and said in
  the output. `pnpm run dev:services` and `dev:services:down` follow it, because Compose reads that
  file. A `COMPOSE_PROJECT_NAME` you set yourself is never replaced: taken, it is a refusal.

## Standing the components up separately {#one-component-per-machine}

In a larger installation the API, the admin panel and the storefront each run on a server of
their own. Two things describe such an installation, and the installer takes both as flags:
**which components this run stands up on this machine** (`--only`), and **how the three are
reached from a browser** — a name each, or one host with paths.

### Which components this run stands up

`--only` names the components **this run** stands up on **this machine**. The run is told where
the others are by origin — scheme and host, an optional port, no path
(`https://api.example.com`).

```bash
# on the API server
npx create-endora-commerce@latest api --only api --no-demo \
  --api-url https://api.example.com \
  --admin-url https://admin.example.com --storefront-url https://shop.example.com \
  --admin-email you@example.com --admin-password "$ADMIN_PASSWORD" \
  --admin-first-name Ada --admin-last-name Lovelace

# on the admin server — no database, no service, no administrator
npx create-endora-commerce@latest admin --only admin --api-url https://api.example.com

# on the storefront server — no instance at all
npx create-endora-commerce@latest shop --only storefront \
  --api-url https://api.example.com --storefront-url https://shop.example.com \
  --revalidate-secret "$REVALIDATE_SECRET"
```

| `--only` | Written at `<dir>` | Storefront | What it runs | Required beyond `<dir>` |
| --- | --- | --- | --- | --- |
| *(absent)*, or all three | the instance | beside it | everything on this page | the administrator, `--demo` or `--no-demo` |
| `api` | the instance, without the admin member | none | install, services, setup, the administrator, demo data if asked | the administrator, `--demo` or `--no-demo` |
| `api,admin` | the instance | none | as `api` | as `api` |
| `api,storefront` | the instance, without the admin member | beside it | as `api`, then the storefront's install | as `api` |
| `admin` | the instance, **with** its backend member | none | `pnpm install`, `pnpm run build:admin` | `--api-url` |
| `storefront` | **the storefront itself** — no instance | at `<dir>` | the storefront's `pnpm install` | `--api-url`, `--storefront-url`, `--revalidate-secret` |
| `admin,storefront` | the instance, with its backend member | beside it | `pnpm install`, `pnpm run build:admin`, the storefront's install | both rows above |

**Without `api`, the run touches no database.** It starts no service, migrates nothing, creates no
administrator and seeds nothing — and it refuses the flags that only make sense with an API
(`--demo`, `--no-demo`, `--admin-email` and the other administrator flags, `--no-services`), rather
than ignoring them. A run that writes no instance refuses `--without`, `--module`, `--deployment`
and `--topology` for the same reason.

**The admin alone is the same instance tree.** The admin's screens come from the module packages
the instance installs, so an admin built on its own still needs that list: the run writes the
whole tree, backend member included, runs `pnpm install` and builds one thing from it,
`admin/dist`. The API origin goes into `admin/.env` as `VITE_API_BASE_URL`. Serve `admin/dist` with
`pnpm run preview:admin`, or with any static web server that answers unknown paths with
`index.html`.

**The storefront alone is given the secret, never a new one.** `REVALIDATE_SECRET` is one value
held by two machines. A run with `api` and no storefront generates it once (or writes the one you
pass), puts it in the instance's `.env`, says which file and does not print it. Copy it from there
into `--revalidate-secret` on the storefront's machine. `--sales-channel <code>` names the Sales
Channel the storefront sells on; left out, it is `default`, the code the platform creates its
default channel with.

**At a terminal** the same choices are questions. Uncheck a component in the parts checklist and
the run asks how the three are reached — a name each, or one address with paths — and then for the
addresses that layout needs. Without the API it asks for the API's origin and, for a storefront,
the storefront's own origin, the Sales Channel code and `REVALIDATE_SECRET` (not shown as you
type). With the API it offers the three addresses with their development values, and Enter keeps
each.

When an address you give is a `localhost` one with a port — `--storefront-url
http://localhost:4000` — it is also the port that component is served on, on this machine: the
run writes it as `PORT` where the component reads it.

### How the three are reached

Two layouts are supported. Both keep the three on one site, which the session cookies require.

#### A name each

`api.example.com`, `admin.example.com`, `shop.example.com`. This is what `--api-url`,
`--admin-url` and `--storefront-url` describe, as in the example above. The three names must share
one registrable domain.

#### One host, with paths {#one-host-with-paths}

The storefront at `/`, the admin under `/admin`, the API under `/api`:

```bash
npx create-endora-commerce@latest my-shop --public-url https://example.com
```

`--public-url` is the three addresses in one flag — `--api-url https://example.com`,
`--storefront-url https://example.com` and `--admin-url https://example.com/admin` — and is
refused beside any of those three. It works with `--only` as well, on each machine in turn, and
without it, for all three on one machine behind one reverse proxy.

Three things are particular to this layout:

- **The API's address is the host itself**, not `https://example.com/api`. The API's routes already
  begin with `/api/v1`, so whatever answers on the host passes `/api/` on unchanged. `--api-url`
  with a path is refused, and says this.
- **The admin is built for its path.** The run writes `ADMIN_BASE_PATH=/admin/` into `admin/.env`;
  the admin's asset addresses and its screens' addresses all start there. Like the API origin it
  is fixed when the admin is built. `--admin-url` takes any base path
  (`https://example.com/back-office`), not only `/admin`.
- **Something has to route by path**, and the closing summary lists the routes: `/api/` and
  `/assets/file/` to the API; `/api/revalidate`, exactly, to the storefront (it is the one route
  under `/api` that is the storefront's own); `/admin/` to the admin, answering its `index.html`
  for every path it does not hold; everything else to the storefront. The instance's
  `deploy/nginx.paths.example.conf` is that routing written out for nginx.

The browser's requests are same-origin in this layout, so `CORS_ALLOWED_ORIGINS` — which the run
still writes, with the one origin in it — matters only to a client on another origin. A storefront
page at `/admin` or `/api` can never be reached, so reserve both words in the `cms` module's
reserved-segments Setting.

### What the machines owe each other

The closing summary of a run that stands up only some components prints these. None of them can be
checked from one machine, because the other side of each is somewhere else.

1. **The API lets a browser in by origin.** `CORS_ALLOWED_ORIGINS` in the API's `.env` must contain
   the admin's and the storefront's public origins exactly as a browser sends them: scheme, host,
   port, no trailing slash. `--admin-url` and `--storefront-url` on the API's run write it; an
   origin you do not give stays at its development address (`http://localhost:3002`,
   `http://localhost:3000`).
2. **The API origin is fixed when the admin and the storefront are built.** `VITE_API_BASE_URL` and
   `NEXT_PUBLIC_API_BASE_URL` are written into the bundles, so a changed API origin means building
   both again, not restarting them.
3. **The three public origins must be same-site** — one registrable domain, or one host with
   paths. The session cookies are `SameSite=Lax`, so a browser does not send them from a page on
   another site. Nothing checks this for you.
4. **An admin shows the screens of the modules its own tree installed.** Build it from the same
   release as the API, with the same `--module` list if you gave the API one.
5. **The API and the storefront hold one `REVALIDATE_SECRET`**, and the API's
   `STOREFRONT_BASE_URL` is the storefront's origin: that pair is how the API asks the storefront
   to refresh a cached page. With two different values the storefront refuses every refresh and
   nothing reports it.

## Every flag

| Flag | What it does |
| --- | --- |
| `<dir>` | Where the instance goes — or the storefront, with `--only storefront`. It must be empty, or hold nothing but a `.env` you placed there. |
| `--only <component>` | Which of `api`, `admin`, `storefront` this run stands up on this machine. Repeatable, or comma-separated. Absent: all three. |
| `--public-url <origin>` | One host with paths: the storefront at `/`, the admin under `/admin`, the API under `/api`. Stands for the three address flags below, and is refused beside any of them. |
| `--api-url <origin>` | The API's public origin. Required without `api` in `--only`; with it, what the API is told its own public address is. |
| `--admin-url <origin>[/<path>]` | Where the admin is served. With `api`: its entry in `CORS_ALLOWED_ORIGINS` and `ADMIN_BASE_URL`. With `admin`: the base path the bundle is built for, when the address has one. |
| `--storefront-url <origin>` | Where the storefront is served. Required for a storefront without `api`; with `api`, the API's allow-list entry and `STOREFRONT_BASE_URL`. |
| `--sales-channel <code>` | The Sales Channel a storefront stood up without `api` sells on. Default `default`. |
| `--revalidate-secret <secret>` | The secret the API and the storefront share. Required for a storefront without `api`; otherwise generated once when not given, written and never printed. |
| `--admin-email`, `--admin-password`, `--admin-first-name`, `--admin-last-name` | The administrator you sign in as. All four are required when the run stands up the API. |
| `--demo` / `--no-demo` | Seed every installed module's example data, or not. Required when the run stands up the API; no default. |
| `--no-services` | Do not start PostgreSQL, Redis, Meilisearch and Mailpit, and do not write their addresses into `.env`. |
| `--without <member>` | Do not write `admin` or `docs`. Repeatable. |
| `--no-storefront` | Write the instance alone, without the storefront beside it. |
| `--storefront-dir <path>` | Where the storefront goes. Default `<dir>-storefront`; it may not be inside the instance. |
| `--module <id>` | Install an explicit module set instead of the open-source set. Repeatable. |
| `--deployment <name>` | The directory under `apps/` for your overlay modules, and the value of `DEPLOYMENT` in `.env`. Default: the workspace name. |
| `--registry <url>` | Install `@endora-commerce/*` from this registry, in the instance and in the storefront. Writes an `.npmrc` in each that refers to the token through an environment variable, never as a value. |
| `--topology single-host` / `three-host` | Which machine layout the example deployment files in `deploy/` describe. It selects files; nothing reads it back. |
| `--non-interactive` | Ask nothing, even at a terminal. |
| `--dry-run` | Report every file and every step; write nothing to your directory and start nothing. |

## The second command: `pnpm run dev:all`

Run it from the instance's root. It starts, in one terminal, with each line labelled by its layer:

- the **API** on `http://localhost:3001`, or on the `PORT` the instance's `.env` sets;
- the **admin** — the bundle the install built, served on its own port: `3002`, or the `PORT` in
  `admin/.env`;
- the **storefront**, when there is one beside the instance at `<dir>-storefront`, in development
  mode, on `3000` or the `PORT` in its own `.env`. A storefront somewhere else is named with
  `pnpm run dev:all --storefront-dir <path>`.

Ctrl-C stops all of them, and if any one of them ends, the others are stopped and the one that
ended is named. Each layer keeps its own command — `pnpm run start` for the API,
`pnpm run preview:admin` for the admin, the storefront's own `pnpm run dev` — and builds and deploys
on its own; `dev:all` changes none of them. `pnpm run dev` starts the API alone and restarts it as
you edit your own modules.

Mail the instance sends in development is caught by Mailpit, whose address the first command
prints, and never leaves your machine. `pnpm run dev:services:down` stops the development services
and keeps their data; `pnpm run dev:services` starts them again.

## Creating an administrator {#creating-an-administrator}

The installer creates the administrator you sign in as. Every other account — a colleague's, or a
replacement for a lost one — is created from the command line, and the admin's sign-in screen links
here for that reason. The command is the same everywhere; how you reach it depends on where the
platform runs:

| Where | Command |
| --- | --- |
| An instance, on your machine (from its root) | `pnpm run admin:create -- --email=… --password=… --first-name=… --last-name=…` |
| A production image | `node dist/cli.js admin_users create --email=… --password=… --first-name=… --last-name=…`, run in the backend container — see [D1 of the first deployment checklist](./deployment/first-deployment-checklist.md#d1-create-the-bootstrap-administrator-then-narrow-it) |
| A checkout of the Endora Commerce repository | `pnpm --filter backend run admin:create -- --email=… --password=… --first-name=… --last-name=…` |

`--password-stdin` in place of `--password=…` reads the password from standard input, which keeps
it out of the process list, the package manager's echo of the script and your shell history — the
installer creates your administrator that way.

The account gets the `platform_admin` role — every permission — unless you pass `--role=<code>` naming
a role that already exists; the role itself is created on the first run. Running the command again
for an e-mail that already exists resets that account's password, name and role, which is also how
a lost password is recovered. If you have no shell on the machine the platform runs on, ask whoever
operates it to create the account for you.

## The storefront

The installer writes the storefront beside the instance unless you uncheck it in the parts question
or pass `--no-storefront`. It is a copy of the reference storefront that travels inside the
installer, so it needs no checkout of the Endora Commerce repository: every file is already
rewritten to stand on its own, and the `@endora-commerce/*` packages it depends on are the versions
of the release you installed. From then on it is your repository — nothing upgrades it and nothing
reports back.

One thing is left out of that copy and the installer names it: the reference storefront's
screenshot baselines for its visual tests. They are pictures of the reference shop on the machine
that recorded them; `pnpm exec playwright test --update-snapshots` records your own. Inside a
checkout of the repository the storefront is copied from the checkout instead, baselines included.

`pnpm run dev:all` starts the storefront in development mode with the other layers. To serve it the
way production does, build and start it in the storefront's directory:

```bash
pnpm run build && pnpm run start
```

`start` serves the build `build` produced, on the `PORT` in the storefront's `.env`; if the tree
was not built, it says to run `pnpm run build`.

**Adding a storefront later** is `endora new storefront <dir>`, run from anywhere. The storefront
and the instance must share one secret, `REVALIDATE_SECRET` — the key the backend uses to ask the
storefront to refresh a cached page. When the installer writes both trees it generates that value
once and writes it into both. When the storefront comes later, nothing does that for you:

1. Choose one value (for example `openssl rand -hex 32`).
2. Set `REVALIDATE_SECRET` to it in the instance's `.env`, and set `STOREFRONT_BASE_URL` there to
   the storefront's address.
3. Give the storefront the same value — `endora new storefront <dir> --revalidate-secret <value>`,
   or its own `.env`.

Without step 2 the backend simply does not ask the storefront to refresh, and pages change only
when their cache expires. With two different values, the storefront refuses every refresh and
nothing reports it.

## From your machine to production

Everything above is a development setup: the services run in Docker on your machine and the
storefront in development mode. The instance carries what you need for the next step in its own
`deploy/` directory, and every file there is an **example** — nothing applies it and nothing reads
it back. Copy what you need onto the machines you run, and own it from then on.

- `deploy/README.md` — the order to bring the stack up in, and what the machines owe each other.
- `deploy/Dockerfile.backend` and `deploy/Dockerfile.admin` — example images for the API (and its
  queue consumers) and for the admin bundle. They build from the instance's root; the commands and
  every `--build-arg` are in each file's header.
- A Compose example and an `.env.example` for the machine layout you chose with `--topology`:
  `single-host` (the default) puts every layer on one machine; `three-host` writes one Compose
  file and one `.env.example` per machine for a backend, a storefront and an admin.
- `deploy/nginx.example.conf` — a reverse-proxy block per public name — and
  `deploy/nginx.paths.example.conf`, its alternative for
  [one host with paths](#one-host-with-paths). Use one or the other.

Before the instance takes real orders, work through the
[first production deployment checklist](./deployment/first-deployment-checklist.md): the secrets
to generate, the settings only you can choose, and the seeds that must not run.

## Where to go next

- [Create your first Module](./create-your-first-module.md) — a 20-minute tutorial that adds a
  module of your own to the instance you just installed.
- [Modules](./modules/README.md) — what each module does, its settings, permissions and screens.
- [Module lifecycle](./modules/lifecycle.md) — installing, enabling, disabling and uninstalling a
  module from the command line.
- [Customisation ladder](./architecture/customisation-ladder.md) and
  [overlay modules](./architecture/overlay-pattern.md) — changing behaviour without editing the
  platform.
- [First production deployment checklist](./deployment/first-deployment-checklist.md) — before an
  instance takes real orders.
