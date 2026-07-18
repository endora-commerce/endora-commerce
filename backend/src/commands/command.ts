import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBase } from '../events/bus.js';

/**
 * Command Bus core types (feature 054 — Uniform Write Auditing & Undo,
 * Constitution Principle XIII).
 *
 * A Command is the single, framework-level path for a sensitive write. Running
 * it through the {@link CommandBus} captures the actor + before/after state,
 * writes exactly one audit entry, and emits an optional domain event — all
 * co-transactionally. Services in migrated modules therefore never call the
 * audit writer by hand.
 */

/** A JSON-serializable snapshot persisted into the audit `stateBefore`/`stateAfter` columns. */
export type AuditState = Record<string, unknown> | null;

/**
 * The acting principal for a Command, derived server-side from the ambient
 * TenantContext (never from a request body). Maps directly onto the audit
 * `actorAdminUserId` / `impersonatedCustomerAccountId` columns.
 */
export interface CommandActor {
  /** The Admin User who acted. `null` for a system/worker actor (or a plain customer action). */
  readonly actorAdminUserId: string | null;
  /** The impersonated Customer Account, when an admin acted on a customer's behalf. */
  readonly impersonatedCustomerAccountId: string | null;
  /** The originating tenant-actor kind, for callers that need to branch on it. */
  readonly kind: 'admin' | 'customer' | 'system';
}

/** A domain event a Command emits on commit, in the shape the {@link EventBus} expects. */
export interface CommandEvent<P extends EventBase = EventBase> {
  readonly eventName: string;
  readonly payload: P;
}

/** Execution context handed to a Command: the transactional EM and the resolved actor. */
export interface CommandContext {
  /** The transactional EntityManager. All of the Command's writes MUST run on this em. */
  readonly em: EntityManager;
  readonly actor: CommandActor;
}

/** What a Command's `run` returns: the caller-facing result plus the audit after-state. */
export interface CommandOutcome<TResult> {
  /** Value returned to the caller of `CommandBus.run`. */
  readonly result: TResult;
  /** Snapshot recorded as the audit `stateAfter`. Omit/`null` when there is nothing to record. */
  readonly after?: AuditState;
}

/**
 * A named sensitive write. `capture` reads pre-state (audit `stateBefore`),
 * `run` performs the write and returns the result + after-state, and `event`
 * optionally declares a domain event dispatched once on commit.
 */
export interface Command<TResult = unknown> {
  /** Stable dot-namespaced action, e.g. `product.update`, `credit_limit.adjust`. */
  readonly action: string;
  /** Polymorphic type of the affected object, e.g. `product`. */
  readonly objectType: string;
  /** Id of the affected object (or the operation id for a composite/bulk command). */
  readonly objectId: string;

  /** Optional pre-state capture, on the transactional em. Returns the audit `stateBefore`. */
  capture?(ctx: CommandContext): Promise<AuditState>;

  /** The domain write. MUST use `ctx.em`. Returns the caller result and the audit after-state. */
  run(ctx: CommandContext): Promise<CommandOutcome<TResult>>;

  /** Optional domain event, dispatched exactly once after commit (dropped on rollback). */
  event?(result: TResult): CommandEvent | undefined;
}
