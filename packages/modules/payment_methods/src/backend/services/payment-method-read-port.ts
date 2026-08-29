import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentMethodReadPort, PaymentMethodRecord } from '@endora-commerce/contracts';
import { PaymentMethod } from '../entities/payment-method.entity.js';

/**
 * The row-level read model `payment_methods` publishes (feature 075, Phase P).
 *
 * Nineteen of this module's 33 inbound import sites are a direct read of the
 * `PaymentMethod` entity: four gateways resolving the method behind a payment,
 * `orders` resolving it at placement, `quick_order` resolving a buyer's
 * default, `payments` mapping an outcome onto an order status.
 *
 * `additionalPrice` stays a string across the boundary: it is `decimal(14,2)`
 * and lands verbatim in the order's `paymentMethodSnapshot`.
 */
export class PaymentMethodReadService implements PaymentMethodReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<PaymentMethodRecord | null> {
    const method = await this.emFactory().findOne(PaymentMethod, { id });
    return method ? toPaymentMethodRecord(method) : null;
  }

  async findByIds(ids: readonly string[]): Promise<PaymentMethodRecord[]> {
    if (ids.length === 0) return [];
    const methods = await this.emFactory().find(PaymentMethod, { id: { $in: [...ids] } });
    return methods.map(toPaymentMethodRecord);
  }

  async findByCode(code: string): Promise<PaymentMethodRecord | null> {
    const method = await this.emFactory().findOne(PaymentMethod, { code });
    return method ? toPaymentMethodRecord(method) : null;
  }

  async listAll(): Promise<PaymentMethodRecord[]> {
    const methods = await this.emFactory().find(PaymentMethod, {}, { orderBy: { code: 'asc' } });
    return methods.map(toPaymentMethodRecord);
  }

  async listActive(): Promise<PaymentMethodRecord[]> {
    const methods = await this.emFactory().find(
      PaymentMethod,
      { status: 'active' },
      { orderBy: { code: 'asc' } },
    );
    return methods.map(toPaymentMethodRecord);
  }
}

export function toPaymentMethodRecord(method: PaymentMethod): PaymentMethodRecord {
  return {
    id: method.id,
    code: method.code,
    name: method.name,
    kind: method.kind,
    adapter: method.adapter,
    status: method.status,
    additionalPrice: method.additionalPrice,
    statusOnPending: method.statusOnPending,
    statusOnSuccess: method.statusOnSuccess,
    statusOnFailure: method.statusOnFailure,
    createdAt: method.createdAt,
    updatedAt: method.updatedAt,
  };
}
