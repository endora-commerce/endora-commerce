import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerGroupReadPort,
  CustomerGroupRecord,
  PriceListReadPort,
  PriceListRecord,
} from '@b2b/contracts';
import { CustomerGroup } from '../entities/customer-group.entity.js';
import { PriceList } from '../entities/price-list.entity.js';

/**
 * The two row-level read models `price_lists` publishes (feature 075, Phase P).
 *
 * `organizations` resolves which lists apply to an organisation and
 * `product_feeds` reads the list a feed prices from; `customers` and `pwa`
 * render the customer-group picker. All four reach the entity classes today.
 *
 * `listActive` exists on the price-list side because "active" is a status the
 * owning module defines and the schedule can move — a caller filtering on
 * `status === 'active'` itself is a caller that will not notice the day
 * `scheduled` starts counting.
 */
export class PriceListReadService implements PriceListReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<PriceListRecord | null> {
    const list = await this.emFactory().findOne(PriceList, { id });
    return list ? toPriceListRecord(list) : null;
  }

  async findByIds(ids: readonly string[]): Promise<PriceListRecord[]> {
    if (ids.length === 0) return [];
    const lists = await this.emFactory().find(PriceList, { id: { $in: [...ids] } });
    return lists.map(toPriceListRecord);
  }

  async findByCode(code: string): Promise<PriceListRecord | null> {
    const list = await this.emFactory().findOne(PriceList, { code });
    return list ? toPriceListRecord(list) : null;
  }

  async listAll(): Promise<PriceListRecord[]> {
    const lists = await this.emFactory().find(
      PriceList,
      {},
      { orderBy: { priority: 'desc', code: 'asc' } },
    );
    return lists.map(toPriceListRecord);
  }

  async listActive(): Promise<PriceListRecord[]> {
    const lists = await this.emFactory().find(
      PriceList,
      { status: 'active' },
      { orderBy: { priority: 'desc', code: 'asc' } },
    );
    return lists.map(toPriceListRecord);
  }
}

export class CustomerGroupReadService implements CustomerGroupReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<CustomerGroupRecord | null> {
    const group = await this.emFactory().findOne(CustomerGroup, { id });
    return group ? toCustomerGroupRecord(group) : null;
  }

  async findByIds(ids: readonly string[]): Promise<CustomerGroupRecord[]> {
    if (ids.length === 0) return [];
    const groups = await this.emFactory().find(CustomerGroup, { id: { $in: [...ids] } });
    return groups.map(toCustomerGroupRecord);
  }

  async listAll(): Promise<CustomerGroupRecord[]> {
    const groups = await this.emFactory().find(CustomerGroup, {}, { orderBy: { code: 'asc' } });
    return groups.map(toCustomerGroupRecord);
  }
}

export function toPriceListRecord(list: PriceList): PriceListRecord {
  return {
    id: list.id,
    code: list.code,
    name: list.name,
    currency: list.currency,
    isDefault: list.isDefault,
    priority: list.priority,
    type: list.type,
    status: list.status,
    startsAt: list.startsAt ?? null,
    endsAt: list.endsAt ?? null,
    applicationRule: list.applicationRule,
    isSystem: list.isSystem,
    modifiedAt: list.modifiedAt,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

export function toCustomerGroupRecord(group: CustomerGroup): CustomerGroupRecord {
  return {
    id: group.id,
    code: group.code,
    name: group.name,
    description: group.description ?? null,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}
