# Implementation Plan: a module package ships its own Page Builder renderers

**Feature directory**: `specs/141-module-block-renderers/` | **Date**: 2026-10-03 |
**Spec**: [spec.md](spec.md) | **Contract**: [contracts/block-renderers.md](contracts/block-renderers.md)

## Summary

Three optional layers on a module package — `./storefront` (React, SSR-safe), `./email` (pure
HTML) and a `blocks` field on the existing `./admin` contributions — plus an optional finished
`./blocks.css`. Each surface assembles them with the mechanism it already has: the admin through the
generated contribution registry `endora generate` renders, the storefront through a storefront-owned
build-time generator shaped exactly like its theme discovery, the backend through a push-at-boot
contribution registry in `email`. Presence uses each surface's existing presence source. No new
runtime dependency, no schema change, no new admin registry.

## Technical context

- **Stack**: TypeScript 5.x strict, Node ≥ 22.17, ESM. React 19, `@puckeditor/core` 0.23 (since
  PR #63), Next.js 15 App Router (storefront), Vite (admin).
- **Packages touched**: `contracts`, `page-builder-core`, `email-components`, `cms-components`
  (one export), `page-builder-admin`, `admin-kit`, `cli`, `mod-email`, `mod-transactional-emails`,
  `mod-newsletter`, `mod-cms`; the `storefront/` reference; `backend/acceptance`.
- **New runtime dependency**: none.
- **Storage**: none. No migration, no entity.
- **Release**: every touched package carries a changeset (`specs/conventions/release-intent.md`);
  the additions are `minor` (new exports, new optional fields).

## Decisions

**D1 — Three layers, one per consuming process.**
*Decision*: `./storefront`, `./email`, and `blocks` on `./admin` (contract §1).
*Rationale*: each process must import only what it can run. The backend send path must stay
React-free (`email-components`' own header says so); the storefront must not import admin code or
anything server-only; the admin already has a layer and a registry. One function per e-mail block,
used by the send path, the admin canvas and the admin preview, means the preview cannot drift from
what is sent.
*Rejected*: **one `./page-builder` subpath for everything** — the backend would import React and the
storefront would import editor code; **renderers in the manifest** — the manifest is data, parsed
by Zod, evaluated by every process and by `endora check`; a React component there would put React
in the backend's composition path; **putting e-mail rendering in `./backend`** — the admin's browser
preview could not import it.

**D2 — The layers live in the module package, not in a companion package.**
*Decision*: one package per module; renderers are the module's own files.
*Rationale*: Principle I — a module owns its UI as it owns its routes, i18n and tests; one version,
one changeset, one `endora.id`; a block name's owner segment and the package that renders it cannot
come apart.
*Rejected*: **a `<pkg>-blocks` companion** — doubles the packages, splits one owner across two
versions that `endora upgrade` would have to keep paired, and lets a renderer ship for a manifest
it is not released with. **Cost accepted, and measured first (T00)**: the storefront installs the
module package's required backend peers (spec Q1). Bundle size is unaffected — Next bundles what
`./storefront` imports, and `check:block-renderers` keeps that to contract §2.3.

**D3 — The admin reuses the generated contribution registry.**
*Decision*: `AdminContributions.blocks?` (contract §4); no new artefact.
*Rationale*: the owner asked to reuse the mechanism admin surfaces already use, and it fits without
strain: a block renderer is one more lazily loaded, enumerable contribution, presence-gated at
render, exactly like a zone.
*Rejected*: **a second generated admin artefact for renderers** — a second walk of one population
(D-100); **fetching renderer code from the backend at runtime** — refused by FR-020 and by Vite's
static build.

**D4 — The storefront assembles with a storefront-owned generator, not with `endora generate`.**
*Decision*: `scripts/block-discovery.mjs` + `scripts/generate-blocks.mjs`, run by `dev` and `build`,
writing `lib/page-builder/blocks.generated.ts` and `app/blocks.generated.css` (contract §5.2).
*Rationale*: this is the shape the storefront already uses for the identical question — *"which
installed packages contribute to this storefront?"* — for themes (`storefront/scripts/theme-discovery.mjs`,
D-193/D-195): the storefront is the client's own repository, the CLI keeps no channel back to it,
and Node built-ins with no compile step are what survive being copied into a stranger's tree. The
population is the storefront's **own** dependencies, which is right: the storefront may run a
different module set from the backend, and a renderer it does not have is a placeholder, not a crash.
*Rejected*: **`endora generate` writing into the storefront** — makes the CLI a dependency of the
storefront and reopens the channel D-195 closed; **`endora generate` in the instance writing a
sibling directory** — the storefront may be on another machine (D-284); **runtime discovery in
Next** — a standalone server has no `node_modules` to walk (`generate-themes.mjs` header);
**`next/dynamic` per block** — loses SSR output (Principle VII) unless `ssr: true`, which then needs
the static import anyway.

**D5 — The storefront's discovery walk is shared with themes, not copied.**
*Decision*: lift the installed-package walk out of `theme-discovery.mjs` into an exported
`listInstalledPackages(nodeModules)` that both discoveries call.
*Rationale*: two walks of one `node_modules` answering two predicates is the shape
`admin-artefacts.ts` already refuses for the admin (one walk, `./admin` vs `./tailwind.css`).

**D6 — E-mail renderers are registered into a push-at-boot registry owned by `email`.**
*Decision*: `emailBlockRendererRegistry` in `mod-email`, `ctx.di.register`, ungated, policy **skip**
with the tri-state presence probe (contract §5.3, §7).
*Rationale*: `email` is the one module both e-mail producers (`transactional_emails`, `newsletter`)
already depend on, and it is non-deactivatable, so a contributor's `dependencies: ['email']` costs
nothing and the registry can never be switched off under its contributors (`kernel.md` explains why
a contribution registry must be ungated).
*Rejected*: **`transactional_emails`** — `newsletter` deliberately declares no edge to it
(`packages/modules/newsletter/src/backend/index.ts`, `resolveEmailBranding`) and this would force one;
**`cms`** — `transactional_emails` does not depend on it today, and the edge would tie the
platform's only acknowledgement path (non-deactivatable) to a module an operator may switch off,
since dependencies fail closed;
**the platform** — a renderer table is a domain concern, and the published platform surface is
deliberately small (`published-surface.test.ts`); **a generated backend registry** — in an instance
the composition artefacts are the platform's constants (instance-tree §2.6), so it would need a
second generator for the backend.

**D7 — Presence is read where each surface already reads it.**
*Decision*: contract §7's table.
*Rationale*: Constitution XVII item 5 — *"both frontends resolve this from the server's effective
enabled-set"*. The storefront has `getModulePresence()`; the admin's descriptor is already
presence-filtered; the backend has `effectiveState.presenceOf`. The storefront's presence filter
applies to **every** component by owner, first-party included — one rule rather than a carve-out.
*Rejected*: **filtering blocks out of stored content on the server** — destructive-looking, and the
admin must still see the node to preserve it.

**D8 — A declared block without an editor renderer becomes editable.**
*Decision*: a descriptor-declared, present block with no renderer gets a Puck config built from its
declared `fields` (a pure `fieldsFromDescriptor` in `page-builder-core`) and a neutral preview; a
stored block whose owner is absent keeps today's placeholder.
*Rationale*: this is what makes overlay modules (no admin layer) and version skew degrade into
something an operator can still use, and it costs one pure function.

**D9 — Failure isolation per block** (contract §8). *Rationale*: one third-party renderer must not
take a page, an editor or an outbound e-mail down. The SSR half rests on a React behaviour the plan
has **not** measured; T01 measures it before anything depends on it.

**D10 — Compatibility by tolerant reading, not by a version field.**
*Decision*: FR-018; `defaultProps` merged under stored props; no props schema version, no migration
hook.
*Rationale*: the name is already permanent; props evolve additively in every first-party block
today; a version field and a migration runner are YAGNI until a module needs a breaking props
change. A module needing one then renames the block (a new name) and keeps the old renderer.
*Rejected*: **a `version` + `migrate(props)` on each renderer** — machinery with no caller.

**D11 — The trust boundary is installation; the check holds the rest** (FR-020–FR-022).
*Decision*: `check:block-renderers` (contract §2.3, §2.4, R2.1, R3.1, R4.1, R6.1), with an
`endora check` estate entry of kind `package` so a third-party author runs it on their package.
*Rationale*: React has no in-page sandbox; what can be enforced statically is that a layer stays in
its lane (imports, raw HTML, names it owns) so a reviewer of an installed package reads a small,
checkable surface.

**D12 — `endora install` seeds the storefront once** (spec Q2, owner's call). When one run writes both
trees, the installed modules publishing `./storefront` join the storefront's `dependencies`, with the
same version rule as the release packages; afterwards that manifest is the storefront owner's.
`endora upgrade` already moves release packages in the storefront beside an instance
(`packages/cli/src/upgrade/index.ts`).

## Cross-cutting concerns

| Concern | Answer |
| --- | --- |
| Admin permissions | none new — editing is gated by the editor screens' existing codes |
| Command palette | none new — no new admin surface |
| i18n | the neutral preview's one sentence: key `pageBuilder.blockPreview.unavailable` in `cms` and in `transactional_emails`/`newsletter` bundles (the e-mail pane's callers), `en` + `pl`; renderer built-in strings per contract R2.5 |
| Settings | none |
| Auditing (Command Bus) | none — no write path is added |
| Tenant scoping | none — renderers receive props already scoped by the read that served them |
| Cache invalidation | none new — storefront presence is cached under the existing `modules:presence` tag, invalidated by the existing revalidator |
| Documentation | module-author page in `cms`' docs (en + pl), handed to the product owner |

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I Modular (NN) | **Pass** — a module owns its renderers; no module reaches another's layer; the host packages gain extension points, not module knowledge |
| II API-first | **Pass** — `AdminBlockContributionSchema` in `contracts` first; the React/HTML types live in the packages that own React and the e-mail renderer, as `AdminComponentFactory` already does |
| III TDD (NN) | **Pass** — every task names its failing test first; acceptance A1–A8 |
| IV Minimal deps | **Pass** — none |
| VII SEO/SSR | **Pass** — static import, SSR output (FR-011) |
| IX UI reuse | **Pass** — the existing placeholder, palette builder, render context and sanitiser are reused |
| XI Tenancy (NN) | **Pass** — untouched |
| XIII Command Bus (NN) | **N/A** — no write |
| XV Untouched core / overlay | **Pass** — overlay blocks render without editing core (US5) |
| XVI Palette | **N/A** — no admin surface |
| XVII Toggleable (NN) | **Pass** — contract §7, acceptance A6/A7 |

## Complexity tracking

| Addition | Why | Simpler alternative rejected |
| --- | --- | --- |
| a new check, `check:block-renderers` | the only enforcement of the storefront layer's lane for a package this repository never sees | a review checklist — not runnable by a third party, and not run |
| a new acceptance runner | FR-005 and SC-001 are about a package that is *not* a workspace member, which no in-repository test can show (`backend/acceptance/README.md`) | extending `acceptance:package-schema` — its fixture and ratchet answer D-110's schema question and would change meaning |

## Project structure (what changes)

```text
packages/contracts/src/admin-contributions.ts          AdminBlockContribution(+Schema), AdminContributions.blocks
packages/page-builder-core/src/contributions/          StorefrontContributions, PageBuilderBlockEditorConfig,
                                                       BlockRenderEnvironment, withBlockBoundary, fieldsFromDescriptor,
                                                       withContributedBlocks  (+ ./contributions subpath)
packages/email-components/src/render/block-renderers.ts   EmailBlockRenderer(s); render-email-{html,text}.ts consult it
packages/page-builder-admin/src/email/                 emailBlockEditorConfig; EmailEditorPane loads contributions, placeholders
packages/admin-kit/src/zones/                          provider flattens blocks; useBlockContributions
packages/modules/cms/src/admin/components/PageBuilderEditor.tsx   loads contributions; D8 editor
packages/modules/email/src/backend/                    EmailBlockRendererRegistry + registration
packages/modules/{transactional_emails,newsletter}/src/backend/   pass renderers to the renderer
packages/cli/src/lib/admin-artefacts.ts                blocks.css in the admin stylesheet enumeration
packages/cli/src/rules/block-renderers.ts (+ estate)   the check
packages/cli/src/install/                              D12 seeding
storefront/scripts/{block-discovery,generate-blocks}.mjs, theme-discovery.mjs (shared walk)
storefront/lib/page-builder/{config.ts,blocks.generated.ts,local-blocks.tsx}, app/blocks.generated.css
storefront/components/PageBuilderRender.tsx + four render sites
backend/acceptance/block-renderers-fixture/, backend/scripts/acceptance/block-renderers*.ts
```

## Handoff to `endora-commerce-dev`

Implement from [tasks.md](tasks.md) in order. Three things in the brief are **premises, not
measurements** — re-derive each before relying on it: (1) React's server-side `<Suspense>` fallback
on a thrown error (T01); (2) the storefront install delta of one module package (T00); (3) that
`tsc` preserves a `'use client'` prologue in `dist` and Next honours it from `node_modules` (T01).
Branch off `origin/master`; regenerate and commit generated artefacts in the same pull request
(`composer:generate`, `blocks:generate`); one changeset per touched package; no AI attribution in
commits or pull-request text.
