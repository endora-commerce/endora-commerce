import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentMethodReadPort, PaymentMethodRecord } from '@endora-commerce/contracts';
import { PaymentMethod } from '../entities/payment-method.entity.js';
import {
  paymentMethodIdsAvailableInChannel,
  type PaymentMethodChannelReads,
} from './channel-availability.js';

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
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly channelMembership: PaymentMethodChannelReads,
  ) {}

  /**
   * Whether the method is offered in `salesChannelId` — bound to it, or bound
   * to no channel at all (`./channel-availability.ts`). It says nothing about
   * `status`: a caller placing an order asks both questions, and a caller
   * explaining an old order asks neither.
   */
  async isAvailableInChannel(id: string, salesChannelId: string): Promise<boolean> {
    // An id that names no method is bound to no channel either, and must not
    // read as "unrestricted".
    if ((await this.emFactory().count(PaymentMethod, { id })) === 0) return false;
    const offered = await paymentMethodIdsAvailableInChannel(
      this.channelMembership,
      salesChannelId,
      [id],
    );
    return offered.has(id);
  }

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
