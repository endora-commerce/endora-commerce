import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { RelatedPayerRequest } from '../entities/related-payer-request.entity.js';
import { requestExpireCommand } from '../commands/request-commands.js';

/** How many requests one pass expires; the next tick continues. */
export const REQUEST_EXPIRY_BATCH_SIZE = 200;

export const REQUEST_EXPIRY_SCOPE_REASON = 'related_payers: expire overdue payer requests';

export interface RequestExpiryResult {
  readonly expiredCount: number;
  /** Decided between the read and its Command — lost to the decision, which is right. */
  readonly skippedCount: number;
}

/**
 * `specs/182-related-payers/` FR-045, FR-102 — a pending request past its `expires_at` becomes
 * `expired` through the `request.expire` Command, one Command per request, as the system actor
 * of the scope the caller entered. The Command locks the row and re-checks it is still pending,
 * so a decision that won the race is skipped, never overwritten.
 */
export class RequestExpiryService {
  constructor(
    private readonly deps: {
      readonly emFactory: () => EntityManager;
      readonly commandBus: CommandBus;
      readonly batchSize?: number;
    },
  ) {}

  /**
   * Whether a pass would find anything — one boolean, read with no tenant context and no
   * escape-hatch record, so an idle tick enters no scope (the RFQ sweep's precedent).
   */
  async hasExpirable(now: Date = new Date()): Promise<boolean> {
    const [row] = await this.deps
      .emFactory()
      .execute<Array<{ due: boolean }>>(
        `select exists (select 1 from "related_payer_requests" where "state" = 'pending' and "expires_at" <= ?) as "due"`,
        [now],
      );
    return row?.due === true;
  }

  /** One pass, entering its own system scope (a caller without one: a test, a CLI). */
  async sweep(now: Date = new Date()): Promise<RequestExpiryResult> {
    return withSystemScope(REQUEST_EXPIRY_SCOPE_REASON, () => this.sweepInScope(now));
  }

  /** One pass, for a caller that already entered the system scope — the scheduled consumer. */
  async sweepInScope(now: Date = new Date()): Promise<RequestExpiryResult> {
    const due = await this.deps.emFactory().find(
      RelatedPayerRequest,
      { state: 'pending', expiresAt: { $lte: now } },
      { orderBy: { expiresAt: 'asc', id: 'asc' }, limit: this.deps.batchSize ?? REQUEST_EXPIRY_BATCH_SIZE },
    );
    let expiredCount = 0;
    let skippedCount = 0;
    for (const request of due) {
      try {
        await this.deps.commandBus.run(requestExpireCommand({ requestId: request.id, expectedVersion: request.version }));
        expiredCount += 1;
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 409) throw error;
        skippedCount += 1;
      }
    }
    return { expiredCount, skippedCount };
  }
}
