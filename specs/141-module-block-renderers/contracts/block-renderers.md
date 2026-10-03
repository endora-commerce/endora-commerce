# Contract — block renderers a module package ships

Normative for `specs/141-module-block-renderers/`. It extends, and does not restate, the block
**declaration** contract of feature 096 (`specs/096-page-builder-block-ownership/contracts/block-definition.md`,
pre-migration; its rules are carried by `assertBlockRules` in `packages/contracts/src/modules.ts`)
and the admin contribution contract of feature 091 (`AdminContributions` in
`packages/contracts/src/admin-contributions.ts`). A declaration says a block exists; this contract
says who may draw it, where, and what happens when its owner is absent.

## §1 — Layers: one subpath per consuming process

| Subpath | Source (sources-shipping package) | Exports | Consumed by | May import |
| --- | --- | --- | --- | --- |
| `./admin` *(exists)* | `src/admin/index.ts` | `contributions: AdminContributions`, gaining `blocks` (§4) | the admin bundle, via `modules.generated.ts` | unchanged (feature 091) |
| `./storefront` *(new)* | `src/storefront/index.ts` | `contributions: StorefrontContributions` (§2) | the storefront bundle, via `blocks.generated.ts` (§5.2) | §2.3's set only |
| `./email` *(new)* | `src/email/index.ts` | `emailBlocks: EmailBlockRenderers` (§3) | the module's own `./backend` and `./admin` | `@endora-commerce/email-components`' React-free `render/*`, `@endora-commerce/contracts`, its own `src/email/**` |
| `./blocks.css` *(new, optional)* | a built file | a finished stylesheet (§6) | the storefront (via `blocks.generated.css`) and the admin (via `tailwind.generated.css`) | — |

**R1.1** All four are optional and independent. A package with no block publishes none of the new
three; a package whose blocks are e-mail-only publishes `./email` and no `./storefront`.

**R1.2** Discovery reads the package's own `exports` map and `endora` block (`endora.type ===
'module'`, `endora.id`), never a directory name — the rule `collectAdminContributions` applies to
`./admin` (`packages/cli/src/lib/admin-artefacts.ts`). A sources-shipping package with
`src/storefront/index.ts` and no `./storefront` subpath is **refused**, not skipped, exactly as
`./admin` is (R4 of `admin-artefacts.ts`).

**R1.3** `./storefront` and `./email` export an **object**, so a reach into another module's layer
is a counted boundary reach under D-171 (`packages/cli/src/lib/module-package-subpaths.ts`), as a
reach into `./admin` is.

## §2 — The storefront layer

```ts
// @endora-commerce/page-builder-core/contributions  (new subpath; types + one helper)
import type { ComponentConfig } from '@puckeditor/core';

export type StorefrontBlockConfig<P extends object = Record<string, unknown>> =
  ComponentConfig<P> & { readonly render: ComponentConfig<P>['render'] };

export interface StorefrontContributions {
  /** Keyed by the persisted block name — `<endora.id>.<LocalName>`. */
  readonly blocks?: Readonly<Record<string, StorefrontBlockConfig>>;
}

/** The ambient a renderer may read during render, set by the host. */
export interface BlockRenderEnvironment {
  readonly language: string;          // the request's content language, BCP 47
  readonly preview: boolean;          // true under `?cms_admin=1` and in the admin canvas
}
export function useBlockRenderEnvironment(): BlockRenderEnvironment;
```

**R2.1 Keys.** Every key matches `blockNameRe`, its owner segment equals the package's
`endora.id`, and its manifest declares that name with `'cms'` in `contexts`.

**R2.2 SSR.** The layer's modules are client-component compatible: they are imported, statically,
by the storefront's `'use client'` render boundary (`storefront/components/PageBuilderRender.tsx`)
and render once on the server and once on hydration. Therefore a renderer:

- is synchronous — no `async` component, no `use(promise)` at the top level of render;
- reads no browser global (`window`, `document`, `localStorage`, `location`) during render, only in
  effects;
- produces the same output on server and client for the same props and environment — no
  `Date.now()`, `Math.random()` or locale-dependent formatting without the environment's `language`;
- gets data from its props, from `useBlockRenderEnvironment()`, from the CMS render context
  (`@endora-commerce/cms-components/components/render-context`: embeds, assets, `mediaBaseUrl`), or
  by a client-side fetch in an effect — the pattern `cms-components`' `ProductGrid` already uses.

**R2.3 Imports.** Only `react`, `react-dom` (no `react-dom/server`), `@puckeditor/core`,
`@endora-commerce/page-builder-core`, `@endora-commerce/cms-components`,
`@endora-commerce/contracts`, and the package's own `src/storefront/**`. In particular never
`@endora-commerce/platform`, `@endora-commerce/admin-kit`, another module package, `node:*`,
`server-only`, `next/*`.

**R2.4 HTML.** No `dangerouslySetInnerHTML` whose value is not the return of `sanitizeRichHtml`
from `@endora-commerce/cms-components` in the same expression.

**R2.5 Built-in strings** (a label the renderer prints that is not operator content) ship in `en`
and `pl` inside the layer, selected by `useBlockRenderEnvironment().language` with English as the
fallback — the policy of `specs/conventions/module-i18n.md`, applied inside the package because the
storefront's catalogue is the storefront owner's.

## §3 — The e-mail layer

```ts
// @endora-commerce/email-components/render/block-renderers  (new; React-free)
export interface EmailBlockRenderContext {
  readonly language: string;
  readonly accentColor: string;
  /** Renders a slot of this node (nested content), with the host's own renderer. */
  readonly renderSlot: (nodes: unknown) => string;
}
export interface EmailBlockRenderer<P = Record<string, unknown>> {
  readonly html: (props: P, ctx: EmailBlockRenderContext) => string;
  /** Absent → the host derives text from `html` with `emailHtmlToPlainText`. */
  readonly text?: (props: P, ctx: EmailBlockRenderContext) => string;
  readonly defaultProps?: Partial<P>;
}
export type EmailBlockRenderers = Readonly<Record<string, EmailBlockRenderer>>;
```

**R3.1 Keys** as R2.1, with `'email'` in the declared `contexts`.

**R3.2 Purity.** No React, no Node built-in, no I/O, no module state: the same function runs in the
backend send path and in the admin's browser preview.

**R3.3 Output** is a fragment of the table layout `renderEmailHtml` writes (one or more
`<tr>…</tr>`), escaping every prop with `escapeHtml` / `escapeAttr`
(`packages/email-components/src/render/escape-html.ts`). `{{…}}` directives in the output are
resolved by the host afterwards, exactly as for first-party blocks.

**R3.4 Host behaviour.** `renderEmailHtml(tree, { blockRenderers, onBlockError })` and
`renderEmailText(tree, { blockRenderers, onBlockError })` consult `blockRenderers` in the
`default:` branch only — a first-party name is never overridable. A throwing renderer contributes
`''` and is reported through `onBlockError(name, error)`.

## §4 — The admin contribution

```ts
// packages/contracts/src/admin-contributions.ts (additive)
export const AdminBlockContributionSchema = z.object({
  name: z.string().regex(blockNameRe),
  context: z.enum(['cms', 'email']),
});
export interface AdminBlockContribution extends z.infer<typeof AdminBlockContributionSchema> {
  /** `cms`: default export is a `PageBuilderBlockEditorConfig`; `email`: an `EmailBlockRenderer`. */
  readonly component: AdminComponentFactory;
}
export interface AdminContributions {
  readonly routes?: readonly AdminRouteDeclaration[];
  readonly nav?: readonly AdminNavDeclaration[];
  readonly zones?: readonly AdminZoneContribution[];
  readonly blocks?: readonly AdminBlockContribution[];   // new
}
```

`PageBuilderBlockEditorConfig` (in `@endora-commerce/page-builder-core/contributions`) is a Puck
`ComponentConfig` whose `render` is required and whose `fields`, when present, **override** the
fields derived from the manifest declaration key by key (a picker in place of a text input). Label,
category, `defaultProps` and the field set come from the descriptor, never from the contribution.

**R4.1** Keys as R2.1/R3.1 for the contribution's `context`. The factory stays a
`() => import(…)` so the registry is enumerable without evaluating module UI (feature 091 R2).

**R4.2** The editor loads the factories of the blocks the **descriptor** declares for its context —
the descriptor being presence-filtered, that is the presence rule (§7) — before it builds its Puck
configuration, in one `Promise.all`; a factory that rejects leaves its block on FR-014's
descriptor-derived editor and logs.

**R4.3** An e-mail contribution's renderer is wrapped by the host
(`emailBlockEditorConfig(renderer)` in `@endora-commerce/page-builder-admin/email`) into a canvas
component that renders `renderer.html` — the same function the send path runs — and the HTML
preview passes the loaded renderers to `renderEmailHtml`.

## §5 — Assembly, per surface

### §5.1 Admin

No new artefact. `modules.generated.ts` already imports every installed `./admin` layer's
`contributions`; `AdminContributionsProvider` (`packages/admin-kit/src/zones/AdminContributionsProvider.tsx`)
flattens `blocks` with the contributing `moduleId`, and `useBlockContributions(context)` (admin-kit
`./zones`) is the one reader. The admin stylesheet enumeration gains one `@import` per installed
package declaring `./blocks.css` (`collectTailwindSources` / `emitTailwindRegistry` in
`packages/cli/src/lib/admin-artefacts.ts`), so `composer:generate` and `endora generate` stay one
program over two populations (instance-tree §2.6, R3.5).

### §5.2 Storefront

Storefront-owned files, copied by the scaffold and owned by the storefront owner afterwards — the
shape of `theme-discovery.mjs` (D-193/D-195):

| File | Kind | Content |
| --- | --- | --- |
| `scripts/block-discovery.mjs` | storefront-owned | the walk: installed packages with `endora.type === 'module'` declaring `./storefront` and/or `./blocks.css`; Node built-ins only |
| `scripts/generate-blocks.mjs` | storefront-owned | writes the two artefacts below; run by `blocks:generate`, which `dev` and `build` call beside `themes:generate` |
| `lib/page-builder/blocks.generated.ts` | generated | `STOREFRONT_BLOCK_CONTRIBUTIONS: readonly { moduleId, contributions }[]`, static imports, sorted by `moduleId` |
| `app/blocks.generated.css` | generated | one `@import` per `./blocks.css`; imported by `app/globals.css` beside `themes.generated.css` |
| `lib/page-builder/local-blocks.tsx` | the client's own | `localBlocks: StorefrontContributions['blocks']`, written empty; for blocks no installed package renders (an overlay module's) |
| `lib/page-builder/config.ts` | storefront-owned | `storefrontPageBuilderConfig({ presence, pageContainer })` — §5.2.1 |

**R5.2.1 Composition order**, each step a pure function with its own test:
`defaultPageBuilderConfig` → contributed blocks (a name already present is **kept** and the
contribution logged; a name whose owner segment is not the contributing `moduleId` is dropped and
logged) → `localBlocks` (same two rules, owner unchecked) → **presence**: every component whose
`ownerOf(name)` is not present becomes `makeMissingComponentConfig(name, owner)` → every
contributed/local component is wrapped by `withBlockBoundary` (§8) and gets its `defaultProps`
merged under stored props.

**R5.2.2** All five render sites (`PageBuilderRender.tsx`, `CmsPageRenderer.tsx`,
`Megamenu/MenuCmsBlockEmbed.tsx`, `BlogPostBody.tsx`, `BlogCategoryPage.tsx`) render through
`storefrontPageBuilderConfig`. `defaultPageBuilderConfig` is named nowhere else in `storefront/`.

### §5.3 E-mail (backend)

`email` registers `emailBlockRendererRegistry` — `ctx.di.register`, **ungated**, the push-at-boot
contribution seam (`docs/docs/architecture/kernel.md` § *Two shapes for a module↔module edge*).
A contributor imports its own `./email` and, in `ctx.onBoot`, calls
`emailBlockRendererRegistry.register(<its id>, emailBlocks)`; it declares `email` in its manifest
`dependencies` (`email` is non-deactivatable, so the edge never fails closed). `transactional_emails`
(`renderWith` in `transactional-email.service.ts`) and `newsletter` (`renderNewsletterEmail` in
`content.service.ts`) pass `registry.renderers()` and an `onBlockError` that logs the owner.

## §6 — The block stylesheet

**R6.1** `./blocks.css` is **finished** CSS: no `@tailwind`/`@source`/`@import` of anything outside
the package, no preflight, no element selectors. Every selector is under a class prefixed with the
module id (`.<id>-…`) or a Tailwind prefix equal to the id — the isolation `cms-components`' `cmsc:`
prefix already gives (`packages/cms-components/package.json` `build`).

**R6.2** Colours and fonts come from the storefront's theme custom properties (`var(--…)`, the set
`storefront/THEMING.md` documents) with literal fallbacks, so a block follows the channel's theme
and still renders in the admin canvas.

## §7 — Presence

| Surface | Where presence is read | Absent owner |
| --- | --- | --- |
| Storefront | `getModulePresence()` (`storefront/lib/api/module-presence.ts`), passed to the render boundary as a serialisable `{ all: true } \| { ids: string[] }` | `makeMissingComponentConfig` → an empty span; the note under `?cms_admin=1` |
| Admin editor | the descriptor (already presence-filtered by the registry) | stored node → `withMissingBlockPlaceholders`; not in the palette |
| E-mail | `EmailBlockRendererRegistry.renderers()` — policy **skip**, probe `effectiveState.presenceOf` injected at the registration (tri-state: `undefined` — an id no manifest declares, an overlay's — is **honoured**) | no renderer → `''` |

**R7.1** Off is non-destructive: nothing on any surface writes a stored document because a block's
owner is absent.

**R7.2** The e-mail registry's policy is pinned in `backend/test/unit/kernel/contribution-seams.test.ts`
beside the existing registries.

## §8 — Failure isolation

**R8.1 Storefront and admin canvas**: `withBlockBoundary(config, name, owner)` returns a config
whose `render` (a) calls the module's `render` inside `try`/`catch` and renders the placeholder on a
synchronous throw, and (b) wraps the result in a client error boundary that renders the placeholder
on a throw below it. A server-side throw below the top level is caught by a `<Suspense>` boundary
around the block, which makes React render the fallback on the server and retry on the client —
**premise to verify in T01 before anything is built on it**, with `renderToString` (the storefront
test harness) and with Next's streaming SSR.

**R8.2 E-mail**: §3 R3.4.

## §9 — Acceptance

A runner `backend/scripts/acceptance/block-renderers.ts` (`acceptance:block-renderers`, with a
`:ci` ratchet against `backend/acceptance/block-renderers-expected-state.json`, in the shape of
`acceptance:package-schema`) packs a **fixture module that is not a workspace member** —
`backend/acceptance/block-renderers-fixture/`, `@endora-commerce/mod-acceptance-blocks`,
`endora.id` `acceptance_blocks`, one block `acceptance_blocks.Badge` declared for `cms` and `email`,
whose every renderer prints the marker `acceptance-badge:<text prop>` — plus the release packages,
and installs them into directories outside the repository.

| | Assertion | How |
| --- | --- | --- |
| A1 | The packed fixture publishes `./admin`, `./storefront`, `./email`, `./blocks.css`, and `endora check` passes `check:block-renderers` on it | `pnpm pack`, then the CLI on the unpacked tarball |
| A2 | A scaffolded instance with the fixture: `endora generate` names its `./admin` in the admin registry and its `./blocks.css` in the admin stylesheet; `vite build` succeeds and the bundle contains the marker | `endora new instance` + `endora generate` + `pnpm run build:admin` |
| A3 | The CMS editor composition renders the marker for a document holding the block and exposes the manifest's fields | the admin's editor composition rendered with Puck `<Render>` through `react-dom/server`, descriptor fixture with the block present |
| A4 | A scaffolded storefront with the fixture added: `blocks:generate` writes one entry; `next build` succeeds; SSR of a document holding the block contains the marker | `endora new storefront` + `pnpm add <tarball>` + build + a probe test run by the storefront's own vitest |
| A5 | An e-mail rendered by the composed platform (transactional preview and newsletter render) contains the marker in HTML and text | instance probe phase, PostgreSQL as `acceptance:package-schema` |
| A6 | Off: the storefront probe with presence excluding `acceptance_blocks`, the e-mail render, and the editor composition with a descriptor lacking the block render no marker; the editor shows the placeholder | activation flip through the probe |
| A7 | On again: A3–A5 hold; the stored documents are byte-identical to before A6 | |
| A8 | A renderer forced to throw (fixture prop `explode: true`) degrades only its block on all three surfaces | |
