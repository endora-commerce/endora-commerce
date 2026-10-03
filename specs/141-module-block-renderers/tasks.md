# Tasks: a module package ships its own Page Builder renderers

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/block-renderers.md](contracts/block-renderers.md)

## Format

`- [ ] **ID** description` — files, then **Test**. Test first (Constitution III): write the named
test, see it fail, then implement. Tasks are in dependency order. `[P]` marks a task that touches no
file another open task touches and may run beside it.

**Before T00**: branch off `origin/master`, `pnpm install && pnpm run build:packages`, and re-read
the spec's *Why* table against the tree — every row is a measurement taken on `a76210cc3`.

---

## Phase 0 — premises (measure; leave nothing in the tree)

- [x] **T00** Measure spec Q1. Scaffold a storefront from the packed CLI (`acceptance:storefront-scaffold`'s
  tarball route), record `node_modules` size and package count, `pnpm add` one packed first-party
  module tarball (`@endora-commerce/mod-blog`), record again. Write both numbers and the list of
  peers pnpm auto-installed into plan.md's D2 as a measured fact. **If the delta is large, stop and
  raise Q1 with the owner before T12.**
  Files: `specs/141-module-block-renderers/plan.md` only.
  **Test**: none — a measurement; the throwaway directory is deleted.

- [x] **T01** Verify contract §8's premises, in a throwaway spike outside the tree: (a) under
  `react-dom/server` `renderToString` **and** `renderToReadableStream`, a component that throws
  inside `<Suspense fallback={…}>` yields the fallback and the siblings, not a thrown render;
  (b) `tsc` keeps a leading `'use client'` in emitted `dist/*.js`; (c) a Next 15 production build
  of a page importing such a file from `node_modules` through a `'use client'` boundary succeeds and
  SSR-renders it. Record the three answers in contract §8 (replace the "premise to verify"
  sentence). If (a) fails, amend §8 to the measured mechanism before T05.
  Files: `specs/141-module-block-renderers/contracts/block-renderers.md` only.
  **Test**: none — a measurement.

## Phase 1 — shapes (contracts and host packages)

- [x] **T02** `AdminBlockContributionSchema`, `AdminBlockContribution`, `AdminContributions.blocks`
  (contract §4), additive.
  Files: `packages/contracts/src/admin-contributions.ts`, its barrel export.
  **Test**: `backend/test/unit/contracts/admin-block-contribution.test.ts` — accepts `cms`/`email`,
  refuses a non-namespaced name, `invoice`, `newsletter`; an `AdminContributions` with no `blocks`
  still type-checks.

- [x] **T03** [P] E-mail renderer contract and host hook (contract §3): `EmailBlockRenderer(s)`,
  `EmailBlockRenderContext`; `renderEmailHtml` / `renderEmailText` take `blockRenderers` and
  `onBlockError`, consult them only in `default:`, merge `defaultProps` under props, give
  `renderSlot` the host's own node renderer, and derive text from HTML when `text` is absent.
  Files: `packages/email-components/src/render/block-renderers.ts` (new),
  `render/render-email-html.ts`, `render/render-email-text.ts`, `src/index.ts`.
  **Test**: `packages/email-components/src/render/block-renderers.test.ts` — a contributed name
  renders; a first-party name (`transactional_emails.EmailText`) is **not** overridable; a throwing
  renderer yields `''` and one `onBlockError` call naming the block; text derived when `text` is
  absent; `defaultProps` applied; a slot renders through the host.

- [x] **T04** [P] `@endora-commerce/page-builder-core/contributions` (contract §2, §4, §5.2.1):
  `StorefrontBlockConfig`, `StorefrontContributions`, `PageBuilderBlockEditorConfig`,
  `BlockRenderEnvironment` + provider + `useBlockRenderEnvironment`; pure
  `withContributedBlocks(config, entries)` (keep existing name, drop owner mismatch, report both),
  `withPresence(config, presence, placeholder)`, `fieldsFromDescriptor(descriptorEntry)`.
  Files: `packages/page-builder-core/src/contributions/*.ts(x)` (new), `package.json` `exports`
  (`./contributions`), `tsconfig.build.json` if needed.
  **Test**: `packages/page-builder-core/src/contributions/contributions.test.ts` — collision kept
  and reported; foreign owner dropped and reported; absent owner replaced, present kept,
  `{ all: true }` keeps all; every `cmsFieldDescriptorSchema` type maps to a Puck field.

- [x] **T05** `withBlockBoundary` (contract §8, as T01 measured it) and the `defaultProps` merge.
  Files: `packages/page-builder-core/src/contributions/block-boundary.tsx` (new).
  **Test**: `packages/page-builder-core/src/contributions/block-boundary.test.tsx` — SSR
  (`renderToString`, node environment, the storefront harness's convention): a sync throw, a throw
  in a child component, and a normal block beside each; the page renders and only the failing block
  is the placeholder.

## Phase 2 — e-mail (backend)

- [x] **T06** `EmailBlockRendererRegistry` in `email`: `register(ownerModuleId, renderers)` (a
  name whose owner segment differs from `ownerModuleId` is refused at registration), `renderers()`
  filtered by the injected tri-state `presenceOf` (policy **skip**; `undefined` honoured), and
  `listAll()` presence-blind. Registered with `ctx.di.register`, ungated; the probe wired the way
  `credentials`' `registry-singleton.ts` wires its own.
  Files: `packages/modules/email/src/backend/services/email-block-renderer-registry.ts` (new),
  `packages/modules/email/src/backend/index.ts`.
  **Test**: `packages/modules/email/src/backend/services/email-block-renderer-registry.test.ts`;
  add the registry and its policy to `backend/test/unit/kernel/contribution-seams.test.ts`.

- [x] **T07** Both send paths use it: `transactional_emails`' `renderWith` and `newsletter`'s
  `renderNewsletterEmail` pass `renderers()` and an `onBlockError` that logs
  `{ block, owner: ownerOf(block) }` through the module logger.
  Files: `packages/modules/transactional_emails/src/backend/services/transactional-email.service.ts`,
  `packages/modules/transactional_emails/src/backend/index.ts`,
  `packages/modules/newsletter/src/backend/services/content.service.ts`,
  `packages/modules/newsletter/src/backend/index.ts`.
  **Test**: `packages/modules/newsletter/src/backend/services/content.service.test.ts` (extend) and
  `packages/modules/transactional_emails/src/backend/services/render-with-block-renderers.test.ts`
  (new) — a registered block renders in HTML and text; with its owner reported absent it renders
  nothing; a throwing renderer is logged and the message still renders.

## Phase 3 — admin

- [x] **T08** `AdminContributionsProvider` flattens `blocks` with `moduleId`;
  `useBlockContributions(context)` returns the present owners' entries (through the same
  `isSurfaceVisible` predicate zones use).
  Files: `packages/admin-kit/src/zones/AdminContributionsProvider.tsx`,
  `packages/admin-kit/src/zones/use-block-contributions.ts` (new), `src/zones/index.ts`.
  **Test**: `packages/admin-kit/src/zones/use-block-contributions.test.tsx` — filters by context,
  stamps the owner, drops a switched-off owner, keeps the factory unevaluated until asked.

- [x] **T09** The CMS editor composes contributed renderers: load the factories of the descriptor's
  present, context-admitted names (one `Promise.all`), apply `withContributedBlocks`, override
  fields from the contribution over `fieldsFromDescriptor`, and give a declared name with no
  renderer the D8 editor instead of `makeMissingComponentConfig`. Stored names of absent owners keep
  `withMissingBlockPlaceholders`.
  Files: `packages/modules/cms/src/admin/components/PageBuilderEditor.tsx`.
  **Test**: `admin/test/modules/cms/block-contributions.test.tsx` (new) — contributed renderer used;
  rejected factory → D8 editor; declared-without-renderer is editable from its fields; owner absent
  from the descriptor → placeholder and not in the palette; `block-degradation.test.tsx` still green.

- [x] **T10** The e-mail editor: `emailBlockEditorConfig(renderer)`; `EmailEditorPane` loads the
  `email` contributions for present names, passes the loaded renderers to both `renderEmailHtml`
  calls (canvas embeds and preview), and merges `withMissingBlockPlaceholders` for stored names it
  cannot render (FR-016 — it merges none today).
  Files: `packages/page-builder-admin/src/email/email-block-editor-config.tsx` (new),
  `packages/page-builder-admin/src/email/EmailEditorPane.tsx`, `src/email/index.ts`.
  **Test**: `admin/test/modules/transactional_emails/email-block-contributions.test.tsx` (new) —
  canvas and preview show the renderer's HTML; an unknown stored name is a visible placeholder and
  survives a save round-trip unchanged.

- [x] **T11** [P] The admin stylesheet enumeration imports `./blocks.css` of every installed module
  package declaring it, in both trees; regenerate.
  Files: `packages/cli/src/lib/admin-artefacts.ts`, `admin/src/tailwind.generated.css` (regenerated —
  unchanged in this repository, no package declares it yet).
  **Test**: `packages/cli/test/generate.test.ts` (extend) — a fixture package with `./blocks.css`
  gets one `@import`; one without gets none; a declared subpath whose file is missing is refused.

## Phase 4 — storefront

- [x] **T12** Discovery and generation (contract §5.2): lift the package walk out of
  `theme-discovery.mjs` into an exported `listInstalledPackages`; `block-discovery.mjs` selects
  `endora.type === 'module'` packages declaring `./storefront` / `./blocks.css`;
  `generate-blocks.mjs` writes `lib/page-builder/blocks.generated.ts` and `app/blocks.generated.css`
  (sorted, banner, deterministic); `blocks:generate` runs in `dev` and `build` beside
  `themes:generate`; `app/globals.css` imports `./blocks.generated.css`.
  Files: `storefront/scripts/{theme-discovery,block-discovery,generate-blocks}.mjs`,
  `storefront/package.json`, `storefront/app/globals.css`, the two generated files (empty registry
  in this repository).
  **Test**: `storefront/test/block-registry.test.ts` (new, beside `theme-registry.test.ts`) — over
  a fixture `node_modules`: a module with both subpaths, one with only `./storefront`, a non-module
  package declaring `./storefront` (ignored), a module with `src/storefront` and no subpath (refused);
  the generator's output for the empty population is byte-equal to the committed files.

- [x] **T13** Composition and the render sites: `lib/page-builder/config.ts`
  (`storefrontPageBuilderConfig({ presence, pageContainer })`, contract R5.2.1),
  `lib/page-builder/local-blocks.tsx` (empty, the client's own); `PageBuilderRender` takes a
  required serialisable `presence` and a `language` and provides `BlockRenderEnvironment`; the five
  sites render through the composer and thread presence from `getServerContext()`.
  Files: `storefront/lib/page-builder/{config.ts,local-blocks.tsx}`,
  `storefront/components/{PageBuilderRender,CmsPageRenderer}.tsx`,
  `storefront/components/Megamenu/MenuCmsBlockEmbed.tsx`,
  `storefront/app/blog/_components/{BlogPostBody,BlogCategoryPage}.tsx`, their callers.
  **Test**: `storefront/test/ssr/module-blocks.test.tsx` (new) — a fixture contribution renders in
  SSR; absent owner → empty span, `?cms_admin=1` → the note; a local block renders; a throwing block
  leaves its siblings; plus a static assertion that `defaultPageBuilderConfig` is named in
  `storefront/` only by `lib/page-builder/config.ts`. Keep `test/ssr/block-degradation.test.tsx`
  and `blocks.test.tsx` green.

- [ ] **T14** The scaffold carries it: the new storefront files are in the copy population with
  `local-blocks.tsx` as the client's own; rebuild the packaged reference.
  Files: `packages/cli/src/new-storefront/rewrite.ts` (only if a rule must classify the new files),
  the CLI build's packaged reference.
  **Test**: `packages/cli/test/new-storefront.test.ts` (extend) — the scaffold contains the five
  files and the two scripts in `package.json`, and `blocks:generate` runs clean in it.

- [ ] **T15** Seeding (plan D12 — Q2 answered *yes* by the owner on 2026-10-03): when one `endora install`
  run writes both trees, every installed module publishing `./storefront` joins the storefront's
  `dependencies` at the release's version rule.
  Files: `packages/cli/src/install/index.ts`.
  **Test**: `packages/cli/test/install.test.ts` (extend) — seeded when both trees are written; not
  when `--only storefront`; a module without `./storefront` is not added.

## Phase 5 — the check

- [ ] **T16** `check:block-renderers`: one analysis, two hosts
  (`specs/conventions/check-estate.md`). Findings: `foreign-block-name` (a renderer key whose owner
  segment is not `endora.id`), `undeclared-block` (not in the package's own manifest `blocks`, or
  not for that context), `storefront-import` (contract §2.3), `raw-html` (§2.4),
  `email-layer-import` (§3 R3.2), `unscoped-stylesheet` (§6 R6.1), `layer-without-subpath`. Exit 2
  on an empty population. Estate verdict `package`.
  Files: `packages/cli/src/rules/block-renderers.ts` (new), `backend/scripts/check-block-renderers.ts`
  (new host), `packages/cli/src/check/estate.ts`, `backend/package.json` script, the `quality`
  workflow line, `specs/conventions/check-inventory.md` row, the read-size record.
  **Test**: `packages/cli/test/check-block-renderers.test.ts` (new) — one red fixture per finding
  and one green; `backend/test/unit/scripts/check-inventory.test.ts` names the script.

## Phase 6 — strings, docs, release

- [x] **T17** [P] The neutral preview's sentence, `pageBuilder.blockPreview.unavailable`, `en` + `pl`,
  in `cms`, `transactional_emails` and `newsletter` bundles; the D8 editor and T10's pane read it.
  Files: `packages/modules/{cms,transactional_emails,newsletter}/i18n/{en,pl}.json`.
  **Test**: `backend/test/unit/_i18n/registered-bundles-shape.test.ts` stays green;
  `pnpm --filter backend run i18n:hardcoded` reports no new literal.

- [ ] **T18** Module-author documentation (FR-023), English and Polish, with every code block a
  `verbatim-from` quotation of the acceptance fixture. Rewrite the page that today tells an author to
  edit `defaultPageBuilderConfig` (`packages/modules/cms/docs/cms/extending-page-builder.md` and its
  Polish twin) — after PR #66 has merged, which edits the same page. Hand to
  `endora-commerce-product-owner` for review.
  Files: those two pages, the translation cache entry.
  **Test**: `check:docs-translations`, `check:doc-snippets`.

- [ ] **T19** Changesets: one per touched package, `minor`, written for the consumer (name the new
  export / subpath / option).
  Files: `.changeset/*.md`.
  **Test**: `pnpm changeset:status`; `check:release-intent -- --since origin/master`.

## Phase 7 — acceptance

- [ ] **T20** The fixture module, not a workspace member: `backend/acceptance/block-renderers-fixture/`
  (`@endora-commerce/mod-acceptance-blocks`, `endora.id` `acceptance_blocks`, block
  `acceptance_blocks.Badge` for `cms` + `email`, `./admin`, `./storefront`, `./email`,
  `./blocks.css`, `./backend` registering the e-mail renderer, `en`/`pl` bundles, an `explode` prop
  for A8).
  **Test**: it passes `check:block-renderers` (A1).

- [ ] **T21** The runner and its ratchet (contract §9, A1–A8): reuse `storefront-scaffold.ts`' and
  `package-schema.ts`' packing, local install and instance-probe helpers rather than copying them.
  Files: `backend/scripts/acceptance/block-renderers.ts`, `block-renderers-assertions.ts` (pure),
  `backend/acceptance/block-renderers-expected-state.json`, `backend/package.json`
  (`acceptance:block-renderers`, `:ci`), `backend/acceptance/README.md` (one row).
  **Test**: `backend/test/unit/scripts/block-renderers-acceptance.test.ts` — every pure assertion
  red and green; then the runner itself, recorded green in the expected state.

---

**Follow-ups, not in this feature**: `endora new module --blocks` emitting the three layers;
moving `catalog.*` renderers out of `cms-components` and `orders.*`/`catalog.*` out of
`email-components` onto this mechanism.
