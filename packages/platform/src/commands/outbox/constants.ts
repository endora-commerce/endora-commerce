/**
 * The command outbox's clock, limits and retention
 * (`specs/176-command-hooks-outbox/` research R-17, `contracts/outbox-and-admin-api.md`).
 *
 * Constants, not settings: nobody has asked to tune them (Principle IV), and a
 * delivery guarantee that an operator could weaken from a screen is a weaker
 * guarantee. Changing one is a platform release, with a changeset that says so.
 */

/** The BullMQ queue the drain consumes. No `:` — BullMQ refuses one in a queue name. */
export const COMMAND_OUTBOX_DRAIN_QUEUE = 'command_outbox.drain';
/** The module-wide job scheduler that ticks the drain. */
export const COMMAND_OUTBOX_DRAIN_SCHEDULER_ID = 'command_outbox.drain';
/** Every ten seconds: the delivery latency when no wake-up reached Redis. */
export const COMMAND_OUTBOX_DRAIN_EVERY_MS = 10_000;
/** The deduplication id of the wake-up a commit that wrote rows enqueues. */
export const COMMAND_OUTBOX_WAKE_JOB_ID = 'command_outbox.drain.wake';

/** Rows claimed per batch. */
export const COMMAND_OUTBOX_BATCH_SIZE = 50;
/**
 * Batches per tick. A tick that keeps finding full batches stops here and the
 * next tick continues, so one tick never runs unbounded under a steady stream.
 */
export const COMMAND_OUTBOX_MAX_BATCHES_PER_TICK = 20;
/** How long a claim holds a row before another drain may reclaim it. */
export const COMMAND_OUTBOX_LEASE_MS = 5 * 60_000;
/** Attempts before a row is dead-lettered. */
export const COMMAND_OUTBOX_MAX_ATTEMPTS = 10;
/** The first retry's wait; each further one doubles it… */
export const COMMAND_OUTBOX_BACKOFF_BASE_MS = 30_000;
/** …up to this. */
export const COMMAND_OUTBOX_BACKOFF_MAX_MS = 60 * 60_000;
/** When the handler's module is not present: look again this much later, attempt restored. */
export const COMMAND_OUTBOX_ABSENT_MODULE_DELAY_MS = 30_000;
/** Delivered rows are purged once this old. */
export const COMMAND_OUTBOX_DELIVERED_RETENTION_MS = 7 * 24 * 60 * 60_000;
/** Dead rows are kept this long for an operator to retry, then purged. */
export const COMMAND_OUTBOX_DEAD_RETENTION_MS = 90 * 24 * 60 * 60_000;

/** The `last_error_code` of a row whose module is present and no longer registers its handler. */
export const COMMAND_OUTBOX_HOOK_UNREGISTERED = 'hook-unregistered';
/** The `last_error_code` of a failure that carried no code-shaped code of its own. */
export const COMMAND_OUTBOX_HANDLER_FAILED = 'handler-failed';
