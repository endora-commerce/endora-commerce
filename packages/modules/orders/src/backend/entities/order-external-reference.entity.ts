import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type { OrderExternalReferenceState } from '@endora-commerce/contracts';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * OrderExternalReference — what one external system (an ERP, a WMS, a
 * fulfilment connector) last reported about one order (issue #1030): its own
 * number for the order, where the hand-over stands, and its words when it
 * refused. Written only through `orderExternalReferencePort`.
 *
 * One row per order and system, held by the unique constraint. `system` is the
 * writer's stable key and nothing references it: a system whose module is
 * uninstalled leaves its rows in place, as history.
 *
 * Org-scoped (Principle XI): `organizationId` is copied from the order at
 * insert, as `order_transition_effects` does, so the always-on tenant filter
 * confines every read to the caller's organizations — including the reverse
 * lookup by reference, which names no order.
 */
@OrgScoped()
@Entity({ tableName: 'order_external_references' })
@Unique({ name: 'order_external_references_order_system_unique', properties: ['orderId', 'system'] })
@Index({ name: 'order_external_references_system_reference_index', properties: ['system', 'reference'] })
export class OrderExternalReference {
  [OptionalProps]?: 'id' | 'reference' | 'message' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'uuid' })
  orderId!: string;

  @Property({ type: 'text' })
  system!: string;

  /** `null` until the external system has answered with its number. Hydrated as `undefined` when null. */
  @Property({ type: 'text', nullable: true })
  reference?: string | null;

  @Property({ type: 'text' })
  state!: OrderExternalReferenceState;

  /** Plain text, at most 1000 characters. Hydrated as `undefined` when null. */
  @Property({ type: 'text', nullable: true })
  message?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  /** Set by the write that changed the row; a write that changed nothing does not reach it. */
  @Property({ type: 'datetime' })
  updatedAt: Date = new Date();
}
