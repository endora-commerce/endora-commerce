import type { EntityManager } from '@mikro-orm/postgresql';
import type { OutboxData } from '@endora-commerce/contracts';
import type { CommandActor } from '../command.js';
import { COMMAND_OUTBOX_DEAD_RETENTION_MS, COMMAND_OUTBOX_DELIVERED_RETENTION_MS } from './constants.js';

/**
 * Where the drain reads and moves `command_outbox` rows
 * (`specs/176-command-hooks-outbox/` FR-032, `contracts/outbox-and-admin-api.md`
 * § Delivery).
 *
 * An interface so the drain's decisions are tested over an in-memory store with
 * a clock the test moves (`drain.test.ts`), and the SQL here over a real
 * Postgres (`backend/test/integration/platform/outbox-drain-concurrency.test.ts`).
 *
 * **Every time is a parameter.** The store never asks the database for `now()`
 * when it decides what is due, leased or old enough to purge, so the drain's
 * clock is the only clock and a test can move it.
 *
 * **Every update after a claim is fenced on the claim** — `status = 'in_flight'
 * and attempts = <the claimed attempt>`. A drain whose lease ran out while its
 * handler was still running, and whose row another drain reclaimed, writes
 * nothing over the newer state when it finally returns.
 */

/** A row the drain holds, as its claim returned it. `attempts` already counts this attempt. */
export interface ClaimedOutboxRow {
  readonly id: string;
  readonly sequence: number;
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly organizationId: string | null;
  readonly hookModule: string;
  readonly hookId: string;
  readonly data: OutboxData;
  readonly actorKind: CommandActor['kind'];
  readonly actorAdminUserId: string | null;
  readonly impersonatedCustomerAccountId: string | null;
  readonly actorCustomerAccountId: string | null;
  readonly requestId: string | null;
  readonly createdAt: Date;
  readonly attempts: number;
}

/** What a failed delivery stores: a code-shaped code and the error's class, never its message. */
export interface OutboxFailure {
  readonly code: string;
  readonly errorClass: string | null;
}

export interface OutboxStore {
  /**
   * Whether a pass at `now` has anything to do: a due row, an expired lease or
   * a row old enough to purge. One boolean, asked with no tenant context, so an
   * idle tick enters no scope.
   */
  hasWork(now: Date): Promise<boolean>;
  /** Return every `in_flight` row whose lease ended before `now` to `pending`. */
  reclaimExpiredLeases(now: Date): Promise<number>;
  /**
   * Claim up to `limit` due rows in `sequence` order, `for update skip locked`:
   * `in_flight`, leased until `leaseUntil`, the attempt counted — and committed,
   * so no other drain can see them.
   */
  claim(now: Date, limit: number, leaseUntil: Date): Promise<ClaimedOutboxRow[]>;
  markDelivered(row: ClaimedOutboxRow, now: Date): Promise<void>;
  /** Back to `pending`, due at `availableAt`, with the failure recorded. */
  markRetry(row: ClaimedOutboxRow, availableAt: Date, failure: OutboxFailure): Promise<void>;
  markDead(row: ClaimedOutboxRow, now: Date, failure: OutboxFailure): Promise<void>;
  /** Back to `pending`, due at `availableAt`, **with the attempt given back** (an absent module). */
  release(row: ClaimedOutboxRow, availableAt: Date): Promise<void>;
  /** Delete delivered rows delivered before `deliveredBefore`, and dead rows dead before `deadBefore`. */
  purge(deliveredBefore: Date, deadBefore: Date): Promise<{ delivered: number; dead: number }>;
}

interface Row {
  id: string;
  sequence: string | number;
  action: string;
  object_type: string;
  object_id: string;
  organization_id: string | null;
  hook_module: string;
  hook_id: string;
  data: OutboxData | string | null;
  actor_kind: CommandActor['kind'];
  actor_admin_user_id: string | null;
  impersonated_customer_account_id: string | null;
  actor_customer_account_id: string | null;
  request_id: string | null;
  created_at: Date | string;
  attempts: number;
}

function toClaimed(row: Row): ClaimedOutboxRow {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    organizationId: row.organization_id,
    hookModule: row.hook_module,
    hookId: row.hook_id,
    data: (typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {})) as OutboxData,
    actorKind: row.actor_kind,
    actorAdminUserId: row.actor_admin_user_id,
    impersonatedCustomerAccountId: row.impersonated_customer_account_id,
    actorCustomerAccountId: row.actor_customer_account_id,
    requestId: row.request_id,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    attempts: Number(row.attempts),
  };
}

const FENCE = `"id" = ? and "status" = 'in_flight' and "attempts" = ?`;

/**
 * The Postgres store. `em` yields a fresh EntityManager per call; each
 * statement runs on it (the claim in a transaction of its own), so a drain's
 * writes commit as it makes them and none of them waits on a handler.
 */
export class PostgresOutboxStore implements OutboxStore {
  constructor(
    private readonly em: () => EntityManager,
    private readonly retention: { readonly deliveredMs: number; readonly deadMs: number } = {
      deliveredMs: COMMAND_OUTBOX_DELIVERED_RETENTION_MS,
      deadMs: COMMAND_OUTBOX_DEAD_RETENTION_MS,
    },
  ) {}

  async hasWork(now: Date): Promise<boolean> {
    const deliveredBefore = new Date(now.getTime() - this.retention.deliveredMs);
    const deadBefore = new Date(now.getTime() - this.retention.deadMs);
    const rows = await this.em().execute<Array<{ has_work: boolean }>>(
      `select (
         exists (select 1 from "command_outbox" where "status" = 'pending' and "available_at" <= ?)
         or exists (select 1 from "command_outbox" where "status" = 'in_flight' and "locked_until" < ?)
         or exists (select 1 from "command_outbox" where "status" = 'delivered' and "delivered_at" < ?)
         or exists (select 1 from "command_outbox" where "status" = 'dead' and "dead_at" < ?)
       ) as has_work`,
      [now, now, deliveredBefore, deadBefore],
    );
    return rows[0]?.has_work === true;
  }

  async reclaimExpiredLeases(now: Date): Promise<number> {
    const rows = await this.em().execute<Array<{ id: string }>>(
      `update "command_outbox" set "status" = 'pending', "locked_until" = null
        where "status" = 'in_flight' and "locked_until" < ? returning "id"`,
      [now],
    );
    return rows.length;
  }

  async claim(now: Date, limit: number, leaseUntil: Date): Promise<ClaimedOutboxRow[]> {
    const rows = await this.em().transactional((em) =>
      em.execute<Row[]>(
        `update "command_outbox" as o
            set "status" = 'in_flight', "locked_until" = ?, "attempts" = o."attempts" + 1
           from (
             select "id" from "command_outbox"
              where "status" = 'pending' and "available_at" <= ?
              order by "sequence"
              for update skip locked
              limit ?
           ) as due
          where o."id" = due."id"
        returning o."id", o."sequence", o."action", o."object_type", o."object_id", o."organization_id",
                  o."hook_module", o."hook_id", o."data", o."actor_kind", o."actor_admin_user_id",
                  o."impersonated_customer_account_id", o."actor_customer_account_id", o."request_id",
                  o."created_at", o."attempts"`,
        [leaseUntil, now, limit],
      ),
    );
    return rows.map(toClaimed).sort((a, b) => a.sequence - b.sequence);
  }

  async markDelivered(row: ClaimedOutboxRow, now: Date): Promise<void> {
    await this.em().execute(
      `update "command_outbox" set "status" = 'delivered', "delivered_at" = ?, "locked_until" = null where ${FENCE}`,
      [now, row.id, row.attempts],
    );
  }

  async markRetry(row: ClaimedOutboxRow, availableAt: Date, failure: OutboxFailure): Promise<void> {
    await this.em().execute(
      `update "command_outbox" set "status" = 'pending', "available_at" = ?, "locked_until" = null,
              "last_error_code" = ?, "last_error_class" = ? where ${FENCE}`,
      [availableAt, failure.code, failure.errorClass, row.id, row.attempts],
    );
  }

  async markDead(row: ClaimedOutboxRow, now: Date, failure: OutboxFailure): Promise<void> {
    await this.em().execute(
      `update "command_outbox" set "status" = 'dead', "dead_at" = ?, "locked_until" = null,
              "last_error_code" = ?, "last_error_class" = ? where ${FENCE}`,
      [now, failure.code, failure.errorClass, row.id, row.attempts],
    );
  }

  async release(row: ClaimedOutboxRow, availableAt: Date): Promise<void> {
    await this.em().execute(
      `update "command_outbox" set "status" = 'pending', "available_at" = ?, "locked_until" = null,
              "attempts" = greatest("attempts" - 1, 0) where ${FENCE}`,
      [availableAt, row.id, row.attempts],
    );
  }

  async purge(deliveredBefore: Date, deadBefore: Date): Promise<{ delivered: number; dead: number }> {
    const delivered = await this.em().execute<Array<{ id: string }>>(
      `delete from "command_outbox" where "status" = 'delivered' and "delivered_at" < ? returning "id"`,
      [deliveredBefore],
    );
    const dead = await this.em().execute<Array<{ id: string }>>(
      `delete from "command_outbox" where "status" = 'dead' and "dead_at" < ? returning "id"`,
      [deadBefore],
    );
    return { delivered: delivered.length, dead: dead.length };
  }
}
