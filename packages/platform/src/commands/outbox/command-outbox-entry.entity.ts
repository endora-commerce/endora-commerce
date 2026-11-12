import { randomUUID } from 'node:crypto';
import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import type { OutboxData } from '@endora-commerce/contracts';
import { GlobalEntity } from '../../tenancy/org-scoped.decorator.js';
import type { CommandActor } from '../command.js';

/** Where a row is in its delivery (`data-model.md` §4). */
export type CommandOutboxStatus = 'pending' | 'in_flight' | 'delivered' | 'dead';

/**
 * One delivery of one Command execution to one `afterCommit` handler
 * (`specs/176-command-hooks-outbox/` FR-030, `data-model.md` §1).
 *
 * Written by the Command Bus on the Command's own transaction — so a
 * rolled-back Command leaves none — and read and updated by the drain, in the
 * platform's system scope, with raw SQL (`./store.ts`): a claim is a
 * `for update skip locked` statement, not an entity load.
 *
 * **Platform-global, like `audit_log_entries`** (Principle XI): no module owns
 * it and no tenant filter applies. That is what limits `data` to
 * `audit-state.md` list 1 — ids, codes, booleans, counts, dates, field names —
 * so a global read discloses nothing tenant-valued (R-15). `organizationId` is
 * the routing for the context the handler runs in, not a filter, and has no
 * foreign key: a kernel table references no module's table (D-52).
 *
 * `sequence` (`bigint generated always as identity`) is the claim order and
 * the admin list's keyset. It is deliberately **not mapped**: the database
 * assigns it, an insert must not name it, and nothing reads it through the
 * entity.
 */
@GlobalEntity()
@Entity({ tableName: 'command_outbox' })
export class CommandOutboxEntry {
  [OptionalProps]?:
    | 'id'
    | 'organizationId'
    | 'data'
    | 'actorAdminUserId'
    | 'impersonatedCustomerAccountId'
    | 'actorCustomerAccountId'
    | 'requestId'
    | 'status'
    | 'attempts'
    | 'availableAt'
    | 'lockedUntil'
    | 'lastErrorCode'
    | 'lastErrorClass'
    | 'createdAt'
    | 'deliveredAt'
    | 'deadAt';

  /** The handler's `messageId`: its idempotency key, stable across retries. */
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'text' })
  action!: string;

  @Property({ type: 'text' })
  objectType!: string;

  @Property({ type: 'text' })
  objectId!: string;

  @Property({ type: 'uuid', nullable: true })
  organizationId: string | null = null;

  /** The handler's module id. */
  @Property({ type: 'text' })
  hookModule!: string;

  @Property({ type: 'text' })
  hookId!: string;

  /** The owner's `outboxData`: list 1 only. */
  @Property({ type: 'json', columnType: 'jsonb' })
  data: OutboxData = {};

  @Property({ type: 'text' })
  actorKind!: CommandActor['kind'];

  @Property({ type: 'uuid', nullable: true })
  actorAdminUserId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  impersonatedCustomerAccountId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  actorCustomerAccountId: string | null = null;

  @Property({ type: 'text', nullable: true })
  requestId: string | null = null;

  @Property({ type: 'text' })
  status: CommandOutboxStatus = 'pending';

  @Property({ type: 'integer' })
  attempts = 0;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  availableAt: Date = new Date();

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  lockedUntil: Date | null = null;

  /** A code-shaped string, never a message. */
  @Property({ type: 'text', nullable: true })
  lastErrorCode: string | null = null;

  /** The error's constructor name. */
  @Property({ type: 'text', nullable: true })
  lastErrorClass: string | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  deliveredAt: Date | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  deadAt: Date | null = null;
}
