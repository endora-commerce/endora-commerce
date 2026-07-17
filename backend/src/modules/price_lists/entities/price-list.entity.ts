import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type { ApplicationRule } from '@b2b/contracts';
import { RuleScoped } from '../../../tenancy/org-scoped.decorator.js';

/**
 * PriceList — feature-011 engine shape.
 *
 * Carries lifecycle (`status`, `startsAt`, `endsAt`), type discriminator
 * (`type`), the application rule expressed as a JSONB AST, the system flag
 * marking the seeded `Default` row, and `modifiedAt` driving the resolver's
 * tie-break (FR-027).
 *
 * Legacy columns from feature 014 (`code`, `currency`, `priority`,
 * `isDefault`) are preserved for the duration of the expand→migrate→contract
 * rollout. They will be dropped by a follow-up migration once US5 wires every
 * reader through the new resolver.
 */
@RuleScoped()
@Entity({ tableName: 'price_lists' })
export class PriceList {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'modifiedAt'
    | 'isDefault'
    | 'isSystem'
    | 'priority'
    | 'type'
    | 'status'
    | 'startsAt'
    | 'endsAt'
    | 'applicationRule';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  // ----- Legacy columns (kept until expand→migrate→contract completes) -----

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  priority: number = 0;

  // ----- Engine columns (feature 011) -------------------------------------

  @Property({ type: 'string', length: 8 })
  @Index()
  type: 'base' | 'sale' = 'base';

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'draft' | 'active' | 'scheduled' | 'expired' = 'draft';

  @Property({ type: 'datetime', nullable: true })
  startsAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  endsAt?: Date | null;

  @Property({ type: 'json' })
  applicationRule: ApplicationRule = { kind: 'all' };

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'datetime' })
  modifiedAt: Date = new Date();

  // ----- Timestamps -------------------------------------------------------

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
