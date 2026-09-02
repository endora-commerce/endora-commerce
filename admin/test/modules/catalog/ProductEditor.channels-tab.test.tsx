import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * The product editor's Channels tab is a zone, and its **button** is counted
 * rather than named (feature 091, P7a; Z15).
 *
 * ## The defect this replaces
 *
 * `ProductEditor.tsx` imported `sales_channels`' `EntityChannelMembership` and
 * rendered it as the whole body of a tab it showed unconditionally. The host
 * keeps the tab and its label — that is its own vocabulary (Z14) — and stops
 * knowing which module fills it: the body is
 * `<AdminZone name="product.editor.channels" …>` and the button is shown by
 * `useAdminZone(...).length > 0`, which has already applied both presence axes
 * and the contributor's own permission (§4).
 *
 * That is byte-for-byte `delivery_methods`' integrations card, applied to a
 * tab. It matters because the alternative — leaving the button unconditional —
 * offers an operator a tab that renders an empty panel, which is the state the
 * host cannot distinguish from a broken one.
 *
 * ## Why the contribution is a stub here and real in the contributor's own test
 *
 * The subject is the **host's** counting, so what is asserted is that a tab
 * appears with a contribution and does not without one. Whether
 * `sales_channels`' declaration names the right zone and the right code is
 * asserted against the shipped declaration in
 * `admin/test/modules/sales_channels/product-channels-zone.test.tsx`.
 */

const getSpy = vi.fn();

// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepts
// nothing and vitest reports that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor', () => ({
  ProductScopeEditor: vi.fn(() => null),
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111101';

const BUNDLE = passthroughBundle('catalog', [
  'productEditor.loading',
  'productEditor.section.identity',
  'productEditor.field.sku',
  'productEditor.field.status',
  'productEditor.field.type',
  'productEditor.field.visibility',
  'productEditor.field.attributeSet',
]);

const MOCK_PRODUCT = {
  id: PRODUCT_ID,
  sku: 'CHANNEL-TAB',
  slug: 'channel-tab',
  type: 'simple' as const,
  status: 'draft' as const,
  name: { 'en-US': 'Test product', 'pl-PL': '' },
  description: { 'en-US': 'Desc', 'pl-PL': '' },
  visibility: 'public' as const,
  attributeValues: { defaultPrice: 10 },
  attributeSetId: '22222222-2222-4222-8222-222222222202',
};

/** A contribution that renders a marker, so "the tab body is the zone" is visible. */
const CHANNELS_CONTRIBUTION = {
  moduleId: 'sales_channels',
  contributions: {
    zones: [
      {
        zone: 'product.editor.channels' as const,
        weight: 100,
        requiredPermission: 'sales_channels:read',
        component: async () => ({
          default: (): string => 'channel-membership-stub',
        }),
      },
    ],
  },
};

function renderEditor(options: {
  readonly contributions?: readonly (typeof CHANNELS_CONTRIBUTION)[];
  readonly permissions?: readonly string[];
}): void {
  renderWithSession(
    <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}`]}>
      <Routes>
        <Route path="/catalog/products/:id" element={<ProductEditor />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: [...(options.permissions ?? ['*'])] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      ...(options.contributions === undefined ? {} : { contributions: options.contributions }),
      bundle: BUNDLE,
    },
  );
}

function channelsTab(): HTMLElement | null {
  // `role="tab"`, not `button` — the strip is a tab list and the accessible
  // role is what an operator's assistive technology sees.
  return screen.queryByRole('tab', { name: /Channels/i });
}

describe('ProductEditor — the Channels tab is counted, not named', () => {
  beforeEach(() => {
    getSpy.mockReset();
    getSpy.mockImplementation((path: string) => {
      if (path.includes('/attribute-sets')) {
        return Promise.resolve({
          data: [
            {
              id: MOCK_PRODUCT.attributeSetId,
              code: 'default',
              name: { 'en-US': 'Default' },
              isSystem: true,
            },
          ],
        });
      }
      if (path.includes(`/catalog/products/${PRODUCT_ID}`)) {
        return Promise.resolve({ data: MOCK_PRODUCT });
      }
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the tab when something contributes to the zone', async () => {
    renderEditor({ contributions: [CHANNELS_CONTRIBUTION] });
    await waitFor(() => expect(channelsTab()).not.toBeNull());
  });

  it('hides the tab when nothing contributes to the zone', async () => {
    // The screen has to have rendered, or the absence proves nothing: a subject
    // that never mounted looks exactly like a pass.
    renderEditor({});
    await waitFor(() =>
      expect(screen.queryAllByLabelText('productEditor.field.sku').length).toBeGreaterThan(0),
    );
    expect(channelsTab()).toBeNull();
  });

  it('hides the tab when the operator lacks the contributor’s permission', async () => {
    // The counting runs the whole filter, so a contribution the operator cannot
    // reach takes the tab with it rather than leaving an empty one.
    renderEditor({ contributions: [CHANNELS_CONTRIBUTION], permissions: ['catalog:write'] });
    await waitFor(() =>
      expect(screen.queryAllByLabelText('productEditor.field.sku').length).toBeGreaterThan(0),
    );
    expect(channelsTab()).toBeNull();
  });

  it('names no contributing module in its own source', async () => {
    // The evidence that the conversion converted something: the three admin
    // keys in `cross-module-imports/catalog.ts` retire on this file no longer
    // importing two other modules' components.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(
        process.cwd(),
        // Re-keyed by feature 091's Phase 4 batch 15: `catalog` took its admin
        // surface into its own package and this screen went with it. A
        // `readFileSync` of the old path throws rather than reporting the reach
        // this case measures.
        '../packages/modules/catalog/src/admin/pages/ProductEditor.tsx',
      ),
      'utf8',
    );
    expect(source).not.toContain('EntityChannelMembership');
    expect(source).not.toContain('LinkedPriceListsPanel');
    expect(source).toContain("useAdminZone('product.editor.channels'");
    expect(source).toContain('name="product.editor.pricing.after"');
  });
});
