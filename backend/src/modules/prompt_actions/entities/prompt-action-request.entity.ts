import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';
import type {
  PromptActionClarification,
  PromptActionPlan,
  PromptActionResult,
  PromptActionStatus,
} from '@b2b/contracts';

/**
 * PromptActionRequest — feature 043 / data-model §1–§2.
 *
 * One operator-submitted natural-language instruction with its full
 * lifecycle: interpretation output (plan or clarification), the minimal
 * provider-neutral conversation retained for the single clarify round-trip,
 * confirmation, execution result, and the seen-marker driving the
 * "finished while you were away" notice (FR-018).
 *
 * No FK on `admin_user_id` (module_actions precedent — lifecycle owns
 * cleanup, admin users are platform-owned).
 */
@GlobalEntity()
@Entity({ tableName: 'prompt_action_requests' })
@Index({ properties: ['adminUserId', 'createdAt'] })
export class PromptActionRequest {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'language'
    | 'provider'
    | 'model'
    | 'plan'
    | 'clarification'
    | 'conversation'
    | 'result'
    | 'error'
    | 'bulkOperationId'
    | 'seenAt'
    | 'confirmedAt'
    | 'finishedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'admin_user_id' })
  adminUserId!: string;

  @Property({ type: 'text' })
  prompt!: string;

  @Property({ type: 'string', length: 12, nullable: true })
  language: string | null = null;

  @Property({ type: 'string', length: 32 })
  status!: PromptActionStatus;

  @Property({ type: 'string', length: 32, nullable: true })
  provider: string | null = null;

  @Property({ type: 'string', length: 120, nullable: true })
  model: string | null = null;

  @Property({ type: 'json', nullable: true })
  plan: PromptActionPlan | null = null;

  @Property({ type: 'json', nullable: true })
  clarification: PromptActionClarification | null = null;

  /** Provider-neutral transcript retained for the clarify round-trip + diagnostics. */
  @Property({ type: 'json', nullable: true })
  conversation: unknown | null = null;

  @Property({ type: 'json', nullable: true })
  result: PromptActionResult | null = null;

  @Property({ type: 'text', nullable: true })
  error: string | null = null;

  @Property({ type: 'uuid', fieldName: 'bulk_operation_id', nullable: true })
  bulkOperationId: string | null = null;

  @Property({ type: 'datetime', fieldName: 'seen_at', nullable: true })
  seenAt: Date | null = null;

  @Property({ type: 'datetime', fieldName: 'confirmed_at', nullable: true })
  confirmedAt: Date | null = null;

  @Property({ type: 'datetime', fieldName: 'finished_at', nullable: true })
  finishedAt: Date | null = null;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({
    type: 'datetime',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt: Date = new Date();
}
