---
title: Extending the Page Builder
sidebar_position: 2
---

# Extending the Page Builder

The CMS module ships built-in components — `Row`, `Columns`, `Text`,
`Heading`, `Button`, `InsertBlock`, and others — but every other
backend module can contribute its own components. (`InsertTemplate` remains
registered for legacy content trees but is no longer listed in the drawer
palette.) The `cms`, `catalog`, `orders`, `invoices` and `transactional_emails`
modules already contribute blocks this way. A contributing module participates in two
places:

1. **Manifest declaration**: declare the block's metadata — name, labels,
   palette category, contexts and editable fields — in the module's own
   `manifest.ts`. The CMS module builds its Page Builder registry from the
   manifests of the composed modules, so there is no registration call to
   write.
2. **Renderers**: ship, in the module's own package, the code that draws the
   block on the storefront, in e-mail and in the admin editors.

## 1. Declare the block in the manifest

Add `blocks` and `blockCategories` to your module manifest:

```ts
// the promotions module: src/manifest.ts
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'promotions',
  // ...name, version, dependencies...
  blocks: [
    {
      name: 'promotions.PromoBanner',
      labelKey: 'blocks.promoBanner.label',
      descriptionKey: 'blocks.promoBanner.description',
      category: 'promotions',
      /** Omit email/invoice — this component is storefront-only. */
      contexts: ['cms'],
      fields: {
        headline: { type: 'text', label: 'Headline', required: true },
        codeInput: { type: 'text', label: 'Promo code' },
        tone: {
          type: 'select',
          label: 'Tone',
          options: [
            { label: 'Info', value: 'info' },
            { label: 'Urgent', value: 'urgent' },
          ],
        },
      },
      previewIcon: 'ticket',
      weight: 10,
    },
  ],
  blockCategories: [
    { key: 'promotions', titleKey: 'blocks.category.promotions', contexts: ['cms'] },
  ],
});
```

The schema is `BlockDefinitionSchema` and `BlockCategorySchema` in
`packages/contracts/src/cms.ts`. `defineModuleManifest` refuses a manifest
that breaks either of two rules:

- A block `name` is `<module id>.<PascalCaseName>`, and the part before the
  dot must be the declaring module's own `id`. The name is written into the
  stored page content and never rewritten, so choose it once.
- A block's `category` must be declared in the same manifest's
  `blockCategories` for every context the block lists. Several modules may
  declare the same category key; the palette merges them.

`labelKey`, `descriptionKey` and `titleKey` are relative to the declaring
module's own i18n bundle (`blocks.promoBanner.label`, not
`promotions.blocks.promoBanner.label`). Nothing can check that when the
manifest is defined, so get it right by hand.

Field types are taken from the closed enum declared in
`packages/contracts/src/cms.ts`: `text | textarea | number | select |
radio | array | object | external | uuid | richtext`. This metadata is
React-free; the backend never imports a renderer.

A block is offered only while its module is present: the registry filters
declarations by module presence when it answers
`GET /api/v1/admin/cms/page-builder/config`, so a module that is switched off
takes its blocks out of the palette with it.

## 2. Ship the renderers

A module package draws its own blocks. It does so through up to three
**layers**, one per process that renders a block, plus an optional stylesheet.
Each is a subpath of the package's `exports` map, and each is optional: a
module whose blocks are e-mail-only ships the e-mail layer and nothing else.

| Subpath | What it exports | Who renders with it |
| --- | --- | --- |
| `./storefront` | `contributions` — React renderers for the module's `cms` blocks | the storefront, in the server-rendered HTML |
| `./email` | `emailBlocks` — pure functions that render the module's `email` blocks to HTML and text | the backend when it sends, and the admin's e-mail editor |
| `./admin` | `contributions.blocks` — editor renderers, beside the module's routes and zones | the admin's CMS and e-mail editors |
| `./blocks.css` | one finished stylesheet | the storefront and the admin editor |

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/package.json -->
```json
"exports": {
  ".": {
    "types": "./dist/manifest.d.ts",
    "default": "./dist/manifest.js"
  },
  "./backend": {
    "types": "./dist/backend/index.d.ts",
    "default": "./dist/backend/index.js"
  },
  "./admin": {
    "types": "./dist/admin/index.d.ts",
    "default": "./dist/admin/index.js"
  },
  "./storefront": {
    "types": "./dist/storefront/index.d.ts",
    "default": "./dist/storefront/index.js"
  },
  "./email": {
    "types": "./dist/email/index.d.ts",
    "default": "./dist/email/index.js"
  },
  "./blocks.css": "./blocks.css",
```

Each layer publishes its type declarations beside its JavaScript (the `types`
condition above): a storefront written in TypeScript imports `./storefront`
from its generated registry, and `blocks:generate` refuses a layer that ships
none rather than leaving the build to fail on it.

The examples below are the platform's own acceptance fixture — a module
outside every platform package that draws one block, `acceptance_blocks.Badge`,
on all three surfaces.

Every renderer is keyed by the block's full name, and a package renders only
the blocks **its own manifest declares**, for a context that block declares:
`cms` for the storefront and the CMS editor, `email` for e-mail. Write the name
as a string literal, in the manifest and in each layer.

### The storefront layer

`src/storefront/index.ts` exports `contributions`, a map from block name to a
Puck component config:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/storefront/index.ts -->
```ts
export const contributions: StorefrontContributions = {
  blocks: {
    'acceptance_blocks.Badge': {
      defaultProps: { text: 'New badge', explode: 'no' },
      render: Badge,
    },
  },
};
```

The renderer is an ordinary React component. Its props are the block's stored
props, with the `defaultProps` above filled in underneath them — so a prop the
module added after a page was saved still has a value:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/storefront/Badge.tsx -->
```tsx
export function Badge({ text, explode }: BadgeProps): ReactNode {
  const { language } = useBlockRenderEnvironment();
  if (explode === true || explode === 'yes') {
    throw new Error('acceptance_blocks.Badge was asked to fail on render');
  }
  const label = LABEL[language.slice(0, 2).toLowerCase()] ?? LABEL['en'];
  return (
    <span className="acceptance_blocks-badge" title={label}>
      {`acceptance-badge:${String(text ?? '')}`}
    </span>
  );
}
```

A storefront renderer runs once on the server and once in the browser, so:

- it is **synchronous** — no `async` component — and reads no browser global
  (`window`, `document`, `localStorage`) while rendering, only in an effect;
- it draws the same output on the server and in the browser for the same
  props: no `Date.now()`, no `Math.random()`, no locale-dependent formatting
  without the language from `useBlockRenderEnvironment()`;
- every file of the layer starts with `'use client'`;
- it imports only `react`, `react-dom`, `@puckeditor/core`,
  `@endora-commerce/page-builder-core`, `@endora-commerce/cms-components`,
  `@endora-commerce/contracts` and its own files. Nothing server-only, no
  admin kit, no platform, no other module. Data it needs comes from its props,
  from the CMS render context, or from a fetch in an effect;
- block props are **untrusted input**: HTML is injected only as
  `dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(value) }}`, with
  `sanitizeRichHtml` from `@endora-commerce/cms-components`;
- a label the renderer prints itself — one that is not the operator's content —
  ships in English and Polish inside the layer and is chosen by
  `useBlockRenderEnvironment().language`, with English as the fallback.

**Installing it.** A storefront owner adds the package to their storefront and
builds. `blocks:generate`, which the storefront's `dev` and `build` scripts
run, finds every installed module package that declares `./storefront` or
`./blocks.css` and writes the registry and the stylesheet import — there is no
line to add to any file. When `endora install` writes an instance and a
storefront in one run, it adds the instance's modules that publish a storefront
layer to the storefront's dependencies, once; afterwards that list belongs to
the storefront's owner.

**A block no package renders.** A storefront can also render a block itself —
typically one an overlay module of its own instance declares — by adding it to
`lib/page-builder/local-blocks.tsx`, the one file of the block registry that is
the storefront owner's. A local block never replaces a block a package or the
platform already renders.

### The e-mail layer

`src/email/index.ts` exports `emailBlocks`. Each renderer is a pure function —
no React, no I/O — that returns rows of the e-mail's table layout and escapes
every prop:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/email/index.ts -->
```ts
export const emailBlocks: EmailBlockRenderers = {
  'acceptance_blocks.Badge': {
    defaultProps: { text: 'New badge' },
    html: (props: BadgeProps, ctx) => {
      assertRenderable(props);
      return (
        '<tr><td style="padding:8px 24px;font-family:Arial,Helvetica,sans-serif;">' +
        `<span style="display:inline-block;padding:4px 10px;border-radius:6px;background-color:${ctx.accentColor};color:#ffffff;font-size:14px;font-weight:bold;">` +
        `acceptance-badge:${escapeHtml(String(props.text ?? ''))}` +
        '</span></td></tr>'
      );
    },
    text: (props: BadgeProps) => {
      assertRenderable(props);
      return `acceptance-badge:${String(props.text ?? '')}\n`;
    },
  },
};
```

`text` is optional; without it the plain-text part is derived from the HTML.
`{{var …}}` directives in the output are resolved afterwards, exactly as in a
built-in block. The layer imports only
`@endora-commerce/email-components/render/*`, `@endora-commerce/contracts` and
its own files, because the same function runs in the backend and in the
admin's browser.

The module's backend registers the renderers when the platform boots, and
declares `email` in its manifest `dependencies`:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/backend/index.ts -->
```ts
export function registerModule(ctx: ModuleContext): void {
  // From a boot hook, unprobed: the registry is ungated and decides presence
  // itself, per render, on the contributor recorded here — so switching this
  // module off, or back on, needs no restart and no re-registration.
  ctx.onBoot(() => {
    lazyPort<EmailBlockRendererRegistryPort>(ctx, 'emailBlockRendererRegistry').register(
      'acceptance_blocks',
      emailBlocks,
    );
  });
}
```

Transactional e-mail and newsletter campaigns both render through that
registry. A built-in e-mail block cannot be overridden: a contributed renderer
is consulted only for a name the platform does not draw itself.

### The admin layer

The module's `./admin` layer — the one that already declares its routes and
zone contributions — lists an editor renderer per block and editor:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/index.ts -->
```ts
export const contributions: AdminContributions = {
  blocks: [
    {
      name: 'acceptance_blocks.Badge',
      context: 'cms',
      component: () => import('./badge-editor.js'),
    },
    {
      name: 'acceptance_blocks.Badge',
      context: 'email',
      component: () => import('./badge-email.js'),
    },
  ],
};
```

For the CMS editor the default export is the block's renderer — usually the
storefront's own component, so the canvas shows what the storefront draws:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/badge-editor.tsx -->
```tsx
const editor: PageBuilderBlockEditorConfig = { render: Badge };

export default editor;
```

For the e-mail editor it is the e-mail layer's renderer, the function the send
path runs, so the canvas and the preview cannot differ from the message:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/src/admin/badge-email.ts -->
```ts
export default emailBlocks['acceptance_blocks.Badge'];
```

The block's label, palette section, default props and field set come from the
manifest declaration, not from the contribution. A CMS editor config may carry
`fields` to replace the editor of a field the manifest declares — a picker in
place of a text input — and cannot add a field the manifest does not declare.

A declared block with **no** editor renderer is still insertable and editable:
the editor builds its fields from the manifest declaration and shows a neutral
preview that names the block. That is what an overlay module's block gets,
since an overlay module has no admin layer.

### The block stylesheet

`./blocks.css` is one finished stylesheet. Every selector is under a class
prefixed with the module id, and colours and fonts come from the storefront's
theme custom properties with literal fallbacks, so the block follows the
channel's theme and still renders on the admin canvas:

<!-- verbatim-from: backend/acceptance/block-renderers-fixture/blocks.css -->
```css
.acceptance_blocks-badge {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  border-radius: var(--r-md, 6px);
  background: var(--brand-600, #2563eb);
  color: #ffffff;
```

No `@import`, no `@tailwind`, no `@source`, no element selectors. The
storefront imports it through `blocks:generate` and the admin through
`endora generate`.

### When the module is switched off

A block whose module an operator switched off is absent on every surface, and
nothing is written to the stored content:

| Surface | What happens |
| --- | --- |
| Storefront | the block renders nothing to a customer; with `?cms_admin=1` it renders a note naming the block |
| E-mail | the block contributes nothing to the HTML or the text |
| Admin editors | a stored block is a visible placeholder that keeps its props; the block is not offered in the palette |

Switching the module back on restores all three, with no document changed in
between. The storefront decides from the modules the backend reports as not
present, so a block whose owner the backend does not know — an overlay
module's — still renders.

### When a renderer fails

A renderer that throws costs the page that one block. On the storefront and in
the editors it becomes the same placeholder a missing renderer gets, and the
blocks around it are untouched; in an e-mail it contributes nothing, the
message is still sent, and the failure is logged with the block and its
module.

### Check the package

Run `endora check` in the module package. `check:block-renderers` reports:

| Finding | Meaning |
| --- | --- |
| `foreign-block-name` | a renderer keyed by a block another module owns |
| `undeclared-block` | a renderer for a block the manifest does not declare, or not for that surface's context |
| `storefront-import` | the storefront layer imports outside its allowed set |
| `raw-html` | `dangerouslySetInnerHTML` whose value is not `sanitizeRichHtml(…)` |
| `email-layer-import` | the e-mail layer imports React, a Node built-in or anything outside the e-mail renderer |
| `unscoped-stylesheet` | `./blocks.css` has a selector outside the module's prefix, or pulls in another stylesheet |
| `layer-without-subpath` | a layer's sources exist and the `exports` map does not publish them |

### Keep old content rendering

A block's name is permanent, and its stored props outlive the version of the
module that wrote them. A renderer must draw every shape of props the module
ever published: ignore a prop it does not know, and fall back to a default for
one that is missing. A change that cannot be made that way is a new block
under a new name, with the old renderer kept.

## Component name namespacing

Block names are unique platform-wide, and the module-id prefix is what makes
them so: `cms.Text`, `catalog.ProductCard`, `promotions.PromoBanner`. Two
modules cannot declare the same name — the owner segment must be the
declaring module's id — and if a collision reaches the registry anyway it
throws `DuplicateBlockNameError` rather than letting one module's block
replace another's.

## Context availability (`contexts`)

Every component declares which Page Builder surfaces may expose it via
`contexts`:

| Context | Used by |
|---------|---------|
| `cms` | CMS pages, blocks, templates, blog |
| `email` | Transactional email editor |
| `newsletter` | Newsletter campaigns (alias of email-safe set) |
| `invoice` | Invoice PDF template editor |

Declare them on the block in the manifest. `contexts` is required and must
name at least one surface:

```ts
contexts: ['cms'], // CMS-only
```

A block without `email` / `invoice` in `contexts` never appears in those
editors (e.g. a product carousel). A module ships renderers for the `cms` and
`email` contexts; `newsletter` shows the `email` blocks, and invoice blocks are
drawn by the invoices module.

## Responsive props and visibility (CMS only)

The CMS Page Builder supports per-breakpoint overrides with inheritance
(mobile ← tablet ← desktop). Use `createResponsiveField` from
`@endora-commerce/page-builder-core` for individual props and
`withResponsiveVisibility` for a per-component **Visibility** control.

Default breakpoints (configurable via Settings
`cms.page_builder.breakpoint.*` or env `CMS_PB_BREAKPOINT_*`):

- Mobile: &lt; 768px
- Tablet: 768–1023px
- Desktop: ≥ 1024px

Email and invoice builders use a single layout width and do not expose
responsive fields.

**Email builders** (transactional + newsletter) do **not** use CMS Mobile /
Tablet / Desktop viewports. The authoring canvas is fixed at **600px** (mail
width). A **Preview** modal offers **600px** / **320px** HTML frames. Color
fields reuse the CMS color palette.

## Nesting (slots)

Layout components (`Row`, `Columns`) use Puck **slot** fields — nested
content is stored in `props`, not the legacy `zones` map.

## Box model (CMS layout + content)

Layout and content components expose **outer spacing** (margin), **inner
spacing** (padding), and **border** fields on the Responsive tab. Values
support uniform or per-side editing. **Columns** use a responsive column
count (1–12 per breakpoint) with equal-width tracks.

Use `createSpacingField`, `createBorderField`, and `createColorField` from
`@endora-commerce/page-builder-core` when adding new CMS components.

## Built-in Icons / Social

- **`Icons`** — curated Lucide allowlist (~100 icons) in
  `packages/cms-components/src/components/icon-catalog.ts` with a **visual
  grid picker** (`IconPickerField`). Do not expose the full Lucide catalog.
- **`Social`** — brand icons via `react-icons/fa6` (Facebook, X, Instagram,
  LinkedIn, YouTube, TikTok, …). Array items use `getItemSummary` so the
  selected **network name** appears in the Links list. Layouts:
  `icons-only` | `icons-with-labels` | `vertical-list` | `pills`.

## Additional landing components

| Component | Purpose |
| --------- | ------- |
| `Spacer` | Vertical space + optional divider |
| `FeatureList` | Icon + title + description columns |
| `Hero` | Background + heading + CTA first-fold |
| `LogoStrip` | Partner / trust logos |
| `Testimonial` | Quote + author |
| `Stats` | KPI strip |
| `AnnouncementBar` | Thin promo strip |
| `SimpleTable` | Pipe-separated headers/rows |
| `NewsletterSignup` | Email form (wire `actionUrl` to newsletter) |
| `ContactFormEmbed` | Iframe embed or mailto fallback |

## Suggested follow-up (deeper integrations)

| Priority | Idea | Why |
| -------- | ---- | --- |
| Medium | Newsletter ↔ module 048 | Auto-wire channel subscribe endpoint |
| Low | Contact ↔ forms module | Pick an existing form instead of iframe URL |

`Accordion` / `Tabs` already cover FAQ-style sections; prefer those before a
dedicated FAQ component.

## Testing

The platform ships a TDD scaffold for the SPI in
`backend/test/integration/cms/page-builder-extension.test.ts`. Use the
fixture in `backend/test/fixtures/cms/test-extension-module.ts` as a
template when adding tests for your own contributions.
