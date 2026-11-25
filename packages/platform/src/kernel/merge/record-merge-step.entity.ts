import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import type { RecordMergeDeferredReason, RecordMergeStepState } from '@endora-commerce/contracts';
import { RuleScoped } from '../../tenancy/org-scoped.decorator.js';

/**
 * One participant's part of a merge (`specs/192-organization-merge/`
 * data-model §1.2). Classified like its merge: read only through the host's
 * routes, which apply the host's reach rule.
 */
@RuleScoped()
@Entity({ tableName: 'record_merge_steps' })
export class RecordMergeStep {
  [OptionalProps]?:
    | 'state'
    | 'trailing'
    | 'movedCount'
    | 'batchCount'
    | 'attempts'
    | 'deferredReason'
    | 'lastErrorCode'
    | 'lastErrorMessage'
    | 'startedAt'
    | 'finishedAt';

  @PrimaryKey({ type: 'uuid' })
  mergeId!: string;

  @PrimaryKey({ type: 'text' })
  moduleId!: string;

  @PrimaryKey({ type: 'text' })
  participationKey!: string;

  @Property({ type: 'text' })
  phase!: string;

  @Property({ type: 'text' })
  state: RecordMergeStepState = 'pending';

  /** May finish after finalize (R-16). */
  @Property({ type: 'boolean' })
  trailing: boolean = false;

  @Property({ type: 'bigint' })
  movedCount: number = 0;

  @Property({ type: 'integer' })
  batchCount: number = 0;

  /** Failed attempts of the current batch. */
  @Property({ type: 'integer' })
  attempts: number = 0;

  @Property({ type: 'text', nullable: true })
  deferredReason: RecordMergeDeferredReason | null = null;

  @Property({ type: 'text', nullable: true })
  lastErrorCode: string | null = null;

  /** Redacted: the error's class and code, never a record value. */
  @Property({ type: 'text', nullable: true })
  lastErrorMessage: string | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  startedAt: Date | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  finishedAt: Date | null = null;
}
