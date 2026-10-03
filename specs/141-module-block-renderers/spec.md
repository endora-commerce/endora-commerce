# Feature Specification: a module package ships its own Page Builder renderers

**Feature directory**: `specs/141-module-block-renderers/`
**Created**: 2026-10-03
**Status**: Draft — awaiting the owner's acceptance of the open questions at the end
**Input**: owner decision of 2026-10-03 — *a third-party module can ship its own Page Builder
renderers*: a module package (first-party, paid or third-party, and an overlay module in an
instance where feasible) contributes the React component(s) that render its blocks in the
**admin editor**, the **storefront** and **e-mail** output.

## Why — what the code does today (measured on `origin/master` at `a76210cc3`)

| Fact | Where |
| --- | --- |
| Since feature 096 a module **declares** blocks in its manifest: `blocks`, `blockCategories`, names `<module>.<Name>`, `contexts` required, four declaration rules checked on import | `packages/contracts/src/cms.ts` (`BlockDefinitionSchema`, `blockNameRe`), `packages/contracts/src/modules.ts` (`assertBlockRules`) |
| The backend descriptor serves every **present** module's blocks, presence-filtered | `packages/modules/cms/src/backend/services/page-builder-registry.ts`, `GET /api/v1/admin/cms/page-builder/config` |
| The CMS **renderers** exist only in `@endora-commerce/cms-components` (`defaultPageBuilderConfig`: 30 `cms.*` + 5 `catalog.*`) | `packages/cms-components/src/index.ts` |
| The e-mail renderer is one closed `switch` over 28 names; an unknown name renders `''` | `packages/email-components/src/render/render-email-html.ts` (`renderNode`, `default:`) |
| The admin CMS editor gives a declared block with no bundled renderer a `MissingComponentPlaceholder` whose only fields are `componentName`/`ownerModule` — the block cannot be edited | `packages/modules/cms/src/admin/components/PageBuilderEditor.tsx` (`mergeConfig`), `packages/cms-components/src/index.ts` (`makeMissingComponentConfig`) |
| The admin e-mail editor merges no placeholder at all for a stored name it cannot render | `packages/page-builder-admin/src/email/EmailEditorPane.tsx` |
| The storefront renders through `defaultPageBuilderConfig` at five call sites and composes **no** module package | `storefront/components/PageBuilderRender.tsx`, `CmsPageRenderer.tsx`, `Megamenu/MenuCmsBlockEmbed.tsx`, `app/blog/_components/{BlogPostBody,BlogCategoryPage}.tsx`; `storefront/package.json` |
| A module's admin screens already reach an instance's admin through a generated registry built from the installed packages' `./admin` subpaths | `packages/cli/src/lib/admin-artefacts.ts`, `admin/src/modules.generated.ts`, `endora generate` |
| The storefront already discovers installed **theme** packages in its `dev` and `build` scripts, with storefront-owned files, so installing one is `pnpm add` and nothing else | `storefront/scripts/generate-themes.mjs`, `storefront/scripts/theme-discovery.mjs` |

So a block declared by any module outside `cms-components` / `email-components` is palette-visible
and unrenderable: a placeholder in the editor, an empty `<span>` on the storefront and nothing in
an e-mail. The only way to render a new block today is to edit two packages the module author does
not own — the shape Principle I and feature 091 removed everywhere else.

## User Scenarios & Testing

### User Story 1 — A module's block renders on the storefront (Priority: P1)

A module author ships a block and its storefront renderer in the module package. A storefront owner
adds the package to their storefront's dependencies, builds, and a page using the block renders it
in the server-rendered HTML.

**Why this priority**: the storefront is where a block earns its keep, and it is the surface with
the hardest constraints (separate repository, SSR, customer-facing).

**Independent Test**: a fixture module outside this repository, installed from its packed tarball
into a scaffolded storefront, renders its block's marker in SSR output with no edit to any file the
storefront owner wrote.

**Acceptance Scenarios**:

1. **Given** a storefront depending on a module package that publishes a storefront layer, **When**
   the storefront is built, **Then** the generated block registry names that package and a page
   containing the block renders the block's markup in the server-rendered HTML.
2. **Given** the same storefront, **When** the package is removed from its dependencies and the
   storefront rebuilt, **Then** the registry no longer names it and the block renders as nothing to
   a customer (and as the missing-renderer note in `?cms_admin=1` preview).
3. **Given** a block renderer that throws while rendering, **When** a page containing it and other
   blocks is requested, **Then** the page renders, the other blocks are intact, and the failing
   block degrades to the missing-renderer placeholder.

---

### User Story 2 — A module's block renders and edits in the admin editor (Priority: P1)

An operator inserts the module's block from the palette, sees it rendered on the canvas exactly as
the storefront renders it, and edits its fields.

**Why this priority**: a block that renders but cannot be authored is not a feature.

**Independent Test**: in an instance built with the fixture module, the CMS editor's composed
configuration renders the block's marker and exposes the fields the manifest declares.

**Acceptance Scenarios**:

1. **Given** an instance whose installed module contributes a CMS block renderer through its admin
   layer, **When** the operator opens the CMS editor, **Then** the block is insertable from its
   declared palette section, renders with the module's renderer, and exposes the manifest's fields
   plus any field editor the module contributes.
2. **Given** a block the descriptor declares and **no** installed renderer answers, **When** the
   operator opens the editor, **Then** the block is still insertable and its declared fields are
   editable, with a neutral preview that names the block — instead of today's uneditable placeholder.

---

### User Story 3 — A module's block renders in e-mail (Priority: P2)

A module contributes an e-mail block; transactional e-mail and newsletter campaigns that contain it
render it in the sent HTML and plain text, and the admin e-mail editor previews it.

**Why this priority**: the e-mail palette already admits module blocks (`orders`, `catalog`), and
a third party can declare one today with nothing able to render it.

**Independent Test**: with the fixture module composed, rendering an e-mail whose tree contains the
block yields the block's marker in both the HTML and the text output.

**Acceptance Scenarios**:

1. **Given** a composed module that registers an e-mail renderer for its block, **When** a
   transactional e-mail or a newsletter campaign containing the block is rendered, **Then** the
   HTML and the plain text contain the block's output and directives inside it are resolved.
2. **Given** the e-mail editor, **When** the operator inserts the block, **Then** the canvas and the
   HTML preview show the same output the send path produces.
3. **Given** an e-mail renderer that throws, **When** the e-mail is rendered, **Then** the message
   still renders and sends, without that block, and the failure is logged naming the module.

---

### User Story 4 — Switching the module off makes its blocks absent, reversibly (Priority: P2)

An operator switches the contributing module off. Its blocks stop rendering on every surface, the
stored content is untouched, and switching it back on restores them.

**Why this priority**: Constitution XVII is non-negotiable; this is the off-state test it requires.

**Independent Test**: flip the fixture module's activation; assert absence on all three surfaces
and byte-identical stored documents; flip back; assert restoration.

**Acceptance Scenarios**:

1. **Given** the module is off, **When** a storefront page containing its block is requested,
   **Then** nothing of the block reaches the customer.
2. **Given** the module is off, **When** an e-mail containing its block is rendered, **Then** the
   block contributes nothing to HTML or text.
3. **Given** the module is off, **When** the operator opens a document containing its block,
   **Then** the node is preserved as a visible, data-preserving placeholder, and the block is not
   offered in the palette.
4. **Given** the module is switched back on, **When** the same three surfaces are exercised,
   **Then** the block renders as before and no stored document changed in between.

---

### User Story 5 — An overlay module in an instance contributes a block (Priority: P3)

A deployment's overlay module declares a block. The client renders it in their own storefront and in
e-mail, and edits it in the admin.

**Why this priority**: the owner asked for it *if feasible*; it is feasible on two surfaces and
degrades predictably on the third.

**Independent Test**: an overlay module with a block, in an instance; its storefront renderer lives
in the client's storefront, its e-mail renderer in the overlay's backend registration.

**Acceptance Scenarios**:

1. **Given** an overlay module declaring a CMS block, **When** the client registers a renderer for it
   in their storefront's own local-blocks file, **Then** the storefront renders it.
2. **Given** an overlay module registering an e-mail renderer from its backend composition, **When**
   an e-mail containing the block is rendered, **Then** it renders.
3. **Given** an overlay module's block in the admin editor, **Then** it is insertable and its
   declared fields are editable with the neutral preview of US2 scenario 2 (overlay modules have no
   admin layer — see Non-goals).

### Edge Cases

- A contributed renderer names a block its own manifest does not declare, or a block another module
  owns → refused by the check before publication; at runtime it is ignored and logged.
- Two installed packages contribute a renderer for the same name → impossible for a correctly
  declared name (one owner per name); the composer keeps the owner's and logs the other.
- The storefront is at an older version of a module than the backend (they are separate
  repositories): a block the storefront's version does not know renders as the placeholder; a prop
  the storefront's version does not know is ignored.
- The backend is unreachable when the storefront resolves module presence → the storefront's
  existing degrade-open presence (`storefront/lib/api/module-presence.ts`) applies, and each block
  renders from its stored props.
- A block's stored props predate a field the module added → the renderer receives the declared
  `defaultProps` under the stored props.
- A block in the `invoice` context → out of scope (Non-goals); unchanged behaviour.

## Requirements

### Functional Requirements

**Packaging**

- **FR-001** A module package MAY publish a **storefront layer** (`./storefront`): React renderers
  for its blocks in the `cms` context, which render under server-side rendering and hydrate on the
  client.
- **FR-002** A module package MAY publish an **e-mail layer** (`./email`): pure, React-free functions
  that render its blocks in the `email` context (and the `newsletter` context it admits) to HTML and,
  optionally, plain text.
- **FR-003** A module package MAY contribute **editor renderers** for its blocks through its existing
  admin layer (`./admin`), for the `cms` and `email` contexts.
- **FR-004** A module package MAY publish one finished, module-scoped **block stylesheet**
  (`./blocks.css`) consumed by both the storefront and the admin editor.
- **FR-005** Every renderer a package contributes names a block **its own manifest declares**, for a
  context that block declares. Anything else is refused before publication.

**Assembly**

- **FR-006** The admin editor's renderers are assembled from the admin contribution registry
  `endora generate` already renders. No second admin registry is introduced.
- **FR-007** The storefront's renderers are assembled at build time (the `dev` and `build` scripts) by a
  storefront-owned generator from the packages **the storefront itself** depends on. Installing a
  module's storefront layer is adding the package and nothing else.
- **FR-008** A storefront owner can register renderers for blocks no installed package renders (an
  overlay module's) in one client-owned file the scaffold writes empty.
- **FR-009** The e-mail renderers are assembled at backend composition from what each composed module
  registers; the transactional-e-mail and newsletter send paths and the admin e-mail preview use them.
- **FR-010** First-party renderers in `cms-components` and `email-components` keep working unchanged;
  a contributed renderer never replaces one whose block another module owns.

**Rendering**

- **FR-011** A contributed storefront renderer's output is part of the server-rendered HTML
  (Principle VII); it is not deferred to the client.
- **FR-012** One failing renderer degrades its own block to the placeholder and never fails the page,
  the editor or the e-mail.
- **FR-013** A renderer receives the block's declared `defaultProps` under the stored props.
- **FR-014** A declared block with no editor renderer is insertable and editable in the admin from
  its declared fields, with a neutral preview naming it.

**Presence (Constitution XVII)**

- **FR-015** A block whose owner module is not present renders nothing to a customer on the
  storefront and contributes nothing to an e-mail.
- **FR-016** In the admin, a stored block whose owner is not present is a visible, data-preserving
  placeholder and is not offered in the palette — in the CMS editor **and** the e-mail editor.
- **FR-017** Switching the owner back on restores rendering on every surface with no stored
  document changed.

**Compatibility**

- **FR-018** A block's name stays permanent (feature 096). A renderer MUST render every props shape
  its module ever published: unknown props are ignored, missing props fall back to defaults.
- **FR-019** The renderer contract is versioned by the package that owns its types; a breaking change
  to it is a release-level change (`specs/conventions/release-intent.md`).

**Security**

- **FR-020** Renderer code reaches a surface only as an installed dependency chosen by whoever owns
  that surface's build. Nothing loads renderer code from the database or the network at runtime.
- **FR-021** Block props are untrusted input. A storefront renderer injects HTML only through the
  sanctioned sanitiser; an e-mail renderer escapes through the sanctioned helpers. The check refuses
  raw HTML injection in a storefront layer.
- **FR-022** A storefront layer imports nothing server-only and nothing outside the allowed set
  (React, the Page Builder packages, `contracts`, its own files).

**Developer surface**

- **FR-023** The module-author documentation (English and Polish) describes the three layers, the
  stylesheet, the constraints and the off-state behaviour.

### Key Entities

- **Storefront contribution** — what a package's storefront layer exports: renderers keyed by
  block name.
- **E-mail block renderer** — a pure function pair (HTML, optional text) per block name.
- **Admin block contribution** — a lazily loaded editor renderer for one block in one context.
- **Generated storefront block registry** — the storefront's build-time list of installed
  storefront layers and stylesheets.
- **E-mail block renderer registry** — the backend table of composed modules' e-mail renderers,
  owner recorded per entry.

No persisted entity is added or changed.

## Non-goals

- **Moving the first-party renderers** (`catalog.*` out of `cms-components`, `orders.*`/`catalog.*`
  out of `email-components`). The mechanism makes it possible; doing it is a separate change.
- **The `invoice` context.** Invoice PDFs are rendered by `pdfmake` inside `invoices`; no third-party
  invoice block is asked for. Unchanged.
- **Admin renderers for overlay modules.** An overlay module has no admin layer and the admin
  registry composes bare core under every `DEPLOYMENT`; US5 degrades to FR-014's editor.
- **Sandboxing third-party React.** There is no isolation of React components short of an iframe per
  block; the trust boundary is installation (FR-020).
- **Runtime-loaded or remote renderers** (module federation, CDN scripts). Refused by FR-020.

## Success Criteria

- **SC-001** An example module **outside** `cms-components`, packed to a tarball and installed into a
  scaffolded instance and a scaffolded storefront, renders its block in the admin editor, the
  storefront's SSR output and a rendered e-mail (acceptance A1–A8 in
  [contracts/block-renderers.md](contracts/block-renderers.md) §9).
- **SC-002** With that module switched off, none of the three surfaces renders the block and every
  stored document is byte-identical; switched on, all three render it again.
- **SC-003** Adding a block to a module touches only that module's package — zero edits to
  `cms-components`, `email-components`, `page-builder-admin`, the storefront's own files or `cms`.
- **SC-004** No new runtime dependency (Constitution IV).

## Open questions

- **Q1 [NEEDS CLARIFICATION] — install weight of a module package in the storefront.** A module
  package declares its backend runtime (`@endora-commerce/platform`, `@mikro-orm/*`, `fastify`,
  `ioredis`) as **required** peers, so adding one to a storefront makes pnpm auto-install them —
  installed, never bundled (Next bundles only what the storefront layer imports). The plan keeps one
  package per module (plan D2) and measures the delta first (task T00). If the owner finds the
  measured install weight unacceptable, the remedy is a generator rule making a package's backend
  peers optional — a change to `manifests:generate` across every module package — not a second
  package per module.
- **Q2 — does `endora install` seed the storefront's dependencies?** The plan's answer: yes, once —
  when one run writes both trees, every installed module that publishes `./storefront` is added to
  the storefront's `dependencies`; afterwards the storefront's manifest is its owner's (D-195). The
  owner may prefer the storefront to start with none.
