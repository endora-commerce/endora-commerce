import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  BASE,
  CH_RETAIL,
  PRODUCT_ID,
  VALID_SCOPES,
  api,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-020, FR-026, FR-050,
 * contracts/admin-surfaces.md §4) on the feature 174 editor — on the product's
 * Attributes tab a Page Builder content attribute is a compact card, never an
 * input and never an inline canvas: its label, a status chip per editing
 * language, a summary of what is stored, and **Edit content**, which opens the
 * product content screen.
 *
 * A content attribute holds no scoped value (feature 174): the scoped read does
 * not list it, so the cards come from the content summaries read
 * (`GET …/content`, research R-3 — never the documents), once per attribute
 * set, and they are the same at every scope — a document is per language, and
 * its own screen edits every language.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const SET_ID = '55555555-5555-4555-8555-555555555505';
const OTHER_SET_ID = '55555555-5555-4555-8555-555555555506';
const AT_G = `/catalog/products/${PRODUCT_ID}?tab=attributes`;
const AT_CL = `/catalog/products/${PRODUCT_ID}?scope=cl&channel=${CH_RETAIL}&language=pl-PL&tab=attributes`;

const CONTENT_LIST = {
  productId: PRODUCT_ID,
  attributeSetId: SET_ID,
  attributes: [
    { attributeId: 'a-banner', key: 'banner', label: { 'en-US': 'Banner' }, labelDefault: 'Banner', position: 1, languages: [] },
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

function read(scope: ScopeRef) {
  const base = scopedValuesResponse({ scope, validScopes: VALID_SCOPES });
  return scopedValuesResponse({
    scope,
    validScopes: VALID_SCOPES,
    product: { ...base.data.product, attributeSetId: SET_ID },
    attributes: [
      {
        key: 'material',
        label: { 'en-US': 'Material' },
        valueType: 'string',
        isRequired: false,
        view: scopedField<unknown>('steel', { source: 'set', ownValue: 'steel', levels: ['G', 'C', 'CL'] }),
      },
    ],
  });
}

function extra(path: string): unknown {
  if (path === `${BASE}/content`) return { data: CONTENT_LIST };
  if (path === '/api/v1/admin/catalog/attribute-sets') {
    return { data: [{ id: SET_ID, code: 'tools', isSystem: false }, { id: OTHER_SET_ID, code: 'garden', isSystem: false }] };
  }
  return undefined;
}

function EditorStub(): React.ReactNode {
  return <span data-testid="editor" />;
}
function ProtectionStub(): React.ReactNode {
  return <span data-testid="field-protection" />;
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

const PERMISSIONS = ['catalog:read', 'catalog:write', 'cms.read'];

const fill = (key: string, params: Record<string, string | number>): string =>
  Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key]!);

const cards = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-content-attribute]'));
const contentReads = (): number => api.get.mock.calls.filter(([path]) => path === `${BASE}/content`).length;

beforeEach(() => {
  setUpEditorApi({ read, extra });
});
afterEach(() => cleanup());

describe('Attributes tab — content attribute cards (feature 172 on the 174 editor)', () => {
  it('shows one card per content attribute, in set order, spanning the grid, with chips, summary and Edit content', async () => {
    renderEditor(ProductEditor, { url: AT_G, permissions: PERMISSIONS, contributions: CONTRIBUTIONS });
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(cards().map((card) => card.getAttribute('data-content-attribute'))).toEqual(['banner', 'buying_guide']);
    for (const card of cards()) expect(card.style.gridColumn).toBe('1 / -1');

    const guide = cards()[1]!;
    expect(within(guide).getByText('Buying guide')).toBeTruthy();
    expect(within(guide).getByText(fill('productContent.card.filled', { language: 'en-US' }))).toBeTruthy();
    expect(within(guide).getByText(fill('productContent.card.empty', { language: 'pl-PL' }))).toBeTruthy();
    expect(within(guide).getByText(fill('productContent.card.summary', { blocks: 3, excerpt: 'Choosing the right drill' }))).toBeTruthy();
    const edit = await within(guide).findByRole('link', { name: en['productContent.card.edit']! });
    expect(edit.getAttribute('href')).toBe(`/catalog/products/${PRODUCT_ID}/content/buying_guide`);

    const banner = cards()[0]!;
    expect(within(banner).getByText(fill('productContent.card.empty', { language: 'en-US' }))).toBeTruthy();
    expect(within(banner).getByText(en['productContent.card.emptySummary']!)).toBeTruthy();
  });

  it('renders no input and mounts no field protection for a content attribute; the ordinary one keeps both', async () => {
    renderEditor(ProductEditor, { url: AT_G, permissions: PERMISSIONS, contributions: CONTRIBUTIONS });
    await waitFor(() => expect(cards()).toHaveLength(2));
    for (const card of cards()) {
      expect(card.querySelector('input, select, textarea')).toBeNull();
      expect(within(card).queryByTestId('field-protection')).toBeNull();
    }
    expect(await screen.findByDisplayValue('steel')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('field-protection')).toHaveLength(1));
  });

  it('shows the same cards, with their link, at Channel × language', async () => {
    renderEditor(ProductEditor, { url: AT_CL, permissions: PERMISSIONS, contributions: CONTRIBUTIONS });
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(within(cards()[1]!).getByText(fill('productContent.card.filled', { language: 'en-US' }))).toBeTruthy();
    expect(await within(cards()[1]!).findByRole('link', { name: en['productContent.card.edit']! })).toBeTruthy();
    // The summaries, never the documents: the one content read is the list (research R-3).
    expect(api.get.mock.calls.every(([path]) => !String(path).startsWith(`${BASE}/content/`))).toBe(true);
    expect(contentReads()).toBeGreaterThan(0);
  });

  const noEditorCases: Array<[string, { contributions?: typeof CONTRIBUTIONS; absent?: string[]; permissions?: string[] }]> = [
    ['nothing contributes an editor', { contributions: [] }],
    ['the CMS is off', { absent: ['cms'] }],
    ['the operator lacks the CMS read code', { permissions: ['catalog:read', 'catalog:write'] }],
  ];
  for (const [label, options] of noEditorCases) {
    it(`keeps the chips and the summary, says there is no editor, and offers no link when ${label} (FR-050)`, async () => {
      renderEditor(ProductEditor, {
        url: AT_G,
        permissions: options.permissions ?? PERMISSIONS,
        contributions: options.contributions ?? CONTRIBUTIONS,
        ...(options.absent ? { absent: options.absent } : {}),
      });
      await waitFor(() => expect(cards()).toHaveLength(2));
      await waitFor(() => expect(within(cards()[1]!).getByText(en['productContent.card.noEditor']!)).toBeTruthy());
      const guide = cards()[1]!;
      expect(within(guide).getByText(fill('productContent.card.filled', { language: 'en-US' }))).toBeTruthy();
      expect(within(guide).getByText(fill('productContent.card.summary', { blocks: 3, excerpt: 'Choosing the right drill' }))).toBeTruthy();
      for (const card of cards()) expect(within(card).queryByRole('link')).toBeNull();
    });
  }

  it('says to save the set first, with no link, while another attribute set is staged', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}`, permissions: PERMISSIONS, contributions: CONTRIBUTIONS });
    const select = await screen.findByLabelText(en['productEditor.field.attributeSet']!);
    await within(select).findByRole('option', { name: 'garden' });
    fireEvent.change(select, { target: { value: OTHER_SET_ID } });
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.attributes']! }));
    await waitFor(() => expect(cards()).toHaveLength(2));
    for (const card of cards()) {
      expect(within(card).getByText(en['productContent.card.saveSetFirst']!)).toBeTruthy();
      expect(within(card).queryByRole('link')).toBeNull();
    }
  });
});
