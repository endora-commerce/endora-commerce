import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import Link from 'next/link';
import { OrderItemRows } from '../../components/orders/OrderItemRows';
import { orderSectionTotals } from '../../components/line-groups/GroupedLineRows';
import type { OrderItem, OrderSummary } from '../../lib/api/orders';
import { formatMoney } from '../../lib/i18n/money';

/**
 * Feature 159, T066 — the storefront order detail shows the order's line groups
 * read-only (`specs/159-quote-request-item-groups/contracts/ui.md` §3; FR-031,
 * FR-033, FR-063): a heading row per group, its lines, a summary of item count,
 * net, VAT and gross from the lines' `unitPrice` and `taxRate` (VAT per rate,
 * issue #428; the `lineTotal` of each row is informational),
 * then *Other items*. An order without groups renders exactly the rows it
 * always did. Asserted on the markup the server sends.
 */

const HALL_A = { id: '11111111-1111-4111-8111-111111111111', name: 'Hall A', position: 0 };

function item(id: string, unitPrice: number, quantity: number, extra: Partial<OrderItem> = {}): OrderItem {
  return {
    id,
    productId: `p-${id}`,
    variantId: null,
    quantity,
    unitPrice,
    taxRate: 0.23,
    lineTotal: Math.round(unitPrice * quantity * 1.23 * 100) / 100,
    productSnapshot: { sku: `SKU-${id}`, name: `Product ${id}`, primaryAssetUrl: null },
    variantSnapshot: null,
    groupId: null,
    position: 0,
    ...extra,
  };
}

const order = (items: OrderItem[], itemGroups?: OrderSummary['itemGroups']): Pick<OrderSummary, 'items' | 'itemGroups' | 'currency'> => ({
  items,
  currency: 'PLN',
  ...(itemGroups ? { itemGroups } : {}),
});

const html = (o: ReturnType<typeof order>, locale = 'en-US'): string =>
  renderToString(
    <table>
      <tbody>
        <OrderItemRows order={o} locale={locale} />
      </tbody>
    </table>,
  );

const headings = (markup: string): string[] =>
  [...markup.matchAll(/<th colSpan="4" scope="colgroup"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]!);
const products = (markup: string): string[] => [...markup.matchAll(/>(Product [^<]*)<\/a>/g)].map((m) => m[1]!);

describe('storefront order detail — line groups (T066)', () => {
  it('an order without groups renders exactly the rows it always did (SC-004)', () => {
    const items = [item('a', 10, 2), item('b', 5, 1)];
    // The page's rows as they were before feature 159.
    const before = renderToString(
      <table>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>
                <Link href={`/p/${it.productId}`}>{it.productSnapshot.name}</Link>
                <br />
                {/* Keyed since issue #85: one catalogue sentence, so no text-node separator. */}
                <small className="text-subtle">{`SKU: ${it.variantSnapshot?.sku ?? it.productSnapshot.sku}`}</small>
              </td>
              <td>{it.quantity}</td>
              <td>{formatMoney(it.unitPrice, 'PLN', 'en-US')}</td>
              <td className="text-right">{formatMoney(it.lineTotal, 'PLN', 'en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>,
    );
    expect(html(order(items))).toBe(before);
    expect(html(order(items, []))).toBe(before);
  });

  it('heads each group, then Other items, with the lines in display order', () => {
    const markup = html(
      order(
        [
          item('g2', 5, 1, { groupId: HALL_A.id, position: 1 }),
          item('u', 100, 1),
          item('g1', 10, 2, { groupId: HALL_A.id, position: 0 }),
        ],
        [HALL_A],
      ),
    );
    expect(headings(markup)).toEqual(['Hall A', 'Other items']);
    expect(products(markup)).toEqual(['Product g1', 'Product g2', 'Product u']);
    // No control of any kind changes a group (FR-063).
    expect(markup).not.toMatch(/<(button|input|select|form)\b/);
  });

  it('summarises each section from unitPrice and taxRate', () => {
    const markup = html(
      order([item('a', 10, 2, { groupId: HALL_A.id }), item('b', 5, 1, { groupId: HALL_A.id, position: 1 }), item('c', 100, 1)], [HALL_A]),
    );
    const pln = (n: number): string => formatMoney(n, 'PLN', 'en-US');
    // Hall A: net 25.00, VAT 25.00 × 0.23 = 5.75, gross 30.75.
    expect(markup).toContain(`2 items · net ${pln(25)} · VAT ${pln(5.75)} · gross ${pln(30.75)}`);
    expect(markup).toContain(`1 item · net ${pln(100)} · VAT ${pln(23)} · gross ${pln(123)}`);
  });

  it('the totals rule: VAT per rate on the sum of the nets, not the sum of the line totals (#428)', () => {
    // The line totals are each line's own rounding, 36.29 + 4.31 = 40.60; the
    // section is 33.00 net at 23 %, 7.59 VAT, 40.59 gross — the order's method.
    expect(orderSectionTotals([item('a', 29.5, 1), item('b', 3.5, 1)])).toEqual({
      count: 2,
      net: 33,
      vat: 7.59,
      gross: 40.59,
    });
  });

  it('speaks Polish', () => {
    const markup = html(order([item('a', 10, 1, { groupId: HALL_A.id }), item('b', 10, 1)], [HALL_A]), 'pl-PL');
    expect(headings(markup)).toEqual(['Hall A', 'Pozostałe pozycje']);
    expect(markup).toContain('1 pozycja · netto');
  });
});
