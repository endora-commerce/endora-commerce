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
 * `actorAdminUserId` / `impersonatedCustomerAccountId` /
 * `actorCustomerAccountId` columns.
 */
export interface CommandActor {
  /** The Admin User who acted. `null` for a system/worker actor (or a plain customer action). */
  readonly actorAdminUserId: string | null;
  /** The impersonated Customer Account, when an admin acted on a customer's behalf. */
  readonly impersonatedCustomerAccountId: string | null;
  /**
   * The Customer Account that acted **for itself** (`specs/170-organization-roles/`,
   * research R-21). Without it a storefront administrator's change recorded no
   * actor at all. `null` for an operator, a system or API-key actor, and under
   * impersonation — where the administrator acted, and the two fields above say so.
   *
   * Always set on an actor the bus resolved (`actorFromContext`). Optional on
   * the type only so that an actor built by hand — a module's no-bus fallback,
   * a test fake — written before this field still compiles; read it as
   * `actor.actorCustomerAccountId ?? null`.
   */
  readonly actorCustomerAccountId?: string | null;
  /** The originating tenant-actor kind, for callers that need to branch on it. */
  readonly kind: 'admin' | 'customer' | 'system' | 'api_key';
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
  /**
   * Run a **child** Command inside this one (`specs/170-organization-roles/`,
   * research R-22).
   *
   * The child's `capture` and `run` execute on this Command's transactional
   * `em` and actor; the bus records the child's own single audit entry inside
   * the same transaction (none when it answers `skipAudit`) and buffers its
   * event in the same `EventBus.run` scope, so it dispatches once, on the
   * parent's commit. Parent and children commit or roll back together: a
   * throwing child — rethrown by this call — rolls back the parent and every
   * sibling's entry, unless the parent catches it and continues.
   *
   * Every Command still records exactly one entry of its own (Principle XIII):
   * this is how a composite write — a role deletion and the reassignment of
   * each member — is atomic *and* audited per member without a second
   * `CommandBus.run`, which would open a second transaction.
   *
   * **Always present on a context the {@link CommandBus} built.** Optional on
   * the type only so that a context built by hand before this member existed —
   * a module's no-bus fallback, a test fake — still compiles. A Command that
   * runs children therefore requires the bus, and when `run` is absent it
   * **throws**; it never skips the children (`ctx.run?.(…)` would be a silent
   * partial write).
   */
  readonly run?: <TChild>(child: Command<TChild>) => Promise<TChild>;
}

/** What a Command's `run` returns: the caller-facing result plus the audit state. */
export interface CommandOutcome<TResult> {
  /** Value returned to the caller of `CommandBus.run`. */
  readonly result: TResult;
  /**
   * Snapshot recorded as the audit `stateBefore`. Overrides `capture()` when both
   * are present — lets a command that computes before+after in one pass supply both.
   */
  readonly before?: AuditState;
  /** Snapshot recorded as the audit `stateAfter`. Omit/`null` when there is nothing to record. */
  readonly after?: AuditState;
  /**
   * When true, the bus commits the transaction and returns the result but writes
   * NO audit entry — for a command whose `run` decided not to mutate (a no-op
   * business outcome). Keeps "no write ⇒ no audit row" honest.
   */
  readonly skipAudit?: boolean;
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
