import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { RecordMergeHostType } from '@endora-commerce/contracts';
import { RuleScoped } from '../../tenancy/org-scoped.decorator.js';

/**
 * One running merge per record (`specs/192-organization-merge/` data-model
 * §1.3). Rows for the survivor and the loser are inserted by the start and
 * deleted at completion or cancel; a conflicting insert is
 * `409 RECORD_MERGE_ALREADY_RUNNING`, which is what makes two racing starts safe.
 */
@RuleScoped()
@Entity({ tableName: 'record_merge_locks' })
export class RecordMergeLock {
  @PrimaryKey({ type: 'text' })
  hostType!: RecordMergeHostType;

  @PrimaryKey({ type: 'uuid' })
  recordId!: string;

  @Property({ type: 'uuid' })
  mergeId!: string;
}
