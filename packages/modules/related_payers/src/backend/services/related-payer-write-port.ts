import {
  ERROR_CODES,
  addPayerInputSchema,
  revokePayerInputSchema,
  type AddPayerInput,
  type RelatedPayerWritePort,
  type RevokePayerInput,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { z } from 'zod';
import type { LinkWriteService } from './link-write-service.js';

function parseOr422<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'The payer link input is invalid.',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.message })),
    );
  }
  return parsed.data;
}

/**
 * `relatedPayerWritePort` (FR-030 – FR-032) — how a deployment's automation links and
 * unlinks payers. Registered with `ctx.di.providePort`, so a call while the module is off
 * answers `503 MODULE_DISABLED` and writes nothing.
 *
 * Every call runs in a system scope (the automation is not an operator and acts for no
 * tenant) through the same {@link LinkWriteService} the operator routes use, so the pair
 * rules, the audit entry and the cache drop are the same; the audit state records
 * `actorKind: 'automation'` and the caller's `source` code. Customer-side approval does
 * not apply (FR-031).
 */
export class RelatedPayerWritePortService implements RelatedPayerWritePort {
  constructor(private readonly writes: () => LinkWriteService) {}

  async addPayer(input: AddPayerInput): Promise<{ linkId: string; created: boolean }> {
    // FR-010's own refusal, ahead of the shape check that also refuses it, so the port
    // answers one code for an impossible pair whichever way it is impossible.
    if (input.buyerOrganizationId === input.payerOrganizationId) {
      throw new HttpError(422, ERROR_CODES.RELATED_PAYER_INVALID_PAIR, 'A payer link connects two different company organizations.');
    }
    const parsed = parseOr422(addPayerInputSchema, input);
    return withSystemScope('related_payers: automation adds a payer', async () => {
      const writes = this.writes();
      const live = await writes.findLiveForPair(parsed.buyerOrganizationId, parsed.payerOrganizationId);
      // Idempotent on an active link (FR-030); an inactive one is a live link of the
      // pair, which the create refuses as FR-010 says.
      if (live?.state === 'active') return { linkId: live.id, created: false };
      const { link } = await writes.create({
        buyerOrganizationId: parsed.buyerOrganizationId,
        payerOrganizationId: parsed.payerOrganizationId,
        addressScope: parsed.addressScope ?? { kind: 'all' },
        validFrom: parsed.validFrom ?? null,
        validTo: parsed.validTo ?? null,
        commercialTerms: parsed.commercialTerms ?? 'buyer',
        origin: 'automation',
        source: parsed.source,
        actorKind: 'automation',
      });
      return { linkId: link.id, created: true };
    });
  }

  async revokePayer(input: RevokePayerInput): Promise<{ revoked: boolean }> {
    const parsed = parseOr422(revokePayerInputSchema, input);
    return withSystemScope('related_payers: automation revokes a payer', async () => {
      const writes = this.writes();
      const live = await writes.findLiveForPair(parsed.buyerOrganizationId, parsed.payerOrganizationId);
      if (!live) return { revoked: false };
      await writes.revoke(live.id, { revokedByKind: 'automation', revokedById: null, source: parsed.source });
      return { revoked: true };
    });
  }
}
