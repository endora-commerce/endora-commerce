import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { RecordAlternativeConsentRequest } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnCase } from '../entities/return-case.entity.js';
import { consentDateRefusal } from '../domain/consumer-withdrawal.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';

export interface ReturnConsentServiceDeps {
  commandBus: Pick<CommandBus, 'run'>;
  /** The configured status graph: a terminal status closes the consent (PO ruling on #945). */
  graphService: Pick<ReturnStatusGraphService, 'loadGraph'>;
  /** Injected for deterministic tests; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * ReturnConsentService — issue #905, design D1.
 *
 * A consumer withdrawal is reimbursed by the same means of payment unless the
 * consumer expressly agrees otherwise (Directive 2011/83 art. 13(1)). The
 * consent normally reaches the shop by e-mail or telephone after the
 * statement, so an operator records it: the resolution agreed to (`credit`,
 * `replacement` or `repair`), when it was given, and an evidence note. The
 * settlement then accepts that one resolution and no other.
 *
 * Both writes are Commands (Principle XIII): `return_case.alternative_consent.record`
 * and `.revoke`, one audit row each, with the operator as the actor. The audit
 * row carries the resolution, the moment and the source — not the evidence
 * note, which is free text an operator may fill with the customer's personal
 * data and which stays on the case.
 *
 * The consent is frozen once the case is settled: it is what the settlement
 * was judged by. It is closed, too, once the case reaches a terminal status of
 * the configured graph (rejected, cancelled, or one an operator added): such a
 * case can never be settled, so a consent there would be evidence for nothing
 * (PO ruling on #945).
 */
export class ReturnConsentService {
  constructor(private readonly deps: ReturnConsentServiceDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async record(id: string, input: RecordAlternativeConsentRequest): Promise<void> {
    assertCaseId(id);
    await this.deps.commandBus.run<void>({
      action: 'return_case.alternative_consent.record',
      objectType: 'return_case',
      objectId: id,
      run: async ({ em, actor }) => {
        const rc = await this.#loadOpen(em, id);
        if (rc.consumerWithdrawal !== true) {
          throw new HttpError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            'Consent to another resolution is recorded only on a consumer withdrawal.',
            { code: 'not_consumer_withdrawal' },
          );
        }
        const givenAt = new Date(input.consentGivenAt);
        const refusal = consentDateRefusal(givenAt, rc.submittedAt, this.now());
        if (refusal) {
          throw new HttpError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            refusal === 'consent_in_future'
              ? 'The consent cannot be dated in the future.'
              : 'The consent cannot be dated before the return was filed.',
            { code: refusal },
          );
        }
        const before = consentSnapshot(rc);
        rc.alternativeConsentResolution = input.resolution;
        rc.alternativeConsentAt = givenAt;
        rc.alternativeConsentNote = input.note;
        rc.alternativeConsentByAdminUserId = actor.actorAdminUserId;
        rc.alternativeConsentSource = 'operator_recorded';
        await em.flush();
        return { result: undefined, before, after: consentSnapshot(rc) };
      },
    });
  }

  /** The case, refused when it is settled (`consent_frozen`) or closed (`case_closed`). */
  async #loadOpen(em: EntityManager, id: string): Promise<ReturnCase> {
    const rc = await loadCase(em, id);
    if (rc.resolutionType) {
      throw new HttpError(
        409,
        ERROR_CODES.INVALID_TRANSITION,
        'The case is settled: the consent it was settled under can no longer change.',
        { code: 'consent_frozen' },
      );
    }
    if ((await this.deps.graphService.loadGraph()).isTerminal(rc.statusCode)) {
      throw new HttpError(409, ERROR_CODES.INVALID_TRANSITION, 'This case is closed, so its consent can no longer change.', {
        code: 'case_closed',
      });
    }
    return rc;
  }

  /** Revoke the consent on record. Revoking none writes nothing and records no audit row. */
  async revoke(id: string): Promise<void> {
    assertCaseId(id);
    await this.deps.commandBus.run<void>({
      action: 'return_case.alternative_consent.revoke',
      objectType: 'return_case',
      objectId: id,
      run: async ({ em }) => {
        const rc = await this.#loadOpen(em, id);
        if (!rc.alternativeConsentResolution) return { result: undefined, skipAudit: true };
        const before = consentSnapshot(rc);
        rc.alternativeConsentResolution = null;
        rc.alternativeConsentAt = null;
        rc.alternativeConsentNote = null;
        rc.alternativeConsentByAdminUserId = null;
        rc.alternativeConsentSource = null;
        await em.flush();
        return { result: undefined, before, after: consentSnapshot(rc) };
      },
    });
  }
}

async function loadCase(em: EntityManager, id: string): Promise<ReturnCase> {
  const rc = await em.findOne(ReturnCase, { id });
  if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
  return rc;
}

function assertCaseId(id: string): void {
  // A malformed id names no case; PostgreSQL would answer it with a 500 (issue #753).
  if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
}


/** What the audit row records of the consent: never the evidence note. */
function consentSnapshot(rc: ReturnCase): Record<string, unknown> {
  return {
    resolution: rc.alternativeConsentResolution ?? null,
    at: rc.alternativeConsentAt ? rc.alternativeConsentAt.toISOString() : null,
    source: rc.alternativeConsentSource ?? null,
  };
}
