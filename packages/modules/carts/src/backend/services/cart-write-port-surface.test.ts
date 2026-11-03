import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CartWritePort } from '@endora-commerce/contracts';
import { CartService } from './cart-service.js';
import { createCartWritePort } from './cart-read-port.js';

/**
 * Issue #601 — the published cart write port offers no operation that closes a
 * buyer's basket without an order.
 *
 * `clearForCustomer` deleted every line of the customer's active basket and
 * marked it `completed` with no `completed_order_id`: a basket that reads as
 * finished and produced nothing. Since #169 it had no production caller, only
 * test fixtures, which now reset a basket through
 * `backend/test/helpers/customer-basket.ts`. Published, it was the next module's
 * obvious way to "start from an empty basket" and the way back to the defect
 * #169 fixed — so it is gone from the contract, the adapter and the service.
 */
const REMOVED = 'clearForCustomer';

/**
 * The contract half, held by the type-check: an interface has no runtime value
 * to enumerate, so this line stops compiling the moment `CartWritePort`
 * publishes the method again.
 */
const contractOmitsIt: typeof REMOVED extends keyof CartWritePort ? never : true = true;

describe('the published cart write port (issue #601)', () => {
  it('does not publish `clearForCustomer` in the contract', () => {
    expect(contractOmitsIt).toBe(true);
  });

  it('the adapter does not offer it either', () => {
    const port = createCartWritePort(
      () => {
        throw new Error('not reached');
      },
      () => {
        throw new Error('not reached');
      },
    );
    expect(REMOVED in port).toBe(false);
    expect('replaceItemsForCustomer' in port).toBe(true);
  });

  it('nor does the service the adapter wraps', () => {
    expect(REMOVED in CartService.prototype).toBe(false);
  });

  it('the cart entity no longer names it as a way to `completed`', () => {
    const entity = readFileSync(
      fileURLToPath(new URL('../entities/cart.entity.ts', import.meta.url)),
      'utf8',
    );
    expect(entity).not.toContain(REMOVED);
  });
});
