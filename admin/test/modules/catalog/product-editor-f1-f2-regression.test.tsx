import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  BASE,
  CH_RETAIL,
  PRODUCT_ID,
  api,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 172 (T027, US1 #1–#3; FR-002, FR-003) — the regression of the two defects the
 * feature was opened for: F1, a save at one scope rewriting the other languages' texts, and
 * F2, the attributes tab rendering a per-language map as `[object Object]`.
 *
 * The editor at Retail PL × German, holding values in three languages, changes one
 * unrelated field and saves: the request carries that one cell and nothing else. The
 * attributes tab shows a text attribute's value as text at every scope.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const VALID = {
  channels: [
    {
      channelId: CH_RETAIL,
      name: 'Retail PL',
      languages: [
        { code: 'pl-PL', name: 'Polish' },
        { code: 'en-US', name: 'English' },
        { code: 'de-DE', name: 'German' },
      ],
    },
  ],
};

function read(scope: ScopeRef) {
  return scopedValuesResponse({
    scope,
    version: '41',
    validScopes: VALID,
    fields: {
      name: scopedField('Bohrmaschine X', { source: 'set', ownValue: 'Bohrmaschine X', required: true }),
      description: scopedField('Kompakt', { source: 'set', ownValue: 'Kompakt' }),
    },
    attributes: [
      {
        key: 'material',
        label: { 'en-US': 'Material' },
        valueType: 'string',
        isRequired: false,
        view: scopedField<unknown>('Stahl', { source: 'set', ownValue: 'Stahl' }),
      },
    ],
  });
}

beforeEach(() => {
  setUpEditorApi({ read });
  api.put.mockImplementation(async (path: string) =>
    path.endsWith('/scoped-values') ? { ...read({ level: 'channel_language', channelId: CH_RETAIL, languageCode: 'de-DE' }), warnings: [] } : { data: null },
  );
});
afterEach(() => cleanup());

const AT_DE = `/catalog/products/${PRODUCT_ID}?scope=cl&channel=${CH_RETAIL}&language=de-DE`;

describe('US1 regression (feature 172, F1 + F2)', () => {
  it('a save sends only the staged cell, at the scope, with the version read', async () => {
    renderEditor(ProductEditor, { url: AT_DE });
    const description = await screen.findByLabelText(en['productEditor.field.description']!);
    fireEvent.change(description, { target: { value: 'Kompakt und leicht' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${BASE}/scoped-values`, expect.anything()));
    const [, body] = api.put.mock.calls.find(([path]) => path === `${BASE}/scoped-values`)!;
    expect(body).toEqual({
      scope: { channelId: CH_RETAIL, languageCode: 'de-DE' },
      version: '41',
      changes: { description: 'Kompakt und leicht' },
    });
    // No other write route was called for the save.
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    ['Global', `/catalog/products/${PRODUCT_ID}?scope=global&tab=attributes`],
    ['Channel', `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}&tab=attributes`],
    ['Channel × language', `${AT_DE}&tab=attributes`],
  ])('the attributes tab shows a text value as text at %s (F2)', async (_name, at) => {
    const view = renderEditor(ProductEditor, { url: at });
    expect(await screen.findByDisplayValue('Stahl')).toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain('[object Object]');
    expect(view.container.innerHTML).not.toMatch(/\{&quot;[a-z]{2}-[A-Z]{2}&quot;/);
  });
});
