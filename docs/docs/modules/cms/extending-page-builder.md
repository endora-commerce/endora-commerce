---
sidebar_position: 2
---

# Extending the Page Builder

The CMS module ships seven built-in components — `Row`, `Columns`, `Text`,
`Heading`, `Button`, `InsertBlock`, `InsertTemplate` — but every other
backend module can contribute its own components through an in-process
service-provider interface (SPI). A contributing module participates in
three places:

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

## Schema versioning

When a component's `props` shape changes in a backwards-incompatible way,
bump its `schema_version` and add an upgrader in
`backend/src/modules/cms/services/content-schema-upgrader.ts`. The
upgrader walks every saved tree at boot and rewrites nodes in place, so
authors don't have to re-edit pages by hand.

## Testing

The platform ships a TDD scaffold for the SPI in
`backend/test/integration/cms/page-builder-extension.test.ts`. Use the
fixture in `backend/test/fixtures/cms/test-extension-module.ts` as a
template when adding tests for your own contributions.
