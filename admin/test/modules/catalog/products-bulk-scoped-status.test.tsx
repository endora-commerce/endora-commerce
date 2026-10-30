import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';

/**
 * Feature 163 / T096 (US5, FR-050–FR-052; US6 #4, FR-061) — the bulk dialog's "Status in
 * one channel": a channel, optionally one of its languages, and Active, Inactive or Use
 * inherited. It sends `fields.scopedStatus` and never beside `fields.status` (the route
 * refuses the pair), so the two groups exclude each other. The result names the products
 * skipped because they are not in the channel (`scope_invalid`) or because the
 * completeness check refused them (`completeness_gate`), and those saved with values
 * missing (`warn` mode: `details.code = 'SCOPE_INCOMPLETE'`).
 *
 * Real `en` and `pl` bundles, under `<StrictMode>`.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ProductsBulkEditDialog } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductsBulkEditDialog'
);

const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const P3 = '00000000-0000-4000-8000-0000000000a3';

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('attributes/by-flag')) return Promise.resolve({ data: { items: [] } });
    if (path === '/api/v1/admin/sales-channels') {
      return Promise.resolve({
        items: [
          { id: B2B, code: 'b2b', name: { 'en-US': 'B2B shop' } },
          { id: B2C, code: 'b2c', name: { 'en-US': 'B2C shop' } },
        ],
      });
    }
    if (path === '/api/v1/admin/sales-channels/b2c') {
      return Promise.resolve({ id: B2C, code: 'b2c', languages: ['de', 'pl'], defaultLanguage: 'pl' });
    }
    if (path === '/api/v1/admin/sales-channels/b2b') {
      return Promise.resolve({ id: B2B, code: 'b2b', languages: ['en'], defaultLanguage: 'en' });
    }
    return Promise.resolve({ data: [] });
  });
}

function wrap(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReactElement {
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <MemoryRouter>
        <TranslationProvider language={language} initialBundle={{ catalog, core: {} }}>
          {ui}
        </TranslationProvider>
      </MemoryRouter>
    </StrictMode>
  );
}

function renderDialog(language: 'en' | 'pl' = 'en'): void {
  render(wrap(<ProductsBulkEditDialog productIds={[P1, P2, P3]} onClose={(): void => undefined} />, language));
}

async function scopedGroup(): Promise<HTMLElement> {
  return screen.findByRole('group', { name: /status in one channel/i });
}

async function chooseScope(user: ReturnType<typeof userEvent.setup>, value: string, language = 'de'): Promise<void> {
  await user.click(screen.getByRole('checkbox', { name: /status in one channel/i }));
  const group = await scopedGroup();
  await user.selectOptions(within(group).getByRole('combobox', { name: /sales channel/i }), B2C);
  const languageSelect = within(group).getByRole('combobox', { name: /language/i });
  await waitFor(() => expect(within(languageSelect).getByRole('option', { name: 'DE' })).toBeTruthy());
  await user.selectOptions(languageSelect, language);
  await user.selectOptions(within(group).getByRole('combobox', { name: /^status$/i }), value);
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  primeGets();
});
afterEach(() => vi.clearAllMocks());

describe('bulk status in one channel (US5)', () => {
  it('sends scopedStatus for the chosen channel and language, nothing else', async () => {
    const user = userEvent.setup();
    postSpy.mockResolvedValue({
      data: {
        bulkOperationId: 'op-1',
        summary: { succeeded: 3, skipped: 0, failed: 0, total: 3 },
        results: [P1, P2, P3].map((productId) => ({ productId, status: 'succeeded', changedFields: ['scopedStatus'] })),
      },
    });
    renderDialog();
    await chooseScope(user, 'inactive');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/products/bulk-update', {
      productIds: [P1, P2, P3],
      fields: { scopedStatus: { channelId: B2C, languageCode: 'de', value: 'inactive' } },
    });
  });

  it('“All languages” is the channel scope (languageCode null); “Use inherited” resets it', async () => {
    const user = userEvent.setup();
    postSpy.mockResolvedValue({ data: { queued: true, bulkOperationId: 'op-2', total: 3 } });
    renderDialog();
    await chooseScope(user, 'inherit', '');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await waitFor(() =>
      expect(postSpy.mock.calls[0]?.[1]).toEqual({
        productIds: [P1, P2, P3],
        fields: { scopedStatus: { channelId: B2C, languageCode: null, value: 'inherit' } },
      }),
    );
  });

  it('offers Active, Inactive and Use inherited — never draft', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('checkbox', { name: /status in one channel/i }));
    const group = await scopedGroup();
    const values = within(within(group).getByRole('combobox', { name: /^status$/i }))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    // D19 — nothing is chosen for the operator: the first option asks for a choice.
    expect(values).toEqual(['', 'active', 'inactive', 'inherit']);
    expect(within(group).getByRole('combobox', { name: /^status$/i })).toHaveValue('');
  });

  it('asks for a status before applying (D19)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('checkbox', { name: /status in one channel/i }));
    const group = await scopedGroup();
    await user.selectOptions(within(group).getByRole('combobox', { name: /sales channel/i }), B2C);
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const value = within(group).getByRole('combobox', { name: /^status$/i });
    expect(value.getAttribute('aria-invalid')).toBe('true');
    expect(within(group).getByText(/choose the status to set/i)).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('cannot be combined with the global status: each disables the other and says why', async () => {
    const user = userEvent.setup();
    renderDialog();
    const scoped = await screen.findByRole('checkbox', { name: /status in one channel/i });
    await user.click(screen.getByRole('checkbox', { name: /^status/i }));
    expect((scoped as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/not together with status/i)).toBeTruthy();
  });

  it('asks for a channel before applying', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('checkbox', { name: /status in one channel/i }));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const channel = within(await scopedGroup()).getByRole('combobox', { name: /sales channel/i });
    expect(channel.getAttribute('aria-invalid')).toBe('true');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('reports products skipped as not in the channel or refused by the completeness check, and those saved with values missing', async () => {
    const user = userEvent.setup();
    postSpy.mockResolvedValue({
      data: {
        bulkOperationId: 'op-3',
        summary: { succeeded: 1, skipped: 2, failed: 0, total: 3 },
        results: [
          { productId: P1, status: 'skipped', reason: 'scope_invalid', details: { code: 'SCOPE_INVALID' } },
          { productId: P2, status: 'skipped', reason: 'completeness_gate', details: { code: 'SCOPE_INCOMPLETE' } },
          {
            productId: P3,
            status: 'succeeded',
            changedFields: ['scopedStatus'],
            details: { code: 'SCOPE_INCOMPLETE' },
          },
        ],
      },
    });
    renderDialog();
    await chooseScope(user, 'active');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toMatch(/not in this sales channel/i);
    expect(rows[1]?.textContent).toMatch(/missing/i);
    expect(rows[2]?.textContent).toMatch(/saved with values missing/i);
  });

  it('names each reported product by name and SKU and links it to its scopes tab (D3)', async () => {
    const user = userEvent.setup();
    postSpy.mockImplementation((path: string, body: { ids?: string[] }) => {
      if (path === '/api/v1/admin/catalog/products/batch-by-id') {
        // Only what the selection did not already name is looked up.
        expect(body.ids).toEqual([P2]);
        return Promise.resolve({ data: [{ id: P2, sku: 'SKU-2', name: { 'en-US': 'Hammer' } }] });
      }
      return Promise.resolve({
        data: {
          bulkOperationId: 'op-5',
          summary: { succeeded: 0, skipped: 2, failed: 0, total: 2 },
          results: [
            { productId: P1, status: 'skipped', reason: 'scope_invalid', details: { code: 'SCOPE_INVALID' } },
            { productId: P2, status: 'skipped', reason: 'completeness_gate', details: { code: 'SCOPE_INCOMPLETE' } },
          ],
        },
      });
    });
    render(
      wrap(
        <ProductsBulkEditDialog
          productIds={[P1, P2]}
          productLabels={{ [P1]: { name: 'Drill', sku: 'SKU-1' } }}
          onClose={(): void => undefined}
        />,
      ),
    );
    await chooseScope(user, 'active');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const table = await screen.findByRole('table');
    const drill = await within(table).findByRole('link', { name: /Drill/ });
    expect(drill.closest('tr')?.textContent).toContain('SKU-1');
    expect(drill).toHaveAttribute('href', `/catalog/products/${P1}?tab=scopes`);
    const hammer = await within(table).findByRole('link', { name: /Hammer/ });
    expect(hammer.closest('tr')?.textContent).toContain('SKU-2');
    expect(hammer).toHaveAttribute('href', `/catalog/products/${P2}?tab=scopes`);
    expect(table.textContent).not.toContain(`${P1.slice(0, 8)}…`);
  });

  it('switching the channel offers the new channel’s languages and clears the chosen one (C-6c)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('checkbox', { name: /status in one channel/i }));
    const group = await scopedGroup();
    await user.selectOptions(within(group).getByRole('combobox', { name: /sales channel/i }), B2C);
    const languageSelect = within(group).getByRole('combobox', { name: /language/i });
    await waitFor(() => expect(within(languageSelect).getByRole('option', { name: 'DE' })).toBeTruthy());
    await user.selectOptions(languageSelect, 'de');
    await user.selectOptions(within(group).getByRole('combobox', { name: /sales channel/i }), B2B);
    const next = within(group).getByRole('combobox', { name: /language/i }) as HTMLSelectElement;
    await waitFor(() => expect(within(next).getByRole('option', { name: 'EN' })).toBeTruthy());
    expect(within(next).queryByRole('option', { name: 'DE' })).toBeNull();
    expect(next.value).toBe('');
  });

  it('an error is announced as an alert (D7)', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('checkbox', { name: /^status/i }));
    postSpy.mockRejectedValue(new Error('Network down'));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('Network down');
  });

  it('a channel whose languages cannot be loaded still takes the whole-channel status, and the result names the scope', async () => {
    const user = userEvent.setup();
    const base = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) =>
      path === '/api/v1/admin/sales-channels/b2c' ? Promise.reject(new Error('down')) : base(path),
    );
    postSpy.mockResolvedValue({
      data: {
        bulkOperationId: 'op-4',
        summary: { succeeded: 3, skipped: 0, failed: 0, total: 3 },
        results: [P1, P2, P3].map((productId) => ({ productId, status: 'succeeded', changedFields: ['scopedStatus'] })),
      },
    });
    renderDialog();
    await user.click(await screen.findByRole('checkbox', { name: /status in one channel/i }));
    const group = await scopedGroup();
    await user.selectOptions(within(group).getByRole('combobox', { name: /sales channel/i }), B2C);
    expect(await within(group).findByText(/languages could not be loaded/i)).toBeTruthy();
    await user.selectOptions(within(group).getByRole('combobox', { name: /^status$/i }), 'inactive');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await waitFor(() =>
      expect(postSpy.mock.calls[0]?.[1]).toEqual({
        productIds: [P1, P2, P3],
        fields: { scopedStatus: { channelId: B2C, languageCode: null, value: 'inactive' } },
      }),
    );
    expect(await screen.findByRole('heading', { name: /status in b2c shop applied/i })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  // Final QA review Q-L10 — owner decision UX-3 = A: the return to the inherited status is
  // "Use inherited", in both languages; "Reset" is not used and "Restore" stays the archive's.
  it.each([
    ['en', /status in one channel/i, 'Use inherited (remove the override)', /\breset|\brestore/i],
    ['pl', /status w jednym kanale/i, 'Użyj dziedziczonego (usuń nadpisanie)', /przywróć|resetuj|zresetuj/i],
  ] as const)('speaks the UX-3 vocabulary (%s, Q-L10)', async (language, groupName, inherit, banned) => {
    const user = userEvent.setup();
    renderDialog(language);
    await user.click(await screen.findByRole('checkbox', { name: groupName }));
    const group = await screen.findByRole('group', { name: groupName });
    const status = within(group).getAllByRole('combobox').at(-1) as HTMLSelectElement;
    const inheritOption = within(status).getByRole('option', { name: inherit }) as HTMLOptionElement;
    expect(inheritOption.value).toBe('inherit');
    expect(group.textContent ?? '').not.toMatch(banned);
  });

  it('renders in Polish', async () => {
    renderDialog('pl');
    expect(await screen.findByRole('checkbox', { name: /status w jednym kanale/i })).toBeTruthy();
  });
});
