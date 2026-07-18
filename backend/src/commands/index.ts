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
  CommandBus,
  type CommandBusOptions,
  type CommandRequestMeta,
} from './command-bus.js';
export {
  COMMAND_REGISTRY,
  type CommandRegistryEntry,
  type KnownCommandAction,
  isRegisteredCommand,
  isReversibleCommand,
  registeredCommandActions,
} from './command-registry.js';
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
