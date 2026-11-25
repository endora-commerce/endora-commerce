import { randomUUID } from 'node:crypto';
import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import type {
  RecordMergeChoice,
  RecordMergeHostType,
  RecordMergeState,
} from '@endora-commerce/contracts';
import { RuleScoped } from '../../tenancy/org-scoped.decorator.js';
import type { CommandActor } from '../../commands/command.js';

/**
 * One merge (`specs/192-organization-merge/` data-model §1.1).
 *
 * `@RuleScoped`: which Organizations a merge touches is not a column the
 * tenant filter can read (`survivor_id` / `loser_id` hold an Organization or a
 * Project by value), so the table is read only through the host's routes,
 * which apply the host's reach rule to both ids (R-15). Platform-owned, with
 * no foreign key to any module's table (D-52).
 */
@RuleScoped()
@Entity({ tableName: 'record_merges' })
export class RecordMerge {
  [OptionalProps]?:
    | 'id'
    | 'state'
    | 'fieldChoices'
    | 'customFieldChoices'
    | 'hostContext'
    | 'actorAdminUserId'
    | 'source'
    | 'startedAt'
    | 'completedAt'
    | 'cancelledAt'
    | 'needsAttentionAt'
    | 'finalizedAt'
    | 'lastErrorCode'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'text' })
  hostType!: RecordMergeHostType;

  @Property({ type: 'uuid' })
  survivorId!: string;

  @Property({ type: 'uuid' })
  loserId!: string;

  @Property({ type: 'text' })
  state: RecordMergeState = 'running';

  /** Field codes → `survivor` | `loser`. Codes only, never values. */
  @Property({ type: 'json', columnType: 'jsonb' })
  fieldChoices: Record<string, RecordMergeChoice> = {};

  @Property({ type: 'json', columnType: 'jsonb' })
  customFieldChoices: Record<string, RecordMergeChoice> = {};

  /** Host-written context for participants (Organization: `{ roleMap }`). Ids only. */
  @Property({ type: 'json', columnType: 'jsonb' })
  hostContext: Record<string, unknown> = {};

  @Property({ type: 'text' })
  actorKind!: CommandActor['kind'];

  @Property({ type: 'uuid', nullable: true })
  actorAdminUserId: string | null = null;

  /** D-293.6 source code of the start, when server code named one. */
  @Property({ type: 'text', nullable: true })
  source: string | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  startedAt: Date = new Date();

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  completedAt: Date | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  cancelledAt: Date | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  needsAttentionAt: Date | null = null;

  /**
   * When the host's finalize committed. Set by the runner after the host's
   * finalize returns, so a resumed merge never calls finalize twice (the host's
   * finalize is idempotent besides, for a crash between the two).
   */
  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  finalizedAt: Date | null = null;

  /** A code only, never a value (audit-state discipline). */
  @Property({ type: 'text', nullable: true })
  lastErrorCode: string | null = null;

  /** Optimistic concurrency on resume and cancel. */
  @Property({ type: 'integer' })
  version: number = 1;
}
