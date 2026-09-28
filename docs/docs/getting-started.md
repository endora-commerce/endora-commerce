---
title: Getting started
description: Install a new Endora Commerce instance with two commands — what the installer asks, the flags that answer it, and what a first run does not give you yet.
sidebar_position: 2
---

# Getting started

Two commands give you a running Endora Commerce on your own machine: an API, an admin panel and,
where one can be written, a storefront. This page is the reference for those two commands — every
question the installer asks, the flag that answers it, and the limits of a first run today. The
repository's `README.md` is the short version.

> **Before the first public release** the packages are not on the public npm registry yet, so
> `npx create-endora-commerce` and `npx @endora-commerce/cli` do not resolve. Until then, run
> Endora Commerce from a clone of the repository by following its `README.md`, section
> *Developing Endora Commerce*.

## What you need

- **Node.js ≥ 22.18** — the instance's own `package.json` declares the same range, and the
  installer refuses to start on an older Node rather than write a tree its manifest rejects.
- **pnpm** — `corepack enable` provides it. If neither `pnpm` nor `corepack` is on your `PATH`,
  the installer refuses and says so.
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
2. **Writes the instance** — an ordinary pnpm workspace you own. The platform, the admin shell and
   every module arrive as dependencies; no file of the platform is copied into your tree.
3. **Writes the storefront**, as its own repository beside the instance (only from inside a
   checkout of the repository — see [What a first run does not give you](#what-a-first-run-does-not-give-you)).
4. **Starts the development services** with `docker compose` and writes their addresses into the
   instance's `.env`.
5. **Installs, generates, builds and migrates**, installs every module, and creates your
   administrator.
6. **Seeds demo data**, if you asked for it. Seeding runs last, and a failure in it does not fail
   the install.
7. **Prints what to run next**, including every answer it took as a recommendation and how to
   reverse it.

A failing step stops the run with that step's own exit code and prints what is left to do, so you
can finish by hand with the commands it echoed.

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

At a terminal, the installer asks what your flags did not answer — **at most seven questions**. A
question answered by a flag is not asked; the installer lists those answers once, before the first
question. Pressing Enter accepts the recommendation where there is one, and the closing summary
names every recommendation you accepted this way.

| Question | Recommendation (Enter) | Flag that answers it |
| --- | --- | --- |
| Where the instance goes | `./endora-commerce` | the `<dir>` argument |
| Which parts to write | every part | `--without <member>`, `--no-storefront`, `--storefront-dir <path>` |
| Whether to start the development services | yes | `--no-services` |
| Whether to load demo data | **none** — you must answer | `--demo` or `--no-demo` |
| The administrator's e-mail | none | `--admin-email <address>` |
| The administrator's password | none | `--admin-password <secret>` |
| The administrator's first and last name | none | `--admin-first-name <text>`, `--admin-last-name <text>` |

**Demo data has no recommendation on purpose.** A shop you are evaluating wants a catalogue,
customers and orders before the first screen; a shop you will sell from wants none of it. An empty
answer asks again. If you change your mind later, `pnpm run cli demo seed` adds demo data and
`pnpm run cli demo reset` withdraws it, leaving your own rows alone.

**The administrator is never generated.** The password is the one value you have to remember, so
nothing makes one up for you, and nothing else creates an account.

**The parts** are the instance's members and the storefront. The backend is always written. `admin`
(the admin panel) and `docs` (a documentation site for your instance) can be left out with
`--without admin` or `--without docs`. The storefront is written as a **sibling** directory,
`<dir>-storefront` by default — never inside the instance, where the instance's workspace would
swallow it.

## Running without questions

With `--non-interactive`, with `--dry-run`, in CI, or with no terminal attached, the installer asks
nothing: every answer is a flag. A run that is missing any of them stops with **one** refusal that
names every flag still owed, rather than failing on the first.

```bash
npx create-endora-commerce@latest my-shop --non-interactive --no-storefront --no-demo \
  --admin-email you@example.com --admin-password "$ADMIN_PASSWORD" \
  --admin-first-name Ada --admin-last-name Lovelace
```

`--dry-run` reports every file and every step, writes nothing to your directory and starts
nothing. Where it needs the release's packages it still installs them into a temporary directory
(the module set cannot be derived otherwise), removes it, and says so.

### Every flag

| Flag | What it does |
| --- | --- |
| `<dir>` | Where the instance goes. It must be empty, or hold nothing but a `.env` you placed there. |
| `--admin-email`, `--admin-password`, `--admin-first-name`, `--admin-last-name` | The administrator you sign in as. All four are required. |
| `--demo` / `--no-demo` | Seed every installed module's example data, or not. Required; no default. |
| `--no-services` | Do not start PostgreSQL, Redis, Meilisearch and Mailpit, and do not write their addresses into `.env`. |
| `--without <member>` | Do not write `admin` or `docs`. Repeatable. |
| `--no-storefront` | Write the instance alone. Required outside a checkout of the repository in non-interactive runs. |
| `--storefront-dir <path>` | Where the storefront goes. Default `<dir>-storefront`; it may not be inside the instance. |
| `--module <id>` | Install an explicit module set instead of the open-source set. Repeatable. |
| `--deployment <name>` | The directory under `apps/` for your overlay modules, and the value of `DEPLOYMENT`. Default: the workspace name. |
| `--registry <url>` | Install `@endora-commerce/*` from this registry. Writes an `.npmrc` that refers to the token through an environment variable, never as a value. |
| `--topology single-host` / `three-host` | Which machine layout the example deployment files in `deploy/` describe. It selects files; nothing reads it back. |
| `--non-interactive` | Ask nothing, even at a terminal. |
| `--dry-run` | Report every file and every step; write nothing to your directory and start nothing. |

## The second command: `pnpm run dev:all`

Run it from the instance's root. It starts, in one terminal, with each line labelled by its layer:

- the **API** on `http://localhost:3001`;
- the **admin** — the bundle the install built, served on its own port (`3002` unless the admin's
  `PORT` says otherwise);
- the **storefront**, when there is one beside the instance at `<dir>-storefront`. A storefront
  somewhere else is named with `pnpm run dev:all -- --storefront-dir <path>`.

Ctrl-C stops all of them, and if any one of them ends, the others are stopped and the one that
ended is named. Each layer keeps its own command — `pnpm run start` for the API,
`pnpm run preview:admin` for the admin, the storefront's own `pnpm run dev` — and builds and deploys
on its own; `dev:all` changes none of them.

Mail the instance sends in development is caught by Mailpit, whose address the first command
prints, and never leaves your machine. `pnpm run dev:services:down` stops the development services
and keeps their data.

## What a first run does not give you

**No storefront outside a checkout of the repository.** The storefront is copied from the reference
storefront in the Endora Commerce repository. Run anywhere else, the parts question shows the
storefront unchecked, with the reason, and does not let you check it; a non-interactive run needs
`--no-storefront`. The instance, the API and the admin are complete without it.

**Adding a storefront later** is `endora new storefront <dir>`, run from a checkout. The storefront
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

## Where to go next

- [Modules](./modules/README.md) — what each module does, its settings, permissions and screens.
- [First production deployment checklist](./deployment/first-deployment-checklist.md) — before an
  instance takes real orders.
- [Customisation ladder](./architecture/customisation-ladder.md) and
  [overlay modules](./architecture/overlay-pattern.md) — changing behaviour without editing the
  platform.
