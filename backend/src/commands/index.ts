/**
 * Command Bus core layer (feature 054 — Uniform Write Auditing & Undo,
 * Constitution Principle XIII). Peer of `events/`, `tenancy/`, `http/`, `db/`.
 */
export {
  type AuditState,
  type CommandActor,
  type CommandEvent,
  type CommandContext,
  type CommandOutcome,
  type Command,
} from './command.js';
export { resolveCommandActor, actorFromContext } from './actor.js';
export {
  recordAuditFromContext,
  type AuditFromContextInput,
} from './audit-from-context.js';
export {
  CommandBus,
  type CommandBusOptions,
  type CommandRequestMeta,
} from './command-bus.js';
export {
  type RevertRecord,
  type UndoStatus,
  type RevertConflict,
  type RevertConflictReason,
  type UndoResult,
  type RevertHandlers,
  shallowFieldEquals,
  applyUndo,
} from './reversible.js';
