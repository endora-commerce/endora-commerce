import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';
import {
  CHANNEL_ID,
  CUSTOMER_ID,
  ITEM_ID,
  PROBE_FAILURES,
  PRODUCT_ID,
  VARIANT_ID,
  installGet,
  probeCalls,
  renderRfqDetail,
  type ItemOverrides,
  type ProbeAnswer,
} from './rfq-reference-fixtures';

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

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

async function openModify(item: ItemOverrides, probe: ProbeAnswer | (() => unknown)): Promise<HTMLInputElement> {
  installGet(getSpy, item, probe, postSpy);
  renderRfqDetail(RfqDetail);
  await userEvent.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
  return (await screen.findByRole('spinbutton', {
    name: 'rfq.detail.modify.agreedUnitPrice',
  })) as HTMLInputElement;
}

/** The Modify line: the closest ancestor of the agreed input that holds a whole line. */
function modifyLine(input: HTMLElement): HTMLElement {
  const line = input.closest('[role="group"]');
  if (!line) throw new Error('modify line not found');
  return line as HTMLElement;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: {} });
});

/**
 * Feature 146, T044 — the Modify tab shows the reference and the customer's
 * proposal beside the agreed-price input with a live difference (FR-004,
 * US1 #2), labels the reference per base unit (T6), prefills an empty input
 * from the customer's price on the request's channel (FR-007), sends what a
 * kept line must keep (FR-034), and degrades on any probe failure (L2).
 */
describe('RfqDetail Modify — reference, proposal, live difference, payload', () => {
  it('shows reference, "per base unit", proposal, and a difference that follows the typed price (US1 #2, T6)', async () => {
    const input = await openModify({ packagingUnitName: 'Box' }, 'reject');
    const line = modifyLine(input);
    expect(line).toHaveTextContent('120.00 PLN');
    expect(line).toHaveTextContent('rfq.detail.reference.perBaseUnit');
    expect(line).toHaveTextContent('rfq.detail.reference.atRequest');
    expect(line).toHaveTextContent('100.00 PLN');
    // The input opens on the proposal: −20.00 against 120.00.
    expect(input.value).toBe('100.00');
    expect(line).toHaveTextContent('−20.00 PLN');
    expect(line).toHaveTextContent('−16.67 %');

    await userEvent.clear(input);
    await userEvent.type(input, '108');
    expect(line).toHaveTextContent('−12.00 PLN');
    expect(line).toHaveTextContent('−10.00 %');

    await userEvent.clear(input);
    expect(line).not.toHaveTextContent('%');
  });

  it('bounds the quantity input at LINE_QUANTITY_MAX, the bound the API refuses past (issue #351)', async () => {
    await openModify({}, 'reject');
    const quantity = screen.getByRole('spinbutton', { name: /rfq\.detail\.modify\.quantity$/ }) as HTMLInputElement;
    expect(quantity.max).toBe(String(LINE_QUANTITY_MAX));
  });

  it('labels the reference the way Overview does — no "per base unit" on a line without a packaging unit (review fix N4)', async () => {
    const input = await openModify({}, 'reject');
    const line = modifyLine(input);
    expect(line).toHaveTextContent('rfq.detail.reference.atRequest');
    expect(line).not.toHaveTextContent('rfq.detail.reference.perBaseUnit');
  });

  it('formats the Modify amounts in the admin language (review fix N3)', async () => {
    installGet(getSpy, {}, 'reject', postSpy);
    renderRfqDetail(RfqDetail, 'pl');
    await userEvent.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    const input = (await screen.findByRole('spinbutton', {
      name: 'rfq.detail.modify.agreedUnitPrice',
    })) as HTMLInputElement;
    const line = modifyLine(input);
    // The input keeps a dot: it is a number field, not a display.
    expect(input.value).toBe('100.00');
    expect(line).toHaveTextContent('120,00 PLN');
    expect(line).toHaveTextContent('−20,00 PLN');
    expect(line).toHaveTextContent('−16,67 %');
    expect(line).toHaveTextContent('200,00 PLN');
  });

  it('names every line group — a stored line by its product, a new one generically (review fix N7)', async () => {
    await openModify({}, 'reject');
    expect(screen.getByRole('group', { name: 'Widget' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'rfq.detail.modify.addLine' }));
    expect(screen.getByRole('group', { name: 'rfq.detail.modify.lineGroup' })).toBeInTheDocument();
  });

  it('prefills an empty agreed price from the admin probe for the request’s customer and channel, never the storefront probe (FR-007)', async () => {
    const input = await openModify(
      { customerProposedUnitPrice: null, desiredUnitPrice: null, agreedUnitPrice: null },
      { amount: '118.00', currency: 'PLN' },
    );
    await waitFor(() => expect(input.value).toBe('118.00'));
    const calls = probeCalls(postSpy);
    expect(calls.length).toBeGreaterThan(0);
    for (const request of calls) {
      expect(request.buyer.customerAccountId).toBe(CUSTOMER_ID);
      expect(request.salesChannelId).toBe(CHANNEL_ID);
      expect(request.lines).toEqual([expect.objectContaining({ productId: PRODUCT_ID, quantity: 2, variantId: VARIANT_ID })]);
    }
    expect(getSpy.mock.calls.some((c) => String(c[0]).includes('/storefront/'))).toBe(false);
  });

  /**
   * Review 2, finding 3 (release 0.108.0) — the prefill wrote
   * `Number(amount).toFixed(2)`, which rounds the binary double: a resolver
   * amount of 9.0450 is the double 9.04499…, so the operator was offered 9.04
   * and, accepting it, the customer was charged 9.04 against the 9.05 the
   * storefront shows. Since the owner ruling of 2026-10-25 (worked examples
   * §10.18) a unit price is carried at four places, so the prefill is the
   * resolver's price itself, written with its significant places
   * (`unitPriceDisplayText`): nothing is rounded away.
   */
  it.each([
    ['9.0450', '9.045'],
    ['1.0050', '1.005'],
    ['0.0125', '0.0125'],
    ['118.0000', '118.00'],
  ])('prefills %s as %s, unrounded', async (amount, shown) => {
    const input = await openModify(
      { customerProposedUnitPrice: null, desiredUnitPrice: null, agreedUnitPrice: null },
      { amount, currency: 'PLN' },
    );
    await waitFor(() => expect(input.value).toBe(shown));
  });

  it('sends id, variantId and lineNote for every kept line (FR-034)', async () => {
    const input = await openModify({}, 'reject');
    await userEvent.clear(input);
    await userEvent.type(input, '110');
    await userEvent.click(screen.getByRole('button', { name: 'rfq.detail.modify.saveRevision' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
    const [, body] = patchSpy.mock.calls[0]! as [string, { items: Array<Record<string, unknown>> }];
    // Feature 159 — a quote with no group sends no grouping at all (FR-033).
    expect(body).not.toHaveProperty('groups');
    expect(body.items).toEqual([
      {
        id: ITEM_ID,
        productId: PRODUCT_ID,
        variantId: VARIANT_ID,
        lineNote: 'Deliver in May',
        quantity: 2,
        agreedUnitPrice: 110,
      },
    ]);
  });

  it('omits variantId for a kept line with no variant and still sends id and lineNote', async () => {
    const input = await openModify({ variantId: null, lineNote: null }, 'reject');
    await userEvent.clear(input);
    await userEvent.type(input, '110');
    await userEvent.click(screen.getByRole('button', { name: 'rfq.detail.modify.saveRevision' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
    const [, body] = patchSpy.mock.calls[0]! as [string, { items: Array<Record<string, unknown>> }];
    expect(body.items[0]).toEqual({
      id: ITEM_ID,
      productId: PRODUCT_ID,
      lineNote: null,
      quantity: 2,
      agreedUnitPrice: 110,
    });
  });

  it.each(PROBE_FAILURES)(
    'a %s from the probe leaves the input empty and shows "—" (L2)',
    async (_label, failure) => {
      const input = await openModify(
        { referencePrice: null, customerProposedUnitPrice: null, desiredUnitPrice: null, agreedUnitPrice: null },
        failure,
      );
      await waitFor(() => expect(probeCalls(postSpy).length).toBeGreaterThan(0));
      const line = modifyLine(input);
      await waitFor(() => expect(line).toHaveTextContent('rfq.detail.reference.none'));
      expect(input.value).toBe('');
      expect(line).toHaveTextContent('—');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
});
