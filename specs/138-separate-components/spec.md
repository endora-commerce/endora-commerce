# Feature Specification: stand each component up on its own

**Feature directory**: `specs/138-separate-components/`
**Created**: 2026-10-02
**Status**: Accepted — the owner accepted ruling D-284 on 2026-10-02, with clause 5 amended (below)
**Input**: owner ruling of 2026-10-02 — *"In the project there should be the possibility of
standing up the API separately, the Admin UI separately and the Storefront separately — in a more
complex project each of these instances may be on a different server, so it should be possible to
configure it that way."*

## Summary

`endora install` (and `npx create-endora-commerce`, which is its front door and adds no argument
of its own) stands up three components — the **API**, the **Admin UI** and the **storefront** —
on one machine, and only on one machine. This feature lets one run stand up **any non-empty
subset** of the three, told where the others are by URL, through flags and through the wizard.

## User scenarios

**US1 — the API alone (P1).** An operator on the API server runs the command with only the API
selected. They get a headless instance, migrated, with an administrator, and are asked where the
admin and the storefront will be served so the API allows their browsers in.

**US2 — the Admin UI alone (P1).** An operator on a second server runs the command with only the
admin selected and the API's public origin. They get a built admin bundle bound to that origin.
No database, no services, no migration and no administrator account are touched.

**US3 — the storefront alone (P1).** An operator on a third server runs the command with only the
storefront selected, the API's public origin, the storefront's own public origin and the secret
the API already holds. They get a storefront repository with a filled-in `.env`, and no instance.

**US4 — all three (P1).** A run that selects nothing is today's run: same files, same pipeline,
same output.

## Functional requirements

### The selection

- **FR-001** `endora install` accepts `--only <component>[,<component>...]`, repeatable, over the
  vocabulary `api`, `admin`, `storefront`. Absent, all three are selected and the run is
  byte-for-byte today's (US4).
- **FR-002** An unknown name, an empty selection, and a flag that answers a question the selection
  removed (FR-010) are each one sentence in the command's single collected refusal, exit 1, nothing
  written.
- **FR-003** `--only` composes with the existing flags and never restates them: a selection
  without `storefront` behaves as `--no-storefront`; a selection without `admin` behaves as
  `--without admin`; `docs` is not a component and stays `--without docs`. Naming both spellings
  of one decision consistently is accepted; naming them in contradiction
  (`--only admin --without admin`, `--only storefront --no-storefront`) is refused.
- **FR-004** `--without backend` stays refused. Its sentence names `--only admin` as the way to
  stand the admin up on a machine of its own.

### What each selection writes and runs

- **FR-005** With `api` selected the instance tree is written and the full pipeline runs
  (`install`, `services` unless `--no-services`, `setup`, `admin`, `demo` when asked), exactly as
  today.
- **FR-006** With `admin` selected and `api` not, the instance tree is written **with its backend
  member**, and the pipeline is `install` then `build-admin` (`pnpm run build:admin`). The
  `services`, `setup`, `admin` and `demo` steps are not planned, and no step opens a connection
  to PostgreSQL, Redis or Meilisearch.
- **FR-007** With `storefront` selected and neither `api` nor `admin`, **no instance tree is
  written**: `<dir>` is the storefront's own directory, and the pipeline is `storefront-install`
  alone.
- **FR-008** With `admin` and `storefront` selected and `api` not, FR-006 and FR-007 both hold:
  the tree at `<dir>`, the storefront at `--storefront-dir` (default `<dir>-storefront`).
- **FR-009** `--dry-run` reports the same plan for every selection and writes nothing.

### The questions a selection removes

- **FR-010** When `api` is not selected, the demo question, the three administrator questions and
  the services question are **not asked and not required**; `--demo`, `--no-demo`, `--admin-*`,
  `--no-services`, and — when no tree is written (FR-007) — `--without`, `--module`,
  `--deployment` and `--topology` are refused as naming something this run does not have.

### The other machines

- **FR-011** New flags, each a public origin (`http` or `https`, host, optional port, no path, no
  trailing slash — anything else is refused): `--api-url`, `--admin-url`, `--storefront-url`.
  One more: `--sales-channel <code>`. `--revalidate-secret` already exists.
- **FR-012** When `api` is **not** selected, `--api-url` is required. It is written as
  `VITE_API_BASE_URL` in `admin/.env` when the admin is selected, and as
  `NEXT_PUBLIC_API_BASE_URL` and `BACKEND_BASE_URL` in the storefront's `.env` when the storefront
  is.
- **FR-013** When `storefront` is selected and `api` is not, `--storefront-url`
  (`NEXT_PUBLIC_SITE_URL`) and `--revalidate-secret` (`REVALIDATE_SECRET`) are required, and
  `--sales-channel` (`NEXT_PUBLIC_SALES_CHANNEL_CODE`) is offered with the recommendation
  `default` — the code the platform creates its default Sales Channel with. A run without the API
  **never generates** the secret.
- **FR-014** When `api` is selected, `--api-url`, `--admin-url` and `--storefront-url` are
  **accepted** — in every selection, the one with no `--only` included — and are **asked** only
  when the selection is not all three: `--api-url` always, `--admin-url` when the admin is not
  selected, `--storefront-url` when the storefront is not (contract §7.3, R7.9). Each one given is
  written into the instance's `.env`: `PUBLIC_API_BASE_URL` from the first, `ADMIN_BASE_URL` from
  the second, `STOREFRONT_BASE_URL` from the third, and `CORS_ALLOWED_ORIGINS` as the admin's and
  the storefront's origins, comma-separated — an origin not given standing as its development
  address (`http://localhost:3002`, `http://localhost:3000`, or the port §7.3a decided). None
  given and no port moved, nothing is written and the platform's development fallbacks apply, as
  today. When the admin is also selected, `--api-url` is written as `VITE_API_BASE_URL` in
  `admin/.env` too.
- **FR-015** When `api` is selected and `storefront` is not, `REVALIDATE_SECRET` is written into
  the instance's `.env` — `--revalidate-secret` verbatim, otherwise generated once — and the
  closing block names the file it is in and says the storefront's run must be given the same
  value. The value itself is not printed.
- **FR-016** A value this run writes never overwrites one the operator already answered in an
  existing `.env`.

### The wizard

- **FR-017** The parts question lists `api`, `admin`, `storefront`, then every non-component
  member the template declares (`docs` today), all toggleable and pre-checked. A selection with
  none of the three components re-asks. Enter on the untouched list is the recommendation
  *everything*, and produces the argv a run with no selection flag has.
- **FR-018** After it, and only when the selection is a strict subset, the wizard asks the
  questions FR-012–FR-014 make applicable, in that order, each skipped when its flag was given.
  A required one re-asks on an empty line; the secret is read without echo; an offered one takes
  its recommendation on Enter and is reported as recommended.
- **FR-019** Every wizard question has a flag, and a `--non-interactive` run supplying them
  writes the tree the wizard would have written. The `[answers]` line counts the questions
  applicable to the run's selection.

### What the run tells the operator

- **FR-020** The closing block lists start commands **only for the selected components**, and for
  a strict subset adds, under one heading, what the other machines owe this one: the API's
  `CORS_ALLOWED_ORIGINS` must contain the admin's and the storefront's origins; the admin bundle
  and the storefront's browser values are bound to the API origin **at build time**, so a changed
  origin is a rebuild; the three public origins must be **same-site** (one registrable domain),
  because both session cookies are `SameSite=Lax`; and an admin built here shows the screens of
  the modules **this** tree installed, so the tree must declare the module set the API composes.
- **FR-021** `deploy/README.md` states the same four facts for `--topology three-host`.

### Acceptance

- **FR-022** `acceptance:separate-components` stands each component up alone, on a port of its
  own that is none of the development defaults, and proves S1–S7 of
  `specs/110-instance-repository/contracts/instance-tree.md` §7.4.

## Success criteria

- **SC-001** Each of the three single-component runs completes with `--non-interactive` and with
  the wizard, exit 0, on a machine holding none of the other two.
- **SC-002** An admin built by US2 and a storefront built by US3 complete a signed-in request
  against an API stood up by US1, each from its own origin.
- **SC-003** A run with no `--only` plans the step list it planned before this feature.

## Out of scope

- Cross-site hosting (the admin or the storefront on a different registrable domain from the
  API). It needs `SameSite=None; Secure` cookies and is a security decision of its own — open
  question Q1.
- A runtime-configurable API origin for the admin bundle (one image promoted between
  environments). Today's rule — one bundle, one origin — is kept and stated.
- Adding a component to a directory that already holds one. `endora install` never merges into a
  non-empty directory, and this feature does not change that.

## Ruling — D-284

> **D-284 (accepted by the owner, 2026-10-02, clause 5 as amended by the owner) — what a run stands up is a third axis, and the tree keeps its
> backend.**
>
> 1. `endora install` takes `--only <api|admin|storefront>[,...]`. It selects which components
>    **this run stands up on this machine**. It is not a statement about the repository
>    (`--without`) and not about the example deployment files (`--topology`), and it replaces
>    neither.
> 2. The refusal of `--without backend` **stands**, and D-215's reason for it is unchanged: the
>    module list is the instance root's `dependencies`, the admin's screen registry is derived
>    from the packages that list installs, and a tree without the member that composes them is a
>    second module list in a second repository with nothing to hold it to the first. An
>    admin-only run therefore writes the same tree and **builds one artefact from it**. What this
>    ruling amends is the refusal's remedy: it names `--only admin`.
> 3. `REVALIDATE_SECRET` stays `generable: false`. The narrowing D-269 made — one run over both
>    trees may generate it once — is extended by one case and no further: a run that stands up
>    the **API** may originate the value; a run that does not must be given it.
> 4. Outside the wizard, the questions a selection removes are not required, and a flag
>    answering one of them is refused rather than ignored.
> 5. Two layouts are supported, and both are same-site: **(a)** subdomains of one registrable
>    domain — one host name per component; **(b)** one host with paths — the storefront at `/`,
>    the admin under `/admin`, the API under `/api`. Cross-site hosting is not ruled here.

Clause 5 was proposed as *"Supported layouts are same-site"* and amended by the owner when
accepting the ruling: *"in 5 I would give the option of subdomains of one domain, or the format
`domain/admin` for the admin UI and `domain/api` for the API, as both supported solutions."* Layout
(a) is FR-001…FR-022; layout (b) is the addendum below (FR-023…FR-032).

## Addendum — layout (b): one host with paths

Added for D-284 clause 5 (b). Everything above stands; this section adds the second supported
layout. Tasks T12–T20 in `tasks.md`.

### What the code says (measured on `feat/138-separate-components` at `8af78c8a8`)

| Fact | Where |
| --- | --- |
| Every route the API registers is already under `/api/v1/…`, with **one** exception: the public asset route `/assets/file/:assetId` | `packages/modules/*/src/backend/routes*.ts`; `packages/modules/assets_library/src/backend/routes.public.ts` |
| The storefront serves one route of its own under `/api`: `/api/revalidate`, which the API calls at `STOREFRONT_BASE_URL` | `storefront/app/api/revalidate/route.ts`, `packages/platform/src/http/storefront-revalidator.ts` |
| The storefront serves nothing under `/admin` or `/assets`; its service worker passes `/api/` through and handles every other same-origin request | `storefront/app/reserved-segments.ts`, `storefront/public/service-worker.js` |
| The admin mounts `<BrowserRouter>` with no `basename`, and its Vite configuration sets no `base` | `packages/admin-shell/src/AdminRoot.tsx`, `adminViteConfig` in `packages/cli/src/new-instance/template.ts` |
| Two admin screens link with a raw absolute `href` instead of the router | `packages/modules/blog/src/admin/pages/BlogCategoryTreePage.tsx`, `packages/modules/catalog/src/admin/components/ProductsBulkEditDialog.tsx` |
| Both session cookies are `Path=/` and carry different names, so one host serves both | `packages/modules/admin_users/src/backend/routes.public.ts`, `packages/modules/customers/src/backend/routes.register.ts` |

### Decisions

**D8 — "the API under `/api`" is a real mount, not a stripped prefix.** The API's routes already
begin with `/api/v1`, so in layout (b) the API's public origin **is the host**: a proxy passes
`/api/` to the API unchanged, and `--api-url` stays an origin with no path. *Rejected*: a prefix
the proxy strips (`/api/api/v1/…` in every URL, and a second address for the same route).

**D9 — the admin is the only component with a base path.** `/admin` is a path the admin is
*built for* (asset URLs, the router's basename), so it is a build-time value like the API origin.

**D10 — the layout is one flag.** `--public-url <origin>` names the one host; the three addresses
are derived from it. Typing three URLs that must agree is three chances to disagree.

### Functional requirements

- **FR-023** `--admin-url` accepts a **base path** after the origin: one or more segments of
  `[A-Za-z0-9._~-]`, no trailing slash, no query, no fragment, no `.`/`..` segment
  (`https://example.com/admin`). `--api-url` and `--storefront-url` stay origins and refuse a
  path, each with a sentence saying why (D8; the storefront is served at `/`).
- **FR-024** `--public-url <origin>` selects layout (b). It is `--api-url <origin>`,
  `--storefront-url <origin>` and `--admin-url <origin>/admin` in one flag, each applied where the
  selection has a use for it. Giving it together with any of those three is refused. It satisfies
  the `--api-url` and `--storefront-url` requirements of FR-012/FR-013.
- **FR-025** `--admin-url` is accepted whenever `admin` **or** `api` is in the run (it was
  refused without `api`): for the admin it is the address the bundle is built for.
- **FR-026** When the admin's address has a base path and the admin member is written,
  `ADMIN_BASE_PATH=<path>/` is written into `admin/.env`; the scaffolded Vite configuration reads
  it as `base`, and the admin shell's router takes its basename from the bundle's own base. With
  no base path nothing is written and the bundle is the one built today.
- **FR-027** With `api` in the run, `ADMIN_BASE_URL` is the admin's full address, path included;
  `CORS_ALLOWED_ORIGINS` holds **origins** only, each once — in layout (b) that is one entry.
- **FR-028** The closing block of a layout (b) run states the routing the one host owes:
  `/api/` and `/assets/file/` to the API, `/api/revalidate` (exactly) and everything else to the
  storefront, `/admin/` to the admin with `index.html` as the fallback; and that the browser's
  requests are same-origin, so the allow-list matters only to a client on another origin.
- **FR-029** `deploy/` gains `nginx.paths.example.conf` for the single-host topology — one
  `server` block with those routes — and `deploy/README.md` and `Dockerfile.admin` say how the
  admin image is built for a base path.
- **FR-030** The wizard, for a strict subset, asks the layout before any address:

  ```
  How are the API, the admin and the storefront reached?
     1. one address each — api.example.com, admin.example.com, shop.example.com
     2. one address, with paths — the storefront at /, the admin under /admin, the API under /api
  [1] 
  ```

  `2` asks one question — `The address, e.g. https://example.com: ` — and none of the three
  address questions. Enter is `1`, and the questions of FR-018 follow as before. The question is
  skipped when any address flag was given.
- **FR-031** The storefront does not answer under `/admin`: its service worker leaves `/admin`
  requests alone, as it leaves `/api/`. A CMS page slugged `admin` or `api` would be unreachable
  in this layout; `deploy/README.md` says to reserve both in the `cms` reserved-segments Setting.
- **FR-032** `acceptance:separate-components --layout paths` stands the three up behind one
  reverse proxy on one port and proves P1–P6 of contract §7.6.

### Not in this addendum

A base path for the storefront or for the API; a second admin base path chosen by the wizard
(`--admin-url` takes any); TLS in the example beyond what `nginx.example.conf` already leaves to
certbot.

## Open questions

- **Q1 — answered by D-284 clause 5 as amended (2026-10-02):** subdomains of one domain and one
  host with paths are the two supported layouts; a different registrable domain stays unruled.
  The question as it was asked: Must the admin or the storefront be hostable on a **different
  registrable domain** from the API (`admin.agency.io` against `api.shop.com`)? The code says no
  today: `packages/modules/admin_users/src/backend/routes.public.ts` and
  `packages/modules/customers/src/backend/routes.register.ts` set host-only `SameSite=Lax`
  cookies, which a browser does not send on a cross-site `fetch`. Subdomains of one domain work.
- **Q2 [NEEDS CLARIFICATION]** Is an admin-only run on an empty machine the case the owner means,
  or is it always *"the instance repository already exists; build its admin on another host"*?
  This design serves the first by scaffolding and the second by the existing
  `deploy/Dockerfile.admin`; if only the second matters, FR-006 can be dropped.
