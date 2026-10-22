import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BUNDLE, RFQ_ID, renderRfqDetail, rfqPayloadWithLines } from './rfq-reference-fixtures';

const getSpy = vi.fn();
const patchSpy = vi.fn();

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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

/**
 * Feature 159, T030 — the quote's groups on the admin detail screen
 * (`specs/159-quote-request-item-groups/contracts/ui.md` §2): *Modify* edits
 * them with live summaries and saves them with the revision; *Overview* shows
 * them read-only; a quote with no group looks as it did.
 *
 * The `quote_requests` bundle is the shipped English one, so the labels are
 * the real sentences; the host's `core` keys stay passthrough.
 */

const REPO_ROOT = resolve(process.cwd(), '..');
const QR_EN = JSON.parse(
  readFileSync(join(REPO_ROOT, 'packages/modules/quote_requests/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const BUNDLE_WITH_GROUPS = { ...BUNDLE, quote_requests: QR_EN };

const HALL = '00000000-0000-4000-8000-000000159001';
const EMPTY = '00000000-0000-4000-8000-000000159002';
const L1 = '00000000-0000-4000-8000-000000159101';
const L2 = '00000000-0000-4000-8000-000000159102';
const L3 = '00000000-0000-4000-8000-000000159103';
const P1 = '00000000-0000-4000-8000-000000159201';
const P2 = '00000000-0000-4000-8000-000000159202';
const P3 = '00000000-0000-4000-8000-000000159203';

/** Bolt and Nut in *Hall*, an empty *Spare* group, Washer ungrouped; every line priced. */
function groupedPayload(status = 'Pending'): Record<string, unknown> {
  const base = rfqPayloadWithLines([
    { id: L1, productId: P1, productName: 'Bolt', quantity: 2, referencePrice: { amount: 12, currency: 'PLN', capturedAt: '2026-10-01T10:00:00.000Z' } },
    { id: L2, productId: P2, productName: 'Nut', quantity: 4, referencePrice: { amount: 6, currency: 'PLN', capturedAt: '2026-10-01T10:00:00.000Z' } },
    { id: L3, productId: P3, productName: 'Washer', quantity: 10 },
  ]);
  const prices: Record<string, number> = { [L1]: 10, [L2]: 5, [L3]: 1 };
  const groups: Record<string, string | null> = { [L1]: HALL, [L2]: HALL, [L3]: null };
  return {
    ...base,
    status,
    taxRate: 0.23,
    itemGroups: [
      { id: HALL, name: 'Hall', position: 0 },
      { id: EMPTY, name: 'Spare', position: 1 },
    ],
    items: (base['items'] as Array<Record<string, unknown>>).map((item, index) => ({
      ...item,
      agreedUnitPrice: prices[item['id'] as string],
      desiredUnitPrice: null,
      customerProposedUnitPrice: null,
      groupId: groups[item['id'] as string],
      position: index === 1 ? 1 : 0,
    })),
  };
}

function answer(payload: Record<string, unknown>): void {
  getSpy.mockImplementation((url: string) => {
    if (url === `/api/v1/admin/quote-requests/${RFQ_ID}`) return Promise.resolve({ data: payload });
    return Promise.resolve({ data: {} });
  });
}

async function openModify(payload = groupedPayload()): Promise<void> {
  answer(payload);
  renderRfqDetail(RfqDetail, 'en', BUNDLE_WITH_GROUPS);
  await userEvent.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
  await screen.findByRole('button', { name: 'Add group' });
}

const region = (name: string): HTMLElement => screen.getByRole('region', { name });
const saveBody = async (): Promise<{ groups?: unknown; items: Array<Record<string, unknown>> }> => {
  await userEvent.click(screen.getByRole('button', { name: 'rfq.detail.modify.saveRevision' }));
  await waitFor(() => expect(patchSpy).toHaveBeenCalled());
  return (patchSpy.mock.calls[0] as [string, { groups?: unknown; items: Array<Record<string, unknown>> }])[1];
};

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: {} });
});

describe('RfqDetail — Modify with groups (T030)', () => {
  it('opens on the stored groups, an empty one included, then Ungrouped', async () => {
    await openModify();
    expect(screen.getAllByRole('region').map((section) => section.getAttribute('aria-label'))).toEqual([
      'Hall',
      'Spare',
      'Ungrouped',
    ]);
    expect(within(region('Hall')).getByRole('group', { name: 'Bolt' })).toBeInTheDocument();
    expect(within(region('Hall')).getByRole('group', { name: 'Nut' })).toBeInTheDocument();
    expect(within(region('Ungrouped')).getByRole('group', { name: 'Washer' })).toBeInTheDocument();
    expect(within(region('Spare')).getByText(QR_EN['lineGroups.emptyGroup']!)).toBeInTheDocument();
  });

  it('shows each section’s summary — count, net, VAT, gross, discount — and recomputes it on edit (FR-008)', async () => {
    await openModify();
    const hall = region('Hall');
    // 2 × 10 + 4 × 5 = 40 net, 9.20 VAT, 49.20 gross; reference 2 × 12 + 4 × 6 = 48 → 8.00 discount.
    expect(hall).toHaveTextContent('2 items');
    expect(hall).toHaveTextContent('Net 40.00 PLN');
    expect(hall).toHaveTextContent('VAT 9.20 PLN');
    expect(hall).toHaveTextContent('Gross 49.20 PLN');
    expect(hall).toHaveTextContent('Discount 8.00 PLN');
    // Washer has no reference: no discount there.
    expect(region('Ungrouped')).toHaveTextContent('1 item');
    expect(region('Ungrouped')).not.toHaveTextContent('Discount');

    const bolt = within(hall).getByRole('group', { name: 'Bolt' });
    const agreed = within(bolt).getByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' });
    await userEvent.clear(agreed);
    await userEvent.type(agreed, '11');
    expect(region('Hall')).toHaveTextContent('Net 42.00 PLN');
  });

  it('saves groups and each line’s groupKey in display order with the revision', async () => {
    await openModify();
    const name = within(region('Hall')).getByRole('textbox', { name: 'Group name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Hall A');
    await userEvent.click(screen.getByRole('button', { name: 'Delete group Spare' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move Washer to group' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hall A' }));
    const body = await saveBody();
    expect(body.groups).toEqual([{ key: HALL, id: HALL, name: 'Hall A' }]);
    expect(body.items.map((item) => [item['id'], item['groupKey']])).toEqual([
      [L1, HALL],
      [L2, HALL],
      [L3, HALL],
    ]);
  });

  it('a new group goes in the payload by key, without an id; Add product in a group adds the line there', async () => {
    await openModify();
    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
    const fields = screen.getAllByRole('textbox', { name: 'Group name' });
    await userEvent.type(fields[2]!, 'Options');
    await userEvent.click(screen.getByRole('button', { name: 'Move Bolt to group' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Options' }));
    await userEvent.click(within(region('Hall')).getByRole('button', { name: 'Add product' }));
    expect(within(region('Hall')).getAllByRole('group')).toHaveLength(2);
    const body = await saveBody();
    const groups = body.groups as Array<{ key: string; id?: string; name: string }>;
    expect(groups.map((group) => group.name)).toEqual(['Hall', 'Spare', 'Options']);
    expect(groups[2]).not.toHaveProperty('id');
    // The blank line added to Hall has no product and is not sent.
    expect(body.items.map((item) => [item['id'], item['groupKey']])).toEqual([
      [L2, HALL],
      [L1, groups[2]!.key],
      [L3, null],
    ]);
  });

  it('blocks the save while a group has no name', async () => {
    await openModify();
    await userEvent.clear(within(region('Hall')).getByRole('textbox', { name: 'Group name' }));
    await userEvent.click(screen.getByRole('button', { name: 'rfq.detail.modify.saveRevision' }));
    expect(patchSpy).not.toHaveBeenCalled();
    expect(screen.getAllByText(QR_EN['lineGroups.nameRequired']!).length).toBeGreaterThan(0);
  });

  it('moves a group up and has no automated accessibility violation', async () => {
    await openModify();
    await userEvent.click(screen.getByRole('button', { name: 'Move group Spare up' }));
    expect(screen.getAllByRole('region').map((section) => section.getAttribute('aria-label'))).toEqual([
      'Spare',
      'Hall',
      'Ungrouped',
    ]);
    const editor = screen.getByRole('region', { name: 'Hall' }).parentElement!;
    await expectNoAxeViolations(editor);
  });
});

describe('RfqDetail — Split line (research N-33)', () => {
  it('splits a line into another group: the rest stays, the new line names the line it came from', async () => {
    await openModify();
    await userEvent.click(screen.getByRole('button', { name: 'Split line: Nut' }));
    const dialog = await screen.findByRole('dialog', { name: 'Split line: Nut' });
    const quantity = within(dialog).getByLabelText(QR_EN['lineGroups.split.quantity']!);
    // Half of 4 to start with.
    expect(quantity).toHaveValue(2);
    await userEvent.clear(quantity);
    await userEvent.type(quantity, '1');
    await userEvent.selectOptions(within(dialog).getByLabelText(QR_EN['lineGroups.split.target']!), 'Spare');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Split line' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // The new line is a Nut line in Spare, named like the line it came from.
    expect(within(region('Spare')).getByRole('group', { name: 'Nut' })).toBeInTheDocument();
    expect(region('Hall')).toHaveTextContent('2 items');
    expect(region('Spare')).toHaveTextContent('1 item');

    const body = await saveBody();
    const row = (item: Record<string, unknown>): unknown[] => [
      item['id'] ?? null,
      item['productId'],
      item['quantity'],
      item['agreedUnitPrice'],
      item['groupKey'],
      item['splitFromId'] ?? null,
    ];
    expect(body.items.map(row)).toEqual([
      [L1, P1, 2, 10, HALL, null],
      [L2, P2, 3, 5, HALL, null],
      [null, P2, 1, 5, EMPTY, L2],
      [L3, P3, 10, 1, null, null],
    ]);
  });

  it('splits within the line’s own group by default, the new line right after it', async () => {
    await openModify();
    await userEvent.click(screen.getByRole('button', { name: 'Split line: Washer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Split line: Washer' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Split line' }));
    const ungrouped = within(region('Ungrouped')).getAllByRole('group', { name: 'Washer' });
    expect(ungrouped).toHaveLength(2);
    const body = await saveBody();
    expect(body.items.slice(2).map((item) => [item['quantity'], item['groupKey']])).toEqual([
      [5, null],
      [5, null],
    ]);
  });

  it('offers no split for a line of quantity 1', async () => {
    await openModify();
    const bolt = within(region('Hall')).getByRole('group', { name: 'Bolt' });
    // The line's first number field is its quantity.
    const qty = within(bolt).getAllByRole('spinbutton')[0]!;
    await userEvent.clear(qty);
    await userEvent.type(qty, '1');
    expect(screen.queryByRole('button', { name: 'Split line: Bolt' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Split line: Nut' })).toBeInTheDocument();
  });

  it('the split dialog has no automated accessibility violation', async () => {
    await openModify();
    await userEvent.click(screen.getByRole('button', { name: 'Split line: Nut' }));
    await screen.findByRole('dialog', { name: 'Split line: Nut' });
    await expectNoAxeViolations(document.body);
  });
});

describe('RfqDetail — Overview with groups (FR-032)', () => {
  it('shows each non-empty group as a heading with its lines and summary, then Ungrouped', async () => {
    answer(groupedPayload('Approved'));
    renderRfqDetail(RfqDetail, 'en', BUNDLE_WITH_GROUPS);
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toContain('Hall');
    expect(headers).toContain('Ungrouped');
    expect(headers).not.toContain('Spare');
    const rows = within(table).getAllByRole('row').map((row) => row.textContent ?? '');
    const hallAt = rows.findIndex((text) => text === 'Hall');
    expect(rows[hallAt + 1]).toContain('Bolt');
    expect(rows[hallAt + 2]).toContain('Nut');
    expect(rows[hallAt + 3]).toContain('Net 40.00 PLN');
    // Approved: no Modify tab, nothing to drag or rename.
    expect(screen.queryByRole('tab', { name: /rfq\.detail\.tabs\.modify/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Group name' })).toBeNull();
  });

  it('a quote with no group shows the table as before: no section heading', async () => {
    const plain = groupedPayload();
    answer({
      ...plain,
      itemGroups: [],
      items: (plain['items'] as Array<Record<string, unknown>>).map((item) => ({ ...item, groupId: null })),
    });
    renderRfqDetail(RfqDetail, 'en', BUNDLE_WITH_GROUPS);
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).not.toContain('Ungrouped');
    expect(within(table).queryByText(/Net 40\.00/)).toBeNull();
  });
});
