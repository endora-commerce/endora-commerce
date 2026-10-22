import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import {
  CHANNEL_ID,
  CUSTOMER_ID,
  PROBE_FAILURES,
  PRODUCT_ID,
  VARIANT_ID,
  installGet,
  probeCalls,
  renderRfqDetail,
} from './rfq-reference-fixtures';

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

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

/** The Overview row of the one line every case renders. */
async function lineRow(): Promise<HTMLElement> {
  const name = await screen.findByText('Widget');
  const row = name.closest('tr');
  if (!row) throw new Error('line row not found');
  return row as HTMLElement;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

/**
 * Feature 146, T043 — the Overview tab shows, per line, the reference price,
 * the customer's proposal, their difference (amount and percentage) and the
 * agreed price (FR-003, FR-005, FR-006; US1 #1, #3, #5 – #7, L2).
 */
describe('RfqDetail Overview — reference, proposal, difference', () => {
  it('names the four price columns', async () => {
    installGet(getSpy, {}, 'reject', postSpy);
    renderRfqDetail(RfqDetail);
    await lineRow();
    for (const header of [
      'rfq.detail.reference.column.reference',
      'rfq.detail.reference.column.proposed',
      'rfq.detail.reference.column.difference',
      'rfq.detail.column.agreed',
    ]) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('shows 120.00 at request, 100.00 proposed and −20.00 PLN / −16.67 % (US1 #1, #5)', async () => {
    installGet(getSpy, {}, 'reject', postSpy);
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    expect(row).toHaveTextContent('120.00 PLN');
    expect(within(row).getByText('rfq.detail.reference.atRequest')).toBeInTheDocument();
    expect(row).toHaveTextContent('100.00');
    expect(row).toHaveTextContent('−20.00 PLN');
    expect(row).toHaveTextContent('−16.67 %');
    // A stored reference is the reference: the current price is not asked for.
    expect(probeCalls(postSpy)).toEqual([]);
    expect(within(row).queryByText('rfq.detail.reference.current')).not.toBeInTheDocument();
  });

  it('formats every amount in the admin language — Polish separators in Polish (review fix N3)', async () => {
    installGet(getSpy, { agreedUnitPrice: 110 }, 'reject', postSpy);
    renderRfqDetail(RfqDetail, 'pl');
    const row = await lineRow();
    const cells = within(row).getAllByRole('cell');
    expect(cells[2]).toHaveTextContent('120,00 PLN');
    expect(cells[3]).toHaveTextContent(/^100,00$/);
    expect(cells[4]).toHaveTextContent('−20,00 PLN');
    expect(cells[4]).toHaveTextContent('−16,67 %');
    expect(cells[5]).toHaveTextContent(/^110,00$/);
    expect(cells[6]).toHaveTextContent('220,00 PLN');
  });

  it('formats in English conventions in English, whatever the currency (review fix N3)', async () => {
    installGet(getSpy, { agreedUnitPrice: 1100 }, 'reject', postSpy);
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    // 2 × 1100 — English grouping, not the Polish the screen used to hard-code.
    expect(within(row).getAllByRole('cell')[6]).toHaveTextContent('2,200.00 PLN');
  });

  it('labels the reference "per base unit" only on a line sold in a packaging unit (review fix N4)', async () => {
    installGet(getSpy, { packagingUnitName: 'Box' }, 'reject', postSpy);
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    expect(within(row).getByText(/rfq\.detail\.reference\.perBaseUnit/)).toBeInTheDocument();
  });

  it('shows no "per base unit" label on a line without a packaging unit', async () => {
    installGet(getSpy, {}, 'reject', postSpy);
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    expect(within(row).queryByText(/rfq\.detail\.reference\.perBaseUnit/)).not.toBeInTheDocument();
  });

  it('signs a proposal above the reference with "+"', async () => {
    installGet(getSpy, { customerProposedUnitPrice: 132 }, 'reject', postSpy);
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    expect(row).toHaveTextContent('+12.00 PLN');
    expect(row).toHaveTextContent('+10.00 %');
  });

  it('shows the reference and "—" for proposal and difference when the customer proposed nothing (US1 #3)', async () => {
    installGet(getSpy, { customerProposedUnitPrice: null, desiredUnitPrice: null }, 'reject', postSpy);
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    expect(row).toHaveTextContent('120.00 PLN');
    const cells = within(row).getAllByRole('cell');
    // Product, Qty, Reference, Proposed, Difference, Agreed, Line total.
    expect(cells[3]).toHaveTextContent(/^—$/);
    expect(cells[4]).toHaveTextContent(/^—$/);
  });

  it('shows "—" for the difference when the reference currency differs from the line', async () => {
    installGet(
      getSpy,
      { referencePrice: { amount: 120, currency: 'EUR', capturedAt: '2026-10-01T10:00:00.000Z' } },
      'reject',
      postSpy,
    );
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    expect(row).toHaveTextContent('120.00 EUR');
    expect(within(row).getAllByRole('cell')[4]).toHaveTextContent(/^—$/);
  });

  it('shows the amount and "—" for the percentage on a zero reference', async () => {
    installGet(
      getSpy,
      { referencePrice: { amount: 0, currency: 'PLN', capturedAt: '2026-10-01T10:00:00.000Z' } },
      'reject',
      postSpy,
    );
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    const difference = within(row).getAllByRole('cell')[4]!;
    expect(difference).toHaveTextContent('+100.00 PLN');
    expect(difference).toHaveTextContent('—');
    expect(difference).not.toHaveTextContent('%');
  });

  it('asks the admin probe for the customer’s current price on the request’s channel when none is stored (US1 #6)', async () => {
    installGet(getSpy, { referencePrice: null }, { amount: '125.00', currency: 'PLN' }, postSpy);
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    await waitFor(() => expect(within(row).getByText('rfq.detail.reference.current')).toBeInTheDocument());
    expect(row).toHaveTextContent('125.00 PLN');
    expect(row).toHaveTextContent('−25.00 PLN');
    expect(within(row).queryByText('rfq.detail.reference.atRequest')).not.toBeInTheDocument();

    const calls = probeCalls(postSpy);
    expect(calls.length).toBeGreaterThan(0);
    for (const request of calls) {
      expect(request.buyer.customerAccountId).toBe(CUSTOMER_ID);
      expect(request.salesChannelId).toBe(CHANNEL_ID);
      expect(request.lines).toEqual([expect.objectContaining({ productId: PRODUCT_ID, quantity: 2, variantId: VARIANT_ID })]);
    }
    expect(getSpy.mock.calls.some((c) => String(c[0]).includes('/storefront/'))).toBe(false);
  });

  it('shows "no price" when the probe resolves no price (US1 #7)', async () => {
    installGet(getSpy, { referencePrice: null }, null, postSpy);
    renderRfqDetail(RfqDetail);
    const row = await lineRow();
    await waitFor(() => expect(within(row).getByText('rfq.detail.reference.none')).toBeInTheDocument());
    expect(within(row).getAllByRole('cell')[4]).toHaveTextContent(/^—$/);
  });

  it.each(PROBE_FAILURES)(
    'a %s from the probe renders "no price" and "—", and the rest of the screen renders (L2)',
    async (_label, failure) => {
      installGet(getSpy, { referencePrice: null, agreedUnitPrice: 110 }, failure, postSpy);
      renderRfqDetail(RfqDetail);
      const row = await lineRow();
      await waitFor(() => expect(within(row).getByText('rfq.detail.reference.none')).toBeInTheDocument());
      const cells = within(row).getAllByRole('cell');
      expect(cells[3]).toHaveTextContent('100.00');
      expect(cells[4]).toHaveTextContent(/^—$/);
      expect(cells[5]).toHaveTextContent('110.00');
      expect(screen.getByText('rfq.detail.tabs.modify')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
});
