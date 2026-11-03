import type { BackendServerHandle } from './test-server.js';

/** The basket to empty: one customer's, on one sales channel. */
export interface CustomerBasketKey {
  readonly customerAccountId: string;
  readonly salesChannelId: string;
}

/**
 * Empties a customer's basket on one channel, for a fixture that needs the
 * buyer to start from nothing (issue #601).
 *
 * The test fixtures of a run share the seeded buyer, so a file that adds lines
 * — or a case that fails before placing them — leaves them for the next. This
 * resets the buyer's **active** basket on that channel by deleting it; its lines
 * and audit entries go with it (`on delete cascade`), and the next cart call
 * creates a fresh one, so nothing a basket carries survives: not a line, not a
 * re-price, not an approval, not a quote it was seeded from. The customer's
 * baskets on other channels, the completed baskets that orders were placed from
 * and the `working` ones are left as they are.
 *
 * It is a test helper on purpose. `CartWritePort.clearForCustomer` did this
 * job until #601 removed it from the published port: in production, closing a
 * basket without an order is the defect #169 fixed, so the only code left that
 * needs a reset is a fixture's. It writes SQL, so it works whatever the
 * presence of the `carts` module in the handle.
 */
export async function emptyCustomerBasket(
  h: Pick<BackendServerHandle, 'em'>,
  basket: CustomerBasketKey,
): Promise<void> {
  await h
    .em()
    .getConnection()
    .execute(
      `delete from "carts"
        where "customer_account_id" = ?
          and "sales_channel_id" = ?
          and "status" = 'active'`,
      [basket.customerAccountId, basket.salesChannelId],
    );
}
