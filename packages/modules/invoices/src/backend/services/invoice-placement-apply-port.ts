import type { EntityManager } from '@mikro-orm/postgresql';
import { Invoice } from '../entities/invoice.entity.js';
import type {
  InvoicePlacementApplyPort,
  ProformaInvoiceOpened,
} from '../../ports/index.js';

/**
 * `invoicePlacementApplyPort` — the proforma an order is placed with, written
 * on the caller's `EntityManager` (feature 080, T048; D-169).
 *
 * `orders` held this module's `Invoice` class for it until T048 and did the
 * `tx.create` itself. D-168 leaves a packaged `invoices` no entity class for
 * `orders` to name, so the reach had to go before this module moves; the
 * transaction it runs in did not change, and `invoices_order_fk` is untouched.
 * The port's own doc block states the constraint.
 *
 * **The number is derived here, and the expression is the one that moved.**
 * `orders` computed `<YYYY-MM-DD>/<first 8 of the order id>` and passed the
 * string in; both of its inputs are already parameters of this call, so keeping
 * the derivation on the consumer's side would have published a parameter only
 * the consumer knows how to fill. It is deliberately the *same* expression:
 * this is a proforma, which the numbering sequence this module owns does not
 * govern — `status` stays `pending` until an issuance path takes it further,
 * and `InvoiceNumberingService` is what assigns a real number then.
 */
export class InvoicePlacementApplyService implements InvoicePlacementApplyPort {
  async createProformaForOrder(
    em: EntityManager,
    input: { orderId: string; currency: string; total: string },
  ): Promise<ProformaInvoiceOpened> {
    // command-coverage-ignore: the proforma an audited order placement opens,
    // inside that placement's own transaction. `orders` records the placement
    // as one operation through its own Command; a second audit entry for the
    // document it opened would record the same decision twice.
    const invoice = em.create(Invoice, {
      orderId: input.orderId,
      kind: 'proforma',
      number: `${new Date().toISOString().slice(0, 10)}/${input.orderId.slice(0, 8)}`,
      currency: input.currency,
      total: input.total,
      status: 'pending',
    });
    await em.persistAndFlush(invoice);
    // A published record, never the managed entity (D-77's first narrowing).
    return { id: invoice.id, orderId: invoice.orderId, number: invoice.number };
  }
}
