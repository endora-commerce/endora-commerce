import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { ReturnCase } from '../entities/return-case.entity.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import {
  RETURN_STATUS_AUTHORIZED,
  RETURN_STATUS_REJECTED,
} from '../domain/return-status-graph.js';

/** Re-exported where it was declared before feature 180 moved it beside the transition. */
export type { ReturnNotifier } from './return-transition-service.js';

export interface ReturnAuthorizationServiceDeps {
  emFactory: () => EntityManager;
  transitions: ReturnTransitionService;
}

/**
 * ReturnAuthorizationService — feature 046 (US2).
 *
 * Verification outcome handlers: `authorize` advances the case to the authorized
 * status; `reject` records a mandatory reason and moves the case to the rejected
 * terminal.
 *
 * What entering either status *does* — the RMA number, `authorizedAt`, the
 * authorizer and the dedicated e-mail — is the transition's since
 * `specs/180-off-platform-complaints/` (research R-7.3): it used to live here,
 * which is why the generic and the bulk transition skipped it (F3). Both methods
 * keep their signatures and delegate.
 */
export class ReturnAuthorizationService {
  constructor(private readonly deps: ReturnAuthorizationServiceDeps) {}

  async authorize(id: string, adminUserId: string): Promise<{ rmaNumber: string; statusCode: string }> {
    const rc = await this.deps.transitions.apply(id, RETURN_STATUS_AUTHORIZED, { kind: 'admin', adminUserId });
    return { rmaNumber: rc.rmaNumber!, statusCode: rc.statusCode };
  }

  async reject(id: string, adminUserId: string, reason: string): Promise<ReturnCase> {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A rejection reason is required.', {
        code: 'reason_required',
      });
    }
    return this.deps.transitions.apply(
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
  }
}
