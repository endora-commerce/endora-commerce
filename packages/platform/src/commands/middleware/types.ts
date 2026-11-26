import type { CommandMiddlewarePhase } from '@endora-commerce/contracts';
import type { PlatformLogger } from '../../kernel/logging.js';
import type { CommandActor } from '../command.js';

/**
 * The handler shapes of command middleware (`specs/189-command-middleware/`
 * D-296.1 – D-296.3, `contracts/command-middleware-api.md` §2, §3).
 *
 * Two phases and no others. `admit` runs for every matching Command before it
 * does anything — the root before its transaction opens, each child at entry —
 * and either returns or refuses with a {@link CommandRefusedError}. `observe`
 * runs after a run committed, rolled back or was refused, detached from the
 * caller, and cannot change what happened.
 *
 * Every object handed to a handler is frozen and carries `audit-state.md`
 * list 1 only: ids, codes, booleans, counts and field names. Neither phase
 * receives a Command's data, its result or an entity manager (D-296.2).
 */

/** What `admit` sees, and what `observe` sees of the root (FR-011). */
export interface CommandAdmissionMeta {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly actor: CommandActor;
  /** The ambient context's organisation when its mode is `single-org`; otherwise null. */
  readonly organizationId: string | null;
  readonly requestMeta: {
    readonly requestId: string | null;
    /** Absent for an observer of origin `package`. */
    readonly ipAddress?: string | null;
    readonly userAgent?: string | null;
  };
  readonly lineage: {
    /** Actions of every Command above this one, root first. Empty for the root. */
    readonly ancestors: readonly string[];
    readonly depth: number;
    /** True when a `beforeCommit` hook started this Command or one above it. */
    readonly viaHook: boolean;
  };
}

/** What every middleware call receives besides its subject. */
export interface CommandMiddlewareCallContext {
  readonly module: { readonly id: string };
  readonly log: PlatformLogger;
}

/**
 * Lets the Command through by returning, refuses it by throwing a
 * `CommandRefusedError` whose code the module declares. Anything else thrown,
 * or a budget overrun, refuses it as `COMMAND_ADMISSION_FAILED` /
 * `COMMAND_ADMISSION_TIMEOUT` (fail closed). `signal` aborts when the budget
 * expires, so a well-behaved handler can stop its own I/O.
 *
 * A child's admission runs inside its parent's open transaction: a handler
 * that does I/O should act on `meta.lineage.depth === 0` only.
 */
export type CommandAdmitHandler = (
  meta: CommandAdmissionMeta,
  ctx: CommandMiddlewareCallContext & { readonly signal: AbortSignal },
) => void | Promise<void>;

/** One Command a run attempted (FR-020). */
export interface CommandRunEntry {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly depth: number;
  readonly viaHook: boolean;
  readonly refused: boolean;
  /** True when the bus recorded an audit entry for this Command (and the run committed). */
  readonly audited: boolean;
  /** Per hook module, the sorted field names it noted (`audit-state.md` list 1). */
  readonly notedFields: Readonly<Record<string, readonly string[]>>;
}

/** What `observe` sees of one run (FR-020). */
export interface CommandRunOutcome {
  readonly root: CommandAdmissionMeta;
  readonly committed: boolean;
  /** The refusal that ended the run, when an `admit` refused it. */
  readonly refusal: { readonly middleware: string; readonly code: string } | null;
  /** `HttpError.code` of what the run threw, `'INTERNAL_ERROR'` otherwise, null on commit. */
  readonly errorCode: string | null;
  readonly durationMs: number;
  /** Every Command the run attempted, in the order it attempted them. */
  readonly commands: readonly CommandRunEntry[];
}

/**
 * Reads a run's outcome after the caller's promise settled. Never awaited by a
 * writer; a throw or an overrun is logged and swallowed. At most once.
 */
export type CommandObserveHandler = (
  outcome: CommandRunOutcome,
  ctx: CommandMiddlewareCallContext,
) => void | Promise<void>;

/** What `ctx.commandMiddleware` takes: the code behind a manifest declaration of the same id and phase. */
export type CommandMiddlewareEntry =
  | { readonly id: string; readonly phase: 'admit'; readonly admit: CommandAdmitHandler }
  | { readonly id: string; readonly phase: 'observe'; readonly observe: CommandObserveHandler };

/** The middleware running on this async path (`currentCommandMiddlewareOrigin`). */
export interface CommandMiddlewareOrigin {
  readonly moduleId: string;
  readonly id: string;
  readonly phase: CommandMiddlewarePhase;
}
