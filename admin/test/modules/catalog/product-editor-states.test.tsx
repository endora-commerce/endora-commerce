import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
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
 * Feature 174 (S3 block 2; `contracts/editor-ui.md` §3, §6, §11; FR-070, FR-080, FR-081) — the
 * editor's states beyond one Save: a failed read offers Retry instead of a skeleton forever,
 * the redirects say "Applies immediately" and have loading and error states, read-only mode
 * (T110) hides the whole-product menu and Save, global-only tabs show their content read-only
 * outside Global, the success line is a polite status cleared by the next edit, and focus stays
 * on Save after it has saved.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductInventoryTab', () => ({
  ProductInventoryTab: (): string => 'stock panel stub',
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const AT_C = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`;
const REDIRECT_ID = '00000000-0000-4000-8000-0000000000e1';

function read(scope: ScopeRef) {
  return scopedValuesResponse({
    scope,
    version: '4',
    validScopes: VALID_SCOPES,
    fields: { name: scopedField('Drill', { source: 'set', ownValue: 'Drill', required: true }) },
  });
}

function urlKeys(redirects: unknown[] | undefined) {
  return { data: { productId: PRODUCT_ID, keys: [], ...(redirects ? { redirects } : {}) } };
}

beforeEach(() => {
  setUpEditorApi({ read });
  api.put.mockImplementation(async (path: string) =>
    path.endsWith('/scoped-values') ? { ...read({ level: 'global' }), warnings: [] } : { data: null },
  );
});
afterEach(() => cleanup());

describe('the editor read fails', () => {
  it('shows the error with Retry in place of the skeleton, and Retry reads again', async () => {
    let fail = true;
    setUpEditorApi({
      read: (scope) => {
        if (fail) throw new ApiError(500, { error: { code: 'INTERNAL', message: 'boom' } } as never);
        return read(scope);
      },
    });
    renderEditor(ProductEditor);
    const error = await screen.findByTestId('editor-load-error');
    expect(screen.queryByTestId('editor-skeleton')).toBeNull();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'false');
    // One alert, not an alert inside an alert.
    expect(within(error).getAllByRole('alert')).toHaveLength(1);
    fail = false;
    fireEvent.click(within(error).getByRole('button', { name: en['productEditor.error.retry']! }));
    expect(await screen.findByLabelText(en['productEditor.field.name']!)).toHaveValue('Drill');
    expect(screen.queryByTestId('editor-load-error')).toBeNull();
  });
});

describe('redirects (Details, under the URL key)', () => {
  it('carry "Applies immediately" on their heading and say it in the delete confirmation', async () => {
    setUpEditorApi({
      read,
      extra: (path) =>
        path === `${BASE}/url-keys`
          ? urlKeys([{ id: REDIRECT_ID, key: 'old-drill', languageCode: null, channelId: null, createdAt: '2026-11-01T00:00:00.000Z' }])
          : undefined,
    });
    renderEditor(ProductEditor);
    const section = await screen.findByTestId('product-url-redirects');
    await within(section).findByText(/old-drill/);
    expect(within(section).getByText(en['productEditor.immediate.badge']!)).toBeInTheDocument();
    expect(en['productEditor.urlKeys.deleteRedirectBody']).toMatch(/applies immediately/i);
  });

  it('show a loading line, then an error with Retry when the read fails', async () => {
    let answer: () => unknown = () => {
      throw new Error('offline');
    };
    setUpEditorApi({ read, extra: (path) => (path === `${BASE}/url-keys` ? Promise.resolve().then(answer) : undefined) });
    renderEditor(ProductEditor);
    const section = await screen.findByTestId('product-url-redirects');
    const error = await within(section).findByTestId('redirects-load-error');
    expect(error).toHaveTextContent(en['productEditor.urlKeys.error.loadRedirects']!);
    answer = () => urlKeys([]);
    fireEvent.click(within(error).getByRole('button', { name: en['productEditor.error.retry']! }));
    expect(await within(section).findByText(en['productEditor.urlKeys.redirectsEmpty']!)).toBeInTheDocument();
  });

  it('are hidden when the answer carries none (seo off)', async () => {
    setUpEditorApi({ read, extra: (path) => (path === `${BASE}/url-keys` ? urlKeys(undefined) : undefined) });
    renderEditor(ProductEditor);
    await screen.findByLabelText(en['productEditor.field.name']!);
    await waitFor(() => expect(screen.queryByTestId('product-url-redirects')).toBeNull());
  });
});

describe('read-only mode (T110, FR-080)', () => {
  it('has no Product menu, no Save and no "Use value from" checkbox', async () => {
    renderEditor(ProductEditor, { url: AT_C, permissions: ['catalog:read'] });
    await screen.findByLabelText(en['productEditor.field.name']!);
    expect(screen.queryByRole('button', { name: en['productEditor.wholeProduct.menu']! })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(en['productEditor.scope.readOnly']!)).toBeInTheDocument();
  });
});

describe('global-only tabs outside Global (FR-081)', () => {
  it('Related shows the notice and its content read-only, without the immediate badge', async () => {
    renderEditor(ProductEditor, { url: `${AT_C}&tab=links` });
    const panel = await screen.findByRole('tabpanel');
    await within(panel).findByTestId('global-only-tab-notice');
    expect(await within(panel).findByText(en['productEditor.links.title']!)).toBeInTheDocument();
    expect(within(panel).queryByText(en['productEditor.immediate.badge']!)).toBeNull();
  });

  it('Inventory shows the stock read-only outside Global', async () => {
    renderEditor(ProductEditor, { url: `${AT_C}&tab=inventory` });
    const stock = await screen.findByTestId('stock-read-only');
    expect(stock).toBeDisabled();
    expect(stock).toHaveTextContent('stock panel stub');
  });
});

describe('after Save', () => {
  it('says "Saved 1 change" as a status, keeps focus on Save, and clears the line on the next edit', async () => {
    renderEditor(ProductEditor);
    const name = await screen.findByLabelText(en['productEditor.field.name']!);
    fireEvent.change(name, { target: { value: 'Wiertarka' } });
    const save = screen.getByRole('button', { name: /^Save 1 change\b/ });
    save.focus();
    fireEvent.click(save);
    const info = await screen.findByTestId('product-save-info');
    expect(info).toHaveTextContent('Saved 1 change at');
    expect(info.closest('[role="status"]')).not.toBeNull();
    expect(info.closest('[role="alert"]')).toBeNull();
    const saveAfter = screen.getByRole('button', { name: /^Save/ });
    expect(saveAfter).toHaveAttribute('aria-disabled', 'true');
    expect(saveAfter).not.toBeDisabled();
    expect(document.activeElement).toBe(saveAfter);
    fireEvent.change(screen.getByLabelText(en['productEditor.field.name']!), { target: { value: 'Wiertarka 2' } });
    await waitFor(() => expect(screen.queryByTestId('product-save-info')).toBeNull());
  });

  it('the Product menu is described by its caption, and nothing uses window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderEditor(ProductEditor);
    await screen.findByLabelText(en['productEditor.field.name']!);
    expect(screen.getByRole('button', { name: en['productEditor.wholeProduct.menu']! })).toHaveAccessibleDescription(
      en['productEditor.wholeProduct.caption']!,
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('scope announcements', () => {
  it('announces the return to Global once the Global read is in', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    await screen.findByLabelText(en['productEditor.field.name']!);
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: '' } });
    await waitFor(() =>
      expect(screen.getByTestId('editor-announcer')).toHaveTextContent(
        en['productEditor.scope.loadedAt']!.replace('{scope}', en['productEditor.scope.global']!),
      ),
    );
  });
});
