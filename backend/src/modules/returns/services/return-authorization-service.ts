import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { ReturnCase } from '../entities/return-case.entity.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import type { RmaNumberGenerator } from './rma-number-generator.js';
import {
  RETURN_STATUS_AUTHORIZED,
  RETURN_STATUS_REJECTED,
} from '../domain/return-status-graph.js';

/** Best-effort customer notifications on authorize/reject (FR-017). */
export interface ReturnNotifier {
  authorized(rc: ReturnCase): Promise<void>;
  rejected(rc: ReturnCase): Promise<void>;
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
    await this.notifySafely(() => this.deps.notifier?.authorized(rc));
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
    await this.notifySafely(() => this.deps.notifier?.rejected(rc));
    return rc;
  }

  private async notifySafely(fn: () => Promise<void> | undefined): Promise<void> {
    try {
      await fn();
    } catch {
      // Notifications are best-effort; never block the workflow transition.
    }
  }
}
