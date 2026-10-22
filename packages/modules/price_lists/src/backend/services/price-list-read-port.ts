import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrganizationPriceBookRecord,
  PriceListReadPort,
  PriceListRecord,
} from '@endora-commerce/contracts';
import { PriceList } from '../entities/price-list.entity.js';

/**
 * The row-level read model `price_lists` publishes (feature 075, Phase P).
 *
 * `organizations` resolves which lists apply to an organisation and
 * `product_feeds` reads the list a feed prices from; both reached the entity
 * class before this port existed.
 *
 * The customer-group half left with the entity in feature 076 (D-79) — see
 * `customer_accounts/services/customer-group-read-port.ts`.
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

  async listAll(): Promise<PriceListRecord[]> {
    const lists = await this.emFactory().find(PriceList, {}, { orderBy: { priority: 'desc', name: 'asc' } });
    return lists.map(toPriceListRecord);
  }

  async listActive(): Promise<PriceListRecord[]> {
    const lists = await this.emFactory().find(
      PriceList,
      { status: 'active' },
      { orderBy: { priority: 'desc', name: 'asc' } },
    );
    return lists.map(toPriceListRecord);
  }

  async listForOrganization(input: {
    organizationChain: readonly string[];
    customerGroupId: string | null;
  }): Promise<OrganizationPriceBookRecord[]> {
    const chain = [...input.organizationChain];
    if (chain.length === 0 && !input.customerGroupId) return [];
    const rows = await this.emFactory().execute<
      Array<{
        id: string;
        name: string;
        type: string;
        currency_code: string;
        priority: number;
        status: 'scheduled' | 'active';
        organization_id: string | null;
        customer_group_id: string | null;
      }>
    >(
      `select l."id", l."name", l."type", l."currency_code", l."priority", l."status",
              m."organization_id", m."customer_group_id"
         from "price_lists" l
         join "price_list_audience_members" m on m."price_list_id" = l."id"
        where l."is_system" = false
          and l."status" in ('active', 'scheduled')
          and (l."starts_at" is null or l."starts_at" <= now())
          and (l."ends_at" is null or l."ends_at" > now())
          and (m."organization_id" = any(?::uuid[]) or m."customer_group_id" = ?::uuid)`,
      [`{${chain.join(',')}}`, input.customerGroupId],
    );
    const byBook = new Map<string, OrganizationPriceBookRecord>();
    for (const row of rows) {
      const depth = row.organization_id ? chain.indexOf(row.organization_id) : null;
      const entry: OrganizationPriceBookRecord = {
        id: row.id,
        name: row.name,
        type: row.type === 'sale' ? 'sale' : 'regular',
        currencyCode: row.currency_code.trim(),
        priority: Number(row.priority),
        status: row.status,
        reason: depth === null ? 'customer_group' : depth === 0 ? 'organization' : 'ancestor',
        depth,
      };
      const held = byBook.get(row.id);
      if (!held || (entry.depth !== null && (held.depth === null || entry.depth < held.depth))) byBook.set(row.id, entry);
    }
    return [...byBook.values()].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  }
}

export function toPriceListRecord(list: PriceList): PriceListRecord {
  return {
    id: list.id,
    name: list.name,
    currencyCode: list.currency.trim(),
    priority: list.priority,
    type: list.type,
    status: list.status,
    audienceKind: list.audienceKind,
    startsAt: list.startsAt ?? null,
    endsAt: list.endsAt ?? null,
    isSystem: list.isSystem,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}
