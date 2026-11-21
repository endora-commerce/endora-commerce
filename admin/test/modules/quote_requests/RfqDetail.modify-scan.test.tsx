import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installGet, renderRfqDetail, type ItemOverrides } from './rfq-reference-fixtures';

/**
 * Issue #1542 (UX audit 2026-11-17, SALES-16) — the Modify editor is scanned, not read: two
 * sections under the tab instead of a title that repeats it, a "Product" column over the
 * picker, and the reference and its difference in one cell, so a line is seven columns
 * rather than eight (Miller's Law).
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

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    CustomFieldValuesPanel: () => null,
    // The picker's accessible name is what the test reads; the picker itself is the kit's.
    ProductPicker: (props: { ariaLabel?: string }) => (
      <button type="button" aria-label={props.ariaLabel}>
        picker
      </button>
    ),
  };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

async function openModify(item: ItemOverrides = {}): Promise<HTMLElement> {
  installGet(getSpy, item, 'reject', postSpy);
  renderRfqDetail(RfqDetail);
  await userEvent.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
  return screen.findByTestId('rfq-modify-panel');
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('RfqDetail Modify — a scannable editor (SALES-16)', () => {
  it('drops the title that repeats the tab, and splits the editor into Terms and Lines', async () => {
    const panel = await openModify();
    expect(within(panel).queryByText('rfq.detail.modify.title')).toBeNull();
    expect(within(panel).getByRole('region', { name: 'rfq.detail.modify.section.terms' })).toBeInTheDocument();
    const lines = within(panel).getByRole('region', { name: 'rfq.detail.modify.section.lines' });
    expect(within(lines).getByRole('group', { name: 'Widget' })).toBeInTheDocument();
  });

  it('heads the line grid with seven columns: Product, …, reference and difference in one', async () => {
    const panel = await openModify();
    const header = within(panel).getByTestId('rfq-modify-columns');
    const labels = Array.from(header.children).map((cell) => cell.textContent);
    expect(labels).toEqual([
      'rfq.detail.modify.product',
      'rfq.detail.modify.quantity',
      'rfq.detail.modify.agreedUnitPrice',
      'rfq.detail.modify.referenceDifference',
      'rfq.detail.reference.column.proposed',
      'rfq.detail.modify.lineTotal',
      '',
    ]);
  });

  it('names the product picker of a line "Product", visible header or not', async () => {
    const panel = await openModify();
    const line = within(panel).getByRole('group', { name: 'Widget' });
    expect(within(line).getByRole('button', { name: 'rfq.detail.modify.product' })).toBeInTheDocument();
  });

  it('shows the reference and the difference of the typed price in one cell', async () => {
    const panel = await openModify();
    const cell = within(panel).getByTestId('rfq-modify-reference');
    // 100.00 typed against 120.00 at request.
    expect(cell).toHaveTextContent('120.00 PLN');
    expect(cell).toHaveTextContent('−16.67 %');
    expect(cell).toHaveTextContent('rfq.detail.reference.atRequest');
    // The difference is named for a screen reader, not only placed after a dot.
    expect(within(cell).getByText('rfq.detail.reference.column.difference')).toHaveClass('sr-only');
  });

  it('falls back to the signed amount where a zero reference has no percentage', async () => {
    const panel = await openModify({
      referencePrice: { amount: 0, currency: 'PLN', capturedAt: '2026-10-01T10:00:00.000Z' },
    });
    const cell = within(panel).getByTestId('rfq-modify-reference');
    expect(cell).toHaveTextContent('+100.00 PLN');
    expect(cell).not.toHaveTextContent('%');
  });

  it('shows the reference alone while no price is typed', async () => {
    const panel = await openModify();
    const input = within(panel).getByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' });
    await userEvent.clear(input);
    const cell = within(panel).getByTestId('rfq-modify-reference');
    expect(cell).toHaveTextContent('120.00 PLN');
    expect(cell).not.toHaveTextContent('%');
    expect(within(cell).queryByText('rfq.detail.reference.column.difference')).toBeNull();
  });
});
