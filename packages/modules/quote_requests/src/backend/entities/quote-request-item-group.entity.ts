import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * QuoteRequestItemGroup — a named, ordered group of a quote request's lines
 * (feature 159, `specs/159-quote-request-item-groups/data-model.md` §1.1).
 *
 * Lines point at a group through `quote_request_items.group_id` (on delete set
 * null: deleting a group never deletes a line). Written only inside the
 * administrator's `modify` and `createOnBehalf`, under the quote's row lock and
 * in their audit entry; every save renumbers `position` 0…g-1.
 *
 * Classified `@TransitivelyScoped('QuoteRequest', 'quoteRequestId')`
 * (research R-7): a group has no tenant column and belongs to exactly one
 * `@OrgScoped` quote request. The classification attaches no query filter, so
 * every read goes through the parent's visibility first
 * (`findVisibleForAdmin` / `findVisibleForCustomer`) and reads groups by the
 * quote id it already holds.
 */
@TransitivelyScoped('QuoteRequest', 'quoteRequestId')
@Entity({ tableName: 'quote_request_item_groups' })
export class QuoteRequestItemGroup {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  quoteRequestId!: string;

  /** Trimmed, 1–120 characters. Operator content, never translated. */
  @Property({ type: 'string', length: 120 })
  name!: string;

  /** 0-based order among the quote's groups. */
  @Property({ type: 'integer' })
  position!: number;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
