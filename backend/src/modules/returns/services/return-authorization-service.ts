import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { ReturnCase } from '../entities/return-case.entity.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import type { RmaNumberGenerator } from './rma-number-generator.js';
import type { ReturnEmailResult } from './return-email-notifier.js';
import {
  RETURN_STATUS_AUTHORIZED,
  RETURN_STATUS_REJECTED,
} from '../domain/return-status-graph.js';

/**
 * Best-effort customer notifications on authorize/reject (FR-017).
 *
 * Each answers whether the message went out and, when it did not, why (issue
 * #78). `Promise<void>` said nothing, and this service is the caller that could
 * not tell a delivered notification from a deactivated template.
 */
export interface ReturnNotifier {
  authorized(rc: ReturnCase): Promise<ReturnEmailResult>;
  rejected(rc: ReturnCase): Promise<ReturnEmailResult>;
}

export interface ReturnAuthorizationServiceDeps {
  emFactory: () => EntityManager;
  transitions: ReturnTransitionService;
  rmaGenerator: RmaNumberGenerator;
  notifier?: ReturnNotifier;
}

/**
 * ReturnAuthorizationService — feature 046 (US2).
 *
 * Verification outcome handlers: `authorize` assigns a unique RMA number and
 * advances the case to the authorized status; `reject` records a mandatory
 * reason and moves the case to the rejected terminal. Both notify the customer
 * best-effort.
 */
export class ReturnAuthorizationService {
  constructor(private readonly deps: ReturnAuthorizationServiceDeps) {}

  async authorize(id: string, adminUserId: string): Promise<{ rmaNumber: string; statusCode: string }> {
    const rc = await this.deps.transitions.apply(
      id,
      RETURN_STATUS_AUTHORIZED,
      { kind: 'admin', adminUserId },
      {
        mutate: async (target, em) => {
          if (!target.rmaNumber) {
            target.rmaNumber = await this.deps.rmaGenerator.generate(em, target.salesChannelId);
          }
          target.authorizedAt = new Date();
        },
      },
    );
    await this.notifySafely(rc, 'return_authorized', () => this.deps.notifier?.authorized(rc));
    return { rmaNumber: rc.rmaNumber!, statusCode: rc.statusCode };
  }

  async reject(id: string, adminUserId: string, reason: string): Promise<ReturnCase> {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A rejection reason is required.', {
        code: 'reason_required',
      });
    }
    const rc = await this.deps.transitions.apply(
      id,
      RETURN_STATUS_REJECTED,
      { kind: 'admin', adminUserId },
      {
        reason: trimmed,
        mutate: (target) => {
          target.rejectionReason = trimmed;
        },
      },
    );
    await this.notifySafely(rc, 'return_rejected', () => this.deps.notifier?.rejected(rc));
    return rc;
  }

  /**
   * The outer net for a notification that must not undo the transition it
   * announces.
   *
   * The notifier itself now names every non-sent path in its result and writes
   * it to the log (issue #78), so what reaches here is the residue: a throw the
   * notifier deliberately let travel. That includes a `ModuleDisabledError`,
   * which this `catch` still absorbs — re-throwing it would answer 503 to an
   * authorize that has already committed, and the honest repair is an outbox
   * the transition hands the message to, not a rethrow here. What it no longer
   * does is absorb it in silence.
   */
  private async notifySafely(
    rc: ReturnCase,
    kind: string,
    fn: () => Promise<ReturnEmailResult> | undefined,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      // Notifications are best-effort; never block the workflow transition.
      console.warn('[returns] the return e-mail was not sent', {
        returnCaseId: rc.id,
        kind,
        reason: 'failed',
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
