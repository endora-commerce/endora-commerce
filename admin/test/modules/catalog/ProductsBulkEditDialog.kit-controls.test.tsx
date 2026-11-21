import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1492 (CAT-17), UX audit slice S14 — the bulk edit dialog on the kit's
 * controls. What the move changes for the operator, beyond the look:
 *
 * - *Add* / *Replace* is one choice of two, so it is a radio group — it was two
 *   buttons, the chosen one filled, saying which was on by colour alone.
 * - A sales channel is a labelled checkbox — it was a button whose pressed state
 *   was only a fill.
 * - Visibility reads in words ("Signed-in buyers only"), not as the stored code.
 * - A mass-editable attribute's checkbox and text box are named by the attribute.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: (...a: unknown[]) => postSpy(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { ProductsBulkEditDialog } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductsBulkEditDialog'
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(resolve(__dirname, `../../../../packages/modules/catalog/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
const EN = bundle('en');
const tr = (key: string): string => EN[key] ?? key;
const CH_WEB = '00000000-0000-4000-8000-0000000c0001';

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.includes('attributes/by-flag')) {
      return Promise.resolve({
        data: { items: [{ id: 'a1', key: 'brand', label: { 'en-US': 'Brand' }, labelDefault: 'Brand', valueType: 'string' }] },
      });
    }
    if (path.includes('sales-channels')) return Promise.resolve({ items: [{ id: CH_WEB, code: 'web', name: 'Web' }] });
    return Promise.resolve({ data: [] });
  });
  postSpy.mockResolvedValue({
    data: { bulkOperationId: 'op', summary: { succeeded: 1, skipped: 0, failed: 0, total: 1 }, results: [{ productId: 'p1', status: 'succeeded' }] },
  });
});
afterEach(() => vi.clearAllMocks());

function renderDialog(): void {
  renderWithI18n(
    <MemoryRouter>
      <ProductsBulkEditDialog productIds={['p1']} onClose={vi.fn()} />
    </MemoryRouter>,
    { catalog: bundle('en') },
    { language: 'en' },
  );
}

const apply = (): HTMLElement => screen.getByRole('button', { name: tr('productsList.bulkEdit.action.apply') });

describe('ProductsBulkEditDialog — kit controls (S14)', () => {
  it('sets the channels by a radio choice of mode and labelled channel checkboxes', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: new RegExp(`^${tr('productsList.bulkEdit.section.salesChannels')}`) }));
    const mode = screen.getByRole('radiogroup', {
      name: tr('productsList.bulkEdit.mode.label').replace('{section}', tr('productsList.bulkEdit.section.salesChannels')),
    });
    expect(within(mode).getByRole('radio', { name: tr('productsList.bulkEdit.mode.add') })).toBeChecked();
    await user.click(within(mode).getByRole('radio', { name: tr('productsList.bulkEdit.mode.replace') }));
    await user.click(await screen.findByRole('checkbox', { name: 'Web' }));
    await user.click(apply());
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![1]).toEqual({
      productIds: ['p1'],
      fields: { salesChannels: { mode: 'replace', channelIds: [CH_WEB] } },
    });
  });

  it('reads visibility in words, not as the stored code', async () => {
    renderDialog();
    const select = await screen.findByRole('combobox', { name: tr('productsList.bulkEdit.section.visibility') });
    expect(Array.from((select as HTMLSelectElement).options).map((o) => [o.value, o.textContent])).toEqual([
      ['public', tr('productEditor.visibility.public')],
      ['logged_in_only', tr('productEditor.visibility.logged_in_only')],
      ['organization_restricted', tr('productEditor.visibility.organization_restricted')],
    ]);
  });

  it('names an attribute’s checkbox and text box by the attribute', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Brand' }));
    await user.type(screen.getByRole('textbox', { name: 'Brand' }), 'Acme');
    await user.click(apply());
    await waitFor(() => expect(postSpy.mock.calls[0]![1]).toEqual({ productIds: ['p1'], fields: { attributeValues: { brand: 'Acme' } } }));
  });

  it('says a failed apply in the kit’s alert', async () => {
    postSpy.mockRejectedValue(new Error('Network down'));
    renderDialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: new RegExp(`^${tr('productsList.bulkEdit.section.status')}`) }));
    await user.click(apply());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-slot', 'alert');
    expect(alert.textContent).toContain('Network down');
  });
});
