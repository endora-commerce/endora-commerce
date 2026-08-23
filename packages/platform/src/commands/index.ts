/**
 * Command Bus core layer (feature 054 — Uniform Write Auditing & Undo,
 * Constitution Principle XIII). Peer of `events/`, `tenancy/`, `http/`,
 * `kernel/`; becomes the `./commands` subpath of `@endora-commerce/platform`
 * (feature 080, D-160.1/D-160.7), and that subpath is the boundary a future
 * `@endora-commerce/commands` would take (D-160.6).
 *
 * **This barrel is a package boundary in waiting, so it carries this
 * directory's symbols and nothing else.** Three of the shapes a consumer needs
 * to use it come from elsewhere and stay there: `AuditPort`
 * (`@endora-commerce/platform/kernel`) is `recordAuditFromContext`'s first
 * argument, `TenantContext` (`…/tenancy`) is `actorFromContext`'s, and
 * `EventBase` (`…/events`) is what a {@link CommandEvent} carries. Re-exporting
 * one of them here to save a consumer an import line spends the split option
 * for a convenience.
 *
 * **What is on it is decided by `contracts/host-package.md` §1.3, not by what
 * happens to be here** (T042f, applying T042c's rule to this directory for the
 * first time). §1.3 rows 5, 12 and 33 are all **P**, and the 177 module reaches
 * into this directory name **ten** distinct symbols between them; the barrel
 * carried 27.
 *
 * So the rule is the kernel barrel's: a symbol is here when §1.3 records a
 * module taking it from a **P** file, or when it is the argument, return or
 * thrown shape of one of those. Two groups are deliberately absent and a future
 * author will look for them:
 *
 *  - **the bus's construction** — `CommandBusOptions` and
 *    `CommandRequestMeta`. A composition root builds the one {@link CommandBus}
 *    and supplies its request-metadata resolver; a module resolves
 *    `commandBus` from the container and calls `run`. The class travels because
 *    75 module files name it in a constructor signature or a cradle field.
 *  - **the command registry**, which this barrel exported until T042f pruned it
 *    and !897 deleted outright. D-163 settled it: the registry was read by
 *    **nothing** in `src/`, and both consumers its own header named had been
 *    wrong since it was created — `check:command-coverage` decides coverage
 *    syntactically and never imported it, and the undo affordance reads
 *    `op.reversible`, a column. The question it appeared to raise for a
 *    packaged module — *a central list of every module's actions* — is real and
 *    lives four tables away, in `audit_logs/action-catalog.ts`, whose
 *    `RECENT_ACTIVITY_ACTIONS` silently drops a package's row from the
 *    dashboard. Publishing a list with no reader would have answered nothing.
 */
export {
  type Command,
  /** {@link Command.run}'s parameter; its `actor` is a {@link CommandActor}. */
  type CommandContext,
  /** {@link Command.run}'s return shape. */
  type CommandOutcome,
  /** {@link Command.event}'s return shape, and the audit snapshot type. */
  type CommandEvent,
  type AuditState,
  /** What {@link resolveCommandActor} returns and what a Command's `ctx.actor` is. */
  type CommandActor,
} from './command.js';
/** Row 5's "+5" — both derive the actor server-side, never from a request body. */
export { resolveCommandActor, actorFromContext } from './actor.js';
/** Row 5's second-largest symbol — 51 reaches — plus its own input shape. */
export { recordAuditFromContext, type AuditFromContextInput } from './audit-from-context.js';
/** Rows 5 and 33 — the class 75 module files name. */
export { CommandBus } from './command-bus.js';
/**
 * The stored-revert undo (US2). `applyUndo`'s argument and return shapes travel
 * with it; `UndoStatus`, `RevertConflict` and `RevertConflictReason` are members
 * of {@link UndoResult} that its one consumer reads structurally.
 */
export {
  applyUndo,
  type RevertRecord,
  type RevertHandlers,
  type UndoResult,
} from './reversible.js';
