import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerGroupReadPort, CustomerGroupRecord } from '@b2b/contracts';
import { CustomerGroup } from '../entities/customer-group.entity.js';

/**
 * The row-level read model `customer_accounts` publishes over customer groups.
 *
 * It arrived here with the entity (feature 076, D-79) from
 * `price_lists/services/price-list-read-port.ts`, unchanged in shape: the
 * container name, the interface and its three methods are what they were, so
 * `pwa/backend.ts` did not have to be touched and the port check's before and
 * after are directly comparable.
 *
 * `price_lists` is now a consumer rather than the provider — the pricing
 * rule-target picker and the rule-target validation read it.
 */
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
