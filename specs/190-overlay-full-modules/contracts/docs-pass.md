# Contract — Documentation pass (FR-101 – FR-104, #1857, absorbs closed #1842)

Two kinds of change, two timings (FR-104):

- **Convention sentences an implementation falsifies** change **in the same merge request** as that
  implementation (rows marked *with WPn*). The one-home rule forbids a convention that says the
  opposite of the code for even one merge.
- **Published pages, the constitution, the layout section and the middleware material** change in
  the docs pass (WP11), after #1850, #1855, #1840, the warning release of #1841 and 189's
  constitution sentences (OR-9).

Every published page changes in English **and** Polish (`docs/i18n/pl/docusaurus-plugin-content-docs/current/…`,
manual workflow `docs/docs/contributing/documentation-i18n.md`).

| File | Change | When |
| --- | --- | --- |
| `specs/conventions/overlay-modules.md` | D-106 paragraph → D-297 (schema allowed, guards, no exemption); the three-walks sentence deleted with the walks | with WP6 |
| same | "A `services/` file under an overlay is an unknown override target" — deleted (stale since the shadowing retirement) | with WP6 |
| same | new section *Overlay module layout* (`contracts/overlay-module-layout.md` §1 – §4) | WP11 |
| same | build, freshness, deployment roots — one paragraph, pointing at `overlay-build.md`'s rules | with WP2 |
| same | ports between overlays; admin layer per deployment | with WP3 / WP4 |
| `specs/conventions/module-migrations.md` | "An **overlay** module contributes to neither …" → overlay schema is discovered at runtime, guarded, never in the committed registries; §1 gains the overlay `--module` form and `endora new migration` | with WP6 / WP8 |
| same | R2 instance paragraph: "every module arrives as an installed package" → "… or as a deployment overlay module, whose migrations take the same guard with no exemption" | with WP6 |
| `specs/conventions/module-admin-surfaces.md` | palette item 7: "Overlay modules discovered at runtime are outside it" → coverage runs per deployment | with WP4 |
| `specs/conventions/building-packages.md` | one sentence: the overlay build is not a package build; its rules are `overlay-modules.md`'s | with WP2 |
| `.specify/memory/constitution.md` | XV amendment (`constitution-xv-amendment.md`), written around 189's XV sentences, which it keeps verbatim; XIII untouched (OR-9) | WP11 |
| `docs/docs/upgrading-an-instance.md` (+ pl) | the *After upgrading to 0.113.0* section takes the upgrade notes of #1848 and #1855 from their changeset bodies (FR-018, OR-11) | the 0.113.0 release pull request |
| `docs/docs/architecture/overlay-pattern.md` (+ pl) | *In an instance*: scaffolding flags, "No build" bullet → build; *What you may override* row "Add client-specific tables"; section "An overlay module contributes no schema" → "An overlay module owns its schema"; *Fail-closed guards*: drop "Overlay schema", add layout, freshness, classification, overlay-boundary; decoration narrowing per #1841; migration example bus wrap → `observe` / `admit` | WP11 |
| `docs/docs/architecture/customisation-ladder.md` (+ pl) | rung 2 gains **2c — command middleware** (`admit` / `observe`) beside 2b hooks, and policy participants per 188; rung 4a: guard-seam decoration (`commandBus`, `auditLogService`, `eventBus`, `emFactory`) marked deprecated, then removed (#1841); data ladder *Who* for D1/D2 gains "a deployment overlay"; "Never a rung" paragraph's overlay sentence rewritten; rung 3: a deployment **can** publish a port between its own overlay modules (not substitute a core one) | WP11 |
| `docs/docs/architecture/schema-extensions.md` (+ pl) | a declaring module may be an overlay | WP11 |
| `docs/docs/architecture/migrations.md` (+ pl) | overlay migrations: discovery, guard, order, naming, `endora new migration` | WP11 |
| `docs/docs/create-your-first-module.md` (+ pl) | the instance walk-through gains `--entities`, `new migration`, build, admin layer | WP11 |
| `packages/cli/src/new-instance/template.ts` (instance README section) | "An overlay module owns no database table … A module that needs a table is a package" and "nothing in this tree compiles" → the new facts | with WP2 / WP6 |
| `docs/docs/architecture/kernel.md` (+ pl) | contribution-seam table: overlay rows for schema / admin / ports | WP11 |

## The migration example (from #1842)

Before — a metrics wrap and a rate limit as `ctx.di.decorate('commandBus', …)` in an overlay. After —
the same behaviour as one `observe` middleware (metrics: sees child Commands, runs after the
transaction outcome is known) and one `admit` middleware (rate limit: refuses before the transaction,
audited as a refusal), with the decoration deleted. The example's exact API is 189's; the page cites it.

## Checks the pass must keep green

`pnpm --filter backend exec vitest run test/unit/docs/` (router, pre-migration history),
`check:docs-translations`, `check:doc-snippets`, `check:language`, `check:naming`, the docs site build.
