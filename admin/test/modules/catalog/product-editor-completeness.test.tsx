import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { CompletenessSummary, ScopeRef } from '@endora-commerce/contracts';
import {
  CH_RETAIL,
  PRODUCT_ID,
  VALID_SCOPES,
  currentSearch,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 170 (T129; US11 #1–#3, FR-097, `contracts/editor-ui.md` §9) — the completeness
 * summary in the scope bar, from saved values: at C×L "Missing here: Name, URL key" whose
 * items open the field; at C "Missing in this channel: Name (Polish, English)"; at G
 * "N incomplete scopes — Scope map"; nothing when the scope is complete.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const AT_CL = `/catalog/products/${PRODUCT_ID}?scope=cl&channel=${CH_RETAIL}&language=pl-PL`;
const AT_C = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`;

function withCompleteness(completeness: CompletenessSummary) {
  return (scope: ScopeRef) =>
    scopedValuesResponse({
      scope,
      validScopes: VALID_SCOPES,
      completeness,
      fields: { name: scopedField<string>(null, { source: 'absent', required: true }), urlKey: scopedField<string>(null, { source: 'absent', required: true }) },
    });
}

function summary(): HTMLElement {
  return screen.getByTestId('completeness-summary');
}

afterEach(() => cleanup());

describe('completeness at the editor scope (feature 170, US11)', () => {
  it('C×L: names each missing field, and each item opens its field', async () => {
    setUpEditorApi({ read: withCompleteness({ level: 'channel_language', missing: ['name', 'urlKey'] }) });
    const view = renderEditor(ProductEditor, { url: `${AT_CL}&tab=attributes` });
    await waitFor(() => expect(summary()).toHaveTextContent(en['productEditor.completeness.here']!));
    const urlKey = within(summary()).getByRole('link', { name: en['productEditor.field.urlKey']! });
    expect(within(summary()).getByRole('link', { name: en['productEditor.field.name']! })).toHaveAttribute(
      'href',
      expect.stringContaining('field=name'),
    );
    fireEvent.click(urlKey);
    await waitFor(() => expect(currentSearch(view).get('tab')).toBe('details'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(en['productEditor.field.urlKey']!)));
  });

  it('C: lists the fields missing across the channel languages, by language name', async () => {
    setUpEditorApi({
      read: withCompleteness({ level: 'channel', missing: [{ field: 'name', languages: ['pl-PL', 'en-US'] }] }),
    });
    renderEditor(ProductEditor, { url: AT_C });
    await waitFor(() => expect(summary()).toHaveTextContent(en['productEditor.completeness.channel']!));
    expect(summary()).toHaveTextContent(`${en['productEditor.field.name']} (Polish, English)`);
  });

  it('G: counts the incomplete scopes and links the scope map', async () => {
    setUpEditorApi({ read: withCompleteness({ level: 'global', incompleteScopes: 3 }) });
    const view = renderEditor(ProductEditor);
    await waitFor(() => expect(summary()).toHaveTextContent('3 incomplete scopes'));
    fireEvent.click(within(summary()).getByRole('link', { name: en['productEditor.scope.scopeMap']! }));
    await waitFor(() => expect(currentSearch(view).get('tab')).toBe('scopes'));
  });

  it('a complete scope shows nothing', async () => {
    setUpEditorApi({ read: withCompleteness({ level: 'channel_language', missing: [] }) });
    renderEditor(ProductEditor, { url: AT_CL });
    await screen.findByLabelText(en['productEditor.field.name']!);
    expect(screen.queryByTestId('completeness-summary')).toBeNull();
  });
});
