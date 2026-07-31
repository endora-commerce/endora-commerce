---
sidebar_position: 2
---

# Extending the Page Builder

The CMS module ships built-in components — `Row`, `Columns`, `Text`,
`Heading`, `Button`, `InsertBlock`, and others — but every other
backend module can contribute its own components through an in-process
service-provider interface (SPI). (`InsertTemplate` remains registered for
legacy content trees but is no longer listed in the drawer palette.)
A contributing module participates in three places:

1. **Backend descriptor**: register field metadata at composition time so
   the admin's component palette can render the editor controls.
2. **Shared renderer**: ship a React component to a workspace package both
   admin and storefront depend on (typically `@b2b/cms-components` itself
   or a per-module package re-exporting from it).
3. **Composition wiring**: pass the contributing module's registration
   helper to the platform's composition root before the CMS plugin is
   instantiated.

## 1. Declare the descriptor

In your module's `plugin.ts` (or a dedicated `register-page-builder.ts`),
declare a function that takes the registry and registers your components:

```ts
// backend/src/modules/promotions/services/register-page-builder.ts
import type { PageBuilderRegistry } from '../../cms/services/page-builder-registry.js';

export function registerPromotionsPageBuilderComponents(
  registry: PageBuilderRegistry,
): void {
  registry.register('promotions', {
    components: {
      PromoBanner: {
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
        /** Omit email/invoice — this component is storefront-only. */
        contexts: ['cms'],
      },
    },
  });
}
```

Field types are taken from the closed enum declared in
`packages/contracts/src/cms.ts`: `text | textarea | number | select |
radio | array | object | external | uuid | richtext`. This metadata is
React-free; the backend never imports a renderer.

## 2. Ship the renderer

Add a React `ComponentConfig` in `packages/cms-components/src/components/`
(or in your module's own admin/storefront package) and export it from the
package's entry point:

```tsx
// packages/cms-components/src/components/PromoBanner.tsx
import type { ComponentConfig } from '@measured/puck';

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

Wire it into the `defaultPageBuilderConfig` so both the admin editor and
the storefront `<Render>` call sites pick it up:

```ts
// packages/cms-components/src/index.ts
import { PromoBanner } from './components/PromoBanner.js';

export * from './components/PromoBanner.js';

export const defaultPageBuilderConfig = {
  // ...existing categories
  components: {
    Row,
    Columns,
    Text,
    Heading,
    Button,
    InsertBlock,
    InsertTemplate,
    PromoBanner,
  },
};
```

A renderer omitted from the bundle does not break the admin: the
`PageBuilderEditor` merges the descriptor with the local config and
substitutes a `MissingComponentPlaceholder` for any component the
descriptor names but the bundle does not export. The placeholder renders
nothing on the storefront unless the page is loaded with the
`?cms_admin=1` query parameter (preview mode).

## 3. Wire composition

Call your registration helper from `composition.ts` before the CMS module
is instantiated:

```ts
// backend/src/composition.ts
const cms = cmsModule({ emFactory, requireAdmin });
registerPromotionsPageBuilderComponents(cms.handle.pageBuilderRegistry);
```

The CMS module's plugin reads the registry on every
`GET /api/v1/admin/cms/page-builder/config` call, so registering after the
module instance is constructed is fine — the editor picks the new
component up on the next admin reload.

## Component name namespacing

Component names are unique platform-wide. The registry warns and
overwrites on collisions; reviewers should reject changes that produce a
warning. By convention, prefix names with the contributing module's
domain when ambiguity is likely (`PromoBanner`, `CatalogProductCard`,
etc.).

## Context availability (`contexts`)

Every component declares which Page Builder surfaces may expose it via
`contexts`:

| Context | Used by |
|---------|---------|
| `cms` | CMS pages, blocks, templates, blog |
| `email` | Transactional email editor |
| `newsletter` | Newsletter campaigns (alias of email-safe set) |
| `invoice` | Invoice PDF template editor |

Register on the backend descriptor:

```ts
contexts: ['cms'], // default when omitted in registry — CMS-only
```

In `@b2b/cms-components`, wrap the Puck config with
`definePageBuilderComponent` from `@b2b/page-builder-core` so the admin
palette filter stays in sync. Components without `email` / `invoice` in
`contexts` never appear in those editors (e.g. a product carousel).

## Responsive props and visibility (CMS only)

The CMS Page Builder supports per-breakpoint overrides with inheritance
(mobile ← tablet ← desktop). Use `createResponsiveField` from
`@b2b/page-builder-core` for individual props and
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
`@b2b/page-builder-core` when adding new CMS components.

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
