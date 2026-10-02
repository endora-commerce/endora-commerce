# Implementation Plan: stand each component up on its own

**Feature directory**: `specs/138-separate-components/` | **Date**: 2026-10-02 |
**Spec**: [spec.md](spec.md)

## Summary

One new flag on `endora install`, `--only`, three origin flags and one channel flag. The
selection is normalised onto mechanisms that already exist (`--without admin`, `--no-storefront`);
the genuinely new behaviour is two shortened pipelines and a handful of `.env` lines. No change to
`endora new instance`, to the template's file manifest, to the platform or to any module.

## Technical context

- **Language / stack**: TypeScript 5.x strict, Node.js ≥ 22.17, ESM. `@endora-commerce/cli` only.
- **New runtime dependency**: none. Origin validation is `new URL()`.
- **Storage / schema**: none.
- **Precondition**: the storefront being installable outside a checkout
  (branch `feat/storefront-from-registry`) lands first. Until it does, `--only storefront` meets
  the existing *"no checkout above"* refusal — correct, and not this feature's to repair.

## What the code reads today (measured on `origin/master`, 2026-10-02)

| Fact | Where |
| --- | --- |
| The admin bundle's API origin is `import.meta.env.VITE_API_BASE_URL`, inlined by Vite at build time, falling back to `http://localhost:3001` | `packages/admin-kit/src/lib/api-client.ts`, `packages/admin-shell/src/components/FederatedSignIn.tsx` |
| The admin calls the API with `credentials: 'include'` | `packages/admin-kit/src/lib/api-client.ts` |
| The admin session cookie is host-only, `SameSite=Lax`, `Secure` only under `NODE_ENV=production`; the customer cookie likewise | `packages/modules/admin_users/src/backend/routes.public.ts`, `packages/modules/customers/src/backend/routes.register.ts` |
| CORS is an exact-origin allow-list with `credentials: true`, from `CORS_ALLOWED_ORIGINS`, defaulting to `http://localhost:3000,http://localhost:3002` | `packages/platform/src/http/server.ts` |
| The API's own inputs naming the other two: `PUBLIC_API_BASE_URL`, `STOREFRONT_BASE_URL`, `REVALIDATE_SECRET` (platform), `ADMIN_BASE_URL` (`mfa`) | `packages/platform/src/env/index.ts`, `packages/modules/mfa/src/manifest.ts` |
| Revalidation is the API calling the storefront with `x-revalidate-secret`; unset on either side it is a silent no-op | `packages/platform/src/http/storefront-revalidator.ts`, `storefront/app/api/revalidate/route.ts` |
| The storefront's inputs: `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_SITE_URL` (build time), `BACKEND_BASE_URL` (run time), `NEXT_PUBLIC_SALES_CHANNEL_CODE`, `REVALIDATE_SECRET` | `storefront/environment-inputs.mjs` |
| The admin build needs an **installed workspace** and nothing running: `endora generate` scans the root `node_modules` for module packages, finds the admin project by its `"@/*"` alias, then `vite build` | `packages/cli/src/generate/index.ts`, `adminDockerfile` in `packages/cli/src/new-instance/deploy.ts` |
| The module list is the root `package.json`'s `dependencies`; the backend member is wiring files and holds no list | `packages/cli/src/new-instance/template.ts` |
| `--topology three-host` already writes one compose file and one `.env` example per machine from one tree | `packages/cli/src/new-instance/deploy.ts` |

## Decisions

**D1 — `--only` is a new axis, not an extension of `--without`.**
*Rationale*: `--without` is a statement about the tree and its vocabulary is the template's
members; the storefront is not one, and `backend` cannot leave the tree (D2). "Only the admin" in
that grammar is `--without backend`, which says something false about the repository.
*Rejected*: extending `--without` to `storefront`/`backend` — two meanings under one flag;
`--topology` — it selects example files and drives no pipeline; three separate commands — the
owner asked for one command, and `create-endora-commerce` adds no argument of its own.

**D2 — admin-only is the same tree with one build target, not a tree without the backend.**
*Rationale*: the evidence table's last three rows. The admin's registry is derived from the
packages the root manifest installs, and it must name exactly the modules the API composes — a nav
entry for a module the API lacks is a 404. A backend-less tree would still carry the full module
list, would need every root script that says `-C backend` made conditional, and would be a second
list nothing reconciles. Keeping the member costs a dozen inert wiring files and no machinery:
`deploy/Dockerfile.admin` already builds the admin from the whole tree with no service running.
*Rejected*: a backend-less instance (above); a standalone "admin project" scaffold — a third tree
shape, a third template, and the same module-list problem.
*Relation to the refusal*: unchanged, remedy amended — proposed D-284 clause 2.

**D3 — storefront-only writes no instance.** The storefront is its own repository and needs
nothing from the tree; `<dir>` is its directory. *Rejected*: writing an instance beside it "for
symmetry" — a tree nobody runs.

**D4 — origins are asked for only when the run is a strict subset, and written only when given.**
All three on one machine keeps the development fallbacks and today's output (SC-003).
*Rejected*: always asking — three questions the common case has no use for.

**D5 — `VITE_API_BASE_URL` goes in `admin/.env`, written by `install`, not by the template.**
Vite reads it for `dev`, `build` and `preview` alike, the root `.gitignore` already covers `.env`
at any depth, and the template's manifest (contract §2, guard T5) is untouched. *Rejected*: an
environment variable on the build step — lost on the first rebuild.

**D6 — the same-site rule is stated, not checked.** Deciding "same registrable domain" needs the
public-suffix list, which is a dependency; a two-label heuristic is wrong for `co.uk`. The closing
block and `deploy/README.md` say it, and the acceptance run proves the supported case.

**D7 — a flag for a removed question is refused.** A flag that silently does nothing is the
failure `assertTopology` already refuses for `--topology`; `--only storefront --demo` is the same
shape.

## Selection table (normative; mirrored in the contract §7.2)

| `--only` | Tree at `<dir>` | Storefront | Pipeline | Required beyond `<dir>` | Offered |
| --- | --- | --- | --- | --- | --- |
| *(absent)* / `api,admin,storefront` | yes | sibling | today's | today's | today's |
| `api` | yes, no admin member | no | install, services, setup, admin, [demo] | admin account, demo | `--api-url`, `--admin-url`, `--storefront-url` |
| `api,admin` | yes | no | as above | as above | as above |
| `api,storefront` | yes, no admin member | sibling | as above + storefront-install | as above | `--api-url`, `--admin-url` |
| `admin` | yes | no | install, build-admin | `--api-url` | — |
| `storefront` | **no** | at `<dir>` | storefront-install | `--api-url`, `--storefront-url`, `--revalidate-secret` | `--sales-channel` |
| `admin,storefront` | yes | sibling | install, build-admin, storefront-install | the two rows above | `--sales-channel` |

## Wizard wording

```
Which parts should this machine run? Type the numbers to toggle, Enter to accept.
   1. [x] api — the API and the workers — the part every other one talks to
   2. [x] admin — the operator interface, built as its own artefact
   3. [x] storefront — the shop, as its own repository beside the instance
   4. [x] docs — a documentation site rendering your modules' own pages
```

- Nothing of 1–3 checked: `  keep at least one of api, admin, storefront.` and the list again.
- API not selected: `Where is the API? Its public origin, e.g. https://api.example.com: `
- Storefront without API: `Where will this storefront be served? Its public origin, e.g.
  https://shop.example.com: `, then `Sales channel code [default]: `, then
  `REVALIDATE_SECRET, as the API's .env has it (not shown): `
- API selected, strict subset: `Where is this API reachable from the other machines?
  [http://localhost:3001] `, and for each absent component `Where will the admin be served?
  [http://localhost:3002] ` / `Where will the storefront be served? [http://localhost:3000] `
- A bad origin: `  that is not an origin: scheme and host, an optional port, no path.` and the
  question again.

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I Modular / XV untouched core | pass — `packages/cli` only; no module, no platform change |
| II API-first | n/a — no HTTP shape changes; the CLI's contract is edited first (`instance-tree.md` §7) |
| III TDD | pass — every FR maps to a test task in `tasks.md` |
| IV YAGNI / dependencies | pass — no new dependency (D6 is where one was declined) |
| VI / VIII naming, English | pass |
| XI tenancy, XII channels | pass — the channel code is asked for, never invented beyond the platform's own fallback |
| XIII, XIV, XVI, XVII | n/a — no write path, entity, admin surface or module presence changes |

**Verdict: pass, with no entry in Complexity Tracking.**

## Complexity Tracking

Empty. No new dependency, no new module, no new tree shape.

## Risks

- **Module-set drift** between an admin built on one machine and the API on another. Mitigated
  by FR-020's sentence and by the default (`moduleSeed: 'available'` — the same release yields
  the same set). Not eliminated: nothing can compare two machines.
- **`[answers] total`** becomes selection-dependent (FR-019). Any test pinning `total=7` moves.
- **The acceptance run needs free ports.** It must take them from the OS and never use
  3000/3001/3002/5432/6379/7700.

## Handoff

Implement from [tasks.md](tasks.md), in order. Everything is under `packages/cli/` except the
acceptance script. Re-derive every premise in the evidence table before relying on it — it was
measured on `origin/master` at `92b67bc93` and the storefront branch will have moved
`install/index.ts` and `install/wizard.ts` since.
