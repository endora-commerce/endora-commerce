import type { EntityManager } from '@mikro-orm/postgresql';
import type { DeliveryMethodReadPort, DeliveryMethodRecord } from '@endora-commerce/contracts';
import { DeliveryMethod } from '../entities/delivery-method.entity.js';
import {
  deliveryMethodIdsAvailableInChannel,
  type DeliveryMethodChannelReads,
} from './channel-availability.js';

/**
 * The row-level read model `delivery_methods` publishes (feature 075, Phase P).
 *
 * Five of the thirteen inbound sites read the entity: `orders` resolving the
 * method at placement, `shipments` resolving it at dispatch and again in its
 * receive handler, `quick_order` resolving a buyer's default, and the dev
 * seed.
 *
 * `cost` stays a decimal string — it lands verbatim in the order's
 * `deliveryMethodSnapshot`, and a `number` cannot round-trip it.
 */
export class DeliveryMethodReadService implements DeliveryMethodReadPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly channelMembership: DeliveryMethodChannelReads,
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
    if ((await this.emFactory().count(DeliveryMethod, { id })) === 0) return false;
    const offered = await deliveryMethodIdsAvailableInChannel(
      this.channelMembership,
      salesChannelId,
      [id],
    );
    return offered.has(id);
  }

  async findById(id: string): Promise<DeliveryMethodRecord | null> {
    const method = await this.emFactory().findOne(DeliveryMethod, { id });
    return method ? toDeliveryMethodRecord(method) : null;
  }

  async findByIds(ids: readonly string[]): Promise<DeliveryMethodRecord[]> {
    if (ids.length === 0) return [];
    const methods = await this.emFactory().find(DeliveryMethod, { id: { $in: [...ids] } });
    return methods.map(toDeliveryMethodRecord);
  }

  async findByCode(code: string): Promise<DeliveryMethodRecord | null> {
    const method = await this.emFactory().findOne(DeliveryMethod, { code });
    return method ? toDeliveryMethodRecord(method) : null;
  }

  async listAll(): Promise<DeliveryMethodRecord[]> {
    const methods = await this.emFactory().find(DeliveryMethod, {}, { orderBy: { code: 'asc' } });
    return methods.map(toDeliveryMethodRecord);
  }

  async listActive(): Promise<DeliveryMethodRecord[]> {
    const methods = await this.emFactory().find(
      DeliveryMethod,
      { status: 'active' },
      { orderBy: { code: 'asc' } },
    );
    return methods.map(toDeliveryMethodRecord);
  }
}

export function toDeliveryMethodRecord(method: DeliveryMethod): DeliveryMethodRecord {
  return {
    id: method.id,
    code: method.code,
    name: method.name,
    cost: method.cost,
    currency: method.currency,
    status: method.status,
    adapter: method.adapter,
    statusOnSuccess: method.statusOnSuccess,
    statusOnFailure: method.statusOnFailure,
    createdAt: method.createdAt,
    updatedAt: method.updatedAt,
  };
}
