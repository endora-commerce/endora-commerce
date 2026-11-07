import { describe, expect, it } from 'vitest';
import { moneySum } from '@endora-commerce/contracts';
import { cartVatMoney } from '../../../../packages/modules/carts/src/backend/services/cart-money.js';
import { orderTotalsMoney } from '../../../../packages/modules/orders/src/backend/services/order-money.js';

/**
 * Issue #436 — the cart's gross totals agree to the cent with the totals the
 * order computes at placement, for the same lines at the same rates.
 *
 * The two modules do not share an implementation by import (Constitution I):
 * both call the contracts' `vatByRate`, and this file holds them to one answer
 * — mixed rates, sub-cent unit prices, lines whose own grosses add up to a
 * cent more than the rate's, and a discount. Delivery and the payment surcharge
 * are chosen at checkout and are zero here; the order adds them untaxed.
 * `backend/test/integration/carts/cart-vat-equals-placement.test.ts` pins the
 * same property through the routes, with the rates resolved from tax rules.
 */
const BASKETS: Array<{ name: string; discount: string; lines: Array<{ unitPrice: string; quantity: number; taxRate: number }> }> = [
  {
    name: '23 % + 8 % + 5 % + 0 %',
    discount: '0.00',
    lines: [
      { unitPrice: '29.50', quantity: 1, taxRate: 0.23 },
      { unitPrice: '16.50', quantity: 1, taxRate: 0.23 },
      { unitPrice: '8.25', quantity: 2, taxRate: 0.08 },
      { unitPrice: '0.0125', quantity: 800, taxRate: 0.05 },
      { unitPrice: '12.00', quantity: 1, taxRate: 0 },
    ],
  },
  {
    name: 'sub-cent unit prices with a discount',
    discount: '3.33',
    lines: [
      { unitPrice: '0.0151', quantity: 333, taxRate: 0.23 },
      { unitPrice: '1.0049', quantity: 7, taxRate: 0.08 },
      { unitPrice: '19.99', quantity: 3, taxRate: 0.05 },
      { unitPrice: '0.3333', quantity: 3, taxRate: 0.23 },
    ],
  },
  {
    name: 'one rate',
    discount: '0.00',
    lines: [
      { unitPrice: '11.49', quantity: 3, taxRate: 0.23 },
      { unitPrice: '9.05', quantity: 3, taxRate: 0.23 },
    ],
  },
];

describe('#436 — cart VAT equals the order total for the same lines', () => {
  for (const basket of BASKETS) {
    it(basket.name, () => {
      const cart = cartVatMoney(basket.lines, basket.discount);
      const order = orderTotalsMoney({
        lines: basket.lines,
        deliveryTotal: '0',
        paymentSurcharge: '0',
        discountTotal: basket.discount,
      });
      expect(cart.vatTotal).toBe(Number(order.taxTotal));
      expect(cart.subtotalGross).toBe(Number(moneySum([order.subtotal, order.taxTotal])));
      expect(cart.grandTotalGross).toBe(Number(order.total));
      expect(cart.lines.map((l) => l.gross)).toEqual(order.lines.map((l) => Number(l.gross)));
    });
  }
});
