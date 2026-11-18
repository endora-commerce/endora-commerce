import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ReturnCaseClause — a clause shown on the returns form
 * (`specs/180-off-platform-complaints/` FR-B30 – FR-B32, research R-14, D-1).
 *
 * Platform configuration like `return_reasons`, so `@GlobalEntity`. `label`, `text`
 * and the optional `linkUrl` are per language. `revision` grows with every edit of
 * what a customer reads (label, text, link, `appliesTo`, `mode`), which is how a
 * submission proves it accepted the clause as it stands. A case stores its own copy,
 * so an edit or a delete never changes what an earlier case holds.
 */
@GlobalEntity()
@Entity({ tableName: 'return_case_clauses' })
export class ReturnCaseClause {
  [OptionalProps]?:
    | 'id'
    | 'linkUrl'
    | 'appliesTo'
    | 'mode'
    | 'salesChannelId'
    | 'weight'
    | 'isActive'
    | 'revision'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'json' })
  label!: Record<string, string>;

  @Property({ type: 'json' })
  text!: Record<string, string>;

  @Property({ type: 'json', nullable: true })
  linkUrl?: Record<string, string> | null;

  @Property({ type: 'string', length: 16 })
  appliesTo: 'return' | 'complaint' | 'both' = 'both';

  @Property({ type: 'string', length: 16 })
  mode: 'must_accept' | 'inform_only' = 'must_accept';

  /** `null` = every channel. */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  salesChannelId?: string | null;

  @Property({ type: 'integer' })
  weight: number = 100;

  @Property({ type: 'boolean' })
  isActive: boolean = true;

  @Property({ type: 'integer' })
  revision: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
