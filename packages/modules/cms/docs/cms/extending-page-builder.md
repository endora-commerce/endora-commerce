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
2. **Shared renderer**: ship a React component to a workspace package both
   admin and storefront depend on (typically `@endora-commerce/cms-components` itself
   or a per-module package re-exporting from it).

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

## 2. Ship the renderer

Add a React `ComponentConfig` in `packages/cms-components/src/components/`
(or in your module's own admin/storefront package) and export it from the
package's entry point:

```tsx
// packages/cms-components/src/components/PromoBanner.tsx
import type { ComponentConfig } from '@puckeditor/core';

interface Props {
  headline: string;
  codeInput?: string;
  tone: 'info' | 'urgent';
}

export const PromoBanner: ComponentConfig<Props> = {
  fields: {
    headline: { type: 'text' },
    codeInput: { type: 'text' },
    tone: { type: 'select', options: [
      { label: 'Info', value: 'info' },
      { label: 'Urgent', value: 'urgent' },
    ] },
  },
  defaultProps: { headline: 'Spring sale', tone: 'info' },
  contexts: ['cms'],
  render: ({ headline, codeInput, tone }) => (
    <div className={`promo-banner promo-${tone}`}>
      <strong>{headline}</strong>
      {codeInput ? <code>{codeInput}</code> : null}
    </div>
  ),
};
```

Wire it into the `defaultPageBuilderConfig` under the block's full name, so
both the admin editor and the storefront `<Render>` call sites pick it up:

```ts
// packages/cms-components/src/index.ts
import { PromoBanner } from './components/PromoBanner.js';

export const defaultPageBuilderConfig: Config = {
  components: {
    // ...the existing 'cms.*' and 'catalog.*' entries
    'promotions.PromoBanner': definePageBuilderComponent({
      ...(PromoBanner as unknown as ComponentConfig),
      contexts: ['cms'],
    }),
  },
};
```

The CMS renderers are this one bundle (e-mail blocks render from
`@endora-commerce/email-components` the same way). A module published
outside this repository cannot add a renderer to either bundle without a
change to that package.

A renderer omitted from the bundle does not break the admin: the
`PageBuilderEditor` merges the descriptor with the local config and
substitutes a `MissingComponentPlaceholder` for any component the
descriptor names but the bundle does not export. The placeholder renders
nothing on the storefront unless the page is loaded with the
`?cms_admin=1` query parameter (preview mode).

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

In `@endora-commerce/cms-components`, wrap the Puck config with
`definePageBuilderComponent` from `@endora-commerce/page-builder-core` so the admin
palette filter stays in sync. Components without `email` / `invoice` in
`contexts` never appear in those editors (e.g. a product carousel).

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
