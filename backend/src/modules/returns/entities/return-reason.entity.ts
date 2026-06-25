import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * ReturnReason — feature 046 (US7, FR-030).
 *
 * A managed return/complaint reason presented on the storefront form. `appliesTo`
 * restricts a reason to Returns, Complaints, or both; `isActive` + `weight`
 * control visibility and order.
 */
@Entity({ tableName: 'return_reasons' })
export class ReturnReason {
  [OptionalProps]?: 'id' | 'isActive' | 'weight' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** Localized labels, e.g. { en: 'Damaged in transit', pl: 'Uszkodzone w transporcie' }. */
  @Property({ type: 'json' })
  label!: Record<string, string>;

  /** `return` | `complaint` | `both`. */
  @Property({ type: 'string', length: 16 })
  appliesTo!: 'return' | 'complaint' | 'both';

  @Property({ type: 'boolean' })
  isActive: boolean = true;

  @Property({ type: 'integer' })
  weight: number = 100;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
