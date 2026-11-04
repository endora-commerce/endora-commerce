import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-020, FR-026,
 * contracts/admin-surfaces.md §4) — on the product's Attributes tab a Page
 * Builder content attribute is a compact card, never an input and never an
 * inline canvas: its label, a status chip per editing language, a summary of
 * what is stored, and **Edit content**, which opens the product content screen.
 *
 * The card reads the summaries, never the documents (research R-3).
 */

const getSpy = vi.fn();

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

const { ProductAttributesTab } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductAttributesTab'
);

const EN = catalogEn as Record<string, string>;
const PRODUCT_ID = '44444444-4444-4444-8444-444444444404';
const SET_ID = '55555555-5555-4555-8555-555555555505';
const OTHER_SET_ID = '55555555-5555-4555-8555-555555555506';

const SET_ATTRIBUTES = [
  { id: 'a-plain', key: 'material', label: { 'en-US': 'Material' }, valueType: 'string', position: 0, languageScoped: false },
  { id: 'a-guide', key: 'buying_guide', label: { 'en-US': 'Buying guide' }, valueType: 'page_builder', position: 2, languageScoped: true },
  { id: 'a-banner', key: 'banner', label: { 'en-US': 'Banner' }, valueType: 'page_builder', position: 1, languageScoped: true },
];

const CONTENT_LIST = {
  productId: PRODUCT_ID,
  attributeSetId: SET_ID,
  attributes: [
    {
      attributeId: 'a-banner',
      key: 'banner',
      label: { 'en-US': 'Banner' },
      labelDefault: 'Banner',
      position: 1,
      languages: [],
    },
    {
      attributeId: 'a-guide',
      key: 'buying_guide',
      label: { 'en-US': 'Buying guide' },
      labelDefault: 'Buying guide',
      position: 2,
      languages: [{ language: 'en-US', filled: true, blocks: 3, excerpt: 'Choosing the right drill' }],
    },
  ],
};

function ProtectionStub(): React.ReactNode {
  return <span data-testid="field-protection" />;
}
function EditorStub(): React.ReactNode {
  return <span data-testid="editor" />;
}

const CONTRIBUTIONS = [
  {
    moduleId: 'cms',
    contributions: {
      zones: [
        {
          zone: 'product.content.editor' as const,
          weight: 100,
          requiredPermission: 'cms.read',
          component: async () => ({ default: EditorStub as never }),
        },
        // A per-value protection, standing in for a connector's: mounted beside
        // every ordinary value and never beside a content card.
        {
          zone: 'product.editor.field.after' as const,
          weight: 100,
          component: async () => ({ default: ProtectionStub as never }),
        },
      ],
    },
  },
];

function render(
  props: { productId?: string | null; attributeSetId?: string; savedAttributeSetId?: string },
  options: {
    readonly contributions?: typeof CONTRIBUTIONS;
    readonly permissions?: readonly string[];
    readonly absent?: readonly string[];
  } = {},
): void {
  renderWithSession(
    <MemoryRouter>
      <ProductAttributesTab
        productId={'productId' in props ? props.productId : PRODUCT_ID}
        attributeSetId={props.attributeSetId ?? SET_ID}
        savedAttributeSetId={props.savedAttributeSetId ?? SET_ID}
        values={{ material: 'steel' }}
        onChange={vi.fn()}
      />
    </MemoryRouter>,
    {
      session: adminSession({ permissions: [...(options.permissions ?? ['*'])] }),
      presence: modulePresence({
        present: everyDeclaredModule().filter((id) => !(options.absent ?? []).includes(id)),
        absent: [...(options.absent ?? [])],
      }),
      contributions: options.contributions ?? CONTRIBUTIONS,
      bundle: { catalog: EN },
    },
  );
}

const fill = (key: string, params: Record<string, string | number>): string =>
  Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), EN[key]!);

beforeEach(() => {
  getSpy.mockReset().mockImplementation(async (path: string) => {
    if (path === `/api/v1/admin/catalog/attribute-sets/${SET_ID}` || path === `/api/v1/admin/catalog/attribute-sets/${OTHER_SET_ID}`) {
      return { data: { attributes: SET_ATTRIBUTES } };
    }
    if (path === `/api/v1/admin/catalog/products/${PRODUCT_ID}/content`) return { data: CONTENT_LIST };
    throw new Error(`unexpected GET ${path}`);
  });
});

const cards = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-content-attribute]'));

describe('ProductAttributesTab — content attribute cards (feature 172)', () => {
  it('shows one card per content attribute, in set order, spanning the grid, with chips, summary and Edit content', async () => {
    render({});
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(cards().map((card) => card.getAttribute('data-content-attribute'))).toEqual(['banner', 'buying_guide']);
    for (const card of cards()) expect(card.style.gridColumn).toBe('1 / -1');

    const guide = cards()[1]!;
    expect(within(guide).getByText('Buying guide')).toBeTruthy();
    expect(within(guide).getByText(fill('productContent.card.filled', { language: 'en-US' }))).toBeTruthy();
    expect(within(guide).getByText(fill('productContent.card.empty', { language: 'pl-PL' }))).toBeTruthy();
    expect(
      within(guide).getByText(fill('productContent.card.summary', { blocks: 3, excerpt: 'Choosing the right drill' })),
    ).toBeTruthy();
    const edit = within(guide).getByRole('link', { name: EN['productContent.card.edit']! });
    expect(edit.getAttribute('href')).toBe(`/catalog/products/${PRODUCT_ID}/content/buying_guide`);

    // A language emptied of every block counts as empty (US2 #8).
    const banner = cards()[0]!;
    expect(within(banner).getByText(fill('productContent.card.empty', { language: 'en-US' }))).toBeTruthy();
    expect(within(banner).getByText(EN['productContent.card.emptySummary']!)).toBeTruthy();
  });

  it('renders no input and mounts no field protection for a content attribute', async () => {
    render({});
    await waitFor(() => expect(cards()).toHaveLength(2));
    for (const card of cards()) {
      expect(card.querySelector('input, select, textarea')).toBeNull();
      expect(within(card).queryByTestId('field-protection')).toBeNull();
    }
    // The ordinary attribute keeps its input and its protection zone.
    expect(screen.getByDisplayValue('steel')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('field-protection')).toHaveLength(1));
  });

  it('says to save the product first, with no link, while it is being created (FR-026)', async () => {
    render({ productId: null });
    await waitFor(() => expect(cards()).toHaveLength(2));
    for (const card of cards()) {
      expect(within(card).getByText(EN['productContent.card.saveFirst']!)).toBeTruthy();
      expect(within(card).queryByRole('link')).toBeNull();
    }
    expect(getSpy).not.toHaveBeenCalledWith(`/api/v1/admin/catalog/products/${PRODUCT_ID}/content`);
  });

  // FR-050 — with no `product.content.editor` contributor the card keeps its
  // status, so the operator still sees what is stored, and offers no way in.
  const noEditorCases: Array<[string, Parameters<typeof render>[1]]> = [
    ['nothing contributes an editor', { contributions: [] }],
    ['the CMS is off', { absent: ['cms'] }],
    ['the operator lacks the CMS read code', { permissions: ['catalog:read', 'catalog:write'] }],
  ];
  for (const [label, options] of noEditorCases) {
    it(`keeps the chips and the summary, says there is no editor, and offers no link when ${label} (FR-050)`, async () => {
      render({}, options);
      await waitFor(() => expect(cards()).toHaveLength(2));
      await waitFor(() =>
        expect(within(cards()[1]!).getByText(EN['productContent.card.noEditor']!)).toBeTruthy(),
      );
      const guide = cards()[1]!;
      expect(within(guide).getByText(fill('productContent.card.filled', { language: 'en-US' }))).toBeTruthy();
      expect(
        within(guide).getByText(fill('productContent.card.summary', { blocks: 3, excerpt: 'Choosing the right drill' })),
      ).toBeTruthy();
      for (const card of cards()) expect(within(card).queryByRole('link')).toBeNull();
    });
  }

  it('says to save the set first, with no link, when the Details tab chose another set', async () => {
    render({ attributeSetId: OTHER_SET_ID, savedAttributeSetId: SET_ID });
    await waitFor(() => expect(cards()).toHaveLength(2));
    for (const card of cards()) {
      expect(within(card).getByText(EN['productContent.card.saveSetFirst']!)).toBeTruthy();
      expect(within(card).queryByRole('link')).toBeNull();
    }
  });
});
