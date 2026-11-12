/**
 * Throw from an `afterCommit` handler to dead-letter its row at once, without
 * a retry (`specs/176-command-hooks-outbox/` FR-035,
 * `contracts/command-hooks-api.md` §2).
 *
 * For a failure no retry can fix — the remote side answered that the record is
 * invalid, or the handler's own precondition can never hold again. Anything
 * else a handler throws is retried with backoff.
 *
 * `code` is what the row stores as `last_error_code`, so it must be
 * code-shaped (`acme-erp-rejected`, `ERP_VALIDATION`): letters, digits and
 * `_ . : -`, at most 64 characters. One that is not is stored as
 * `permanent-failure`. **`message` is never stored** — it is for the logs a
 * handler writes itself; the outbox is platform-global and holds no free text.
 */
export class PermanentOutboxFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentOutboxFailure';
  }
}
