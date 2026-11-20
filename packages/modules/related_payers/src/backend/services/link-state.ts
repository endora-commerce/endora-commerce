import { ERROR_CODES, type RelatedPayerLinkState } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The payer link's state machine (FR-013): `active ⇄ inactive`, either `→ revoked`,
 * and `revoked` terminal — a revoked pair is linked again by a **new** link.
 */
export function assertStateChange(from: RelatedPayerLinkState, to: RelatedPayerLinkState): void {
  const allowed =
    from !== 'revoked' && from !== to && (to === 'revoked' || (from === 'active' ? to === 'inactive' : to === 'active'));
  if (!allowed) {
    throw new HttpError(409, ERROR_CODES.INVALID_TRANSITION, `A payer link cannot move from ${from} to ${to}.`, {
      from,
      to,
    });
  }
}

/** FR-010 — two different company Organizations. */
export function assertLinkablePair(
  buyer: { readonly id: string; readonly isPersonal: boolean },
  payer: { readonly id: string; readonly isPersonal: boolean },
): void {
  if (buyer.id === payer.id || buyer.isPersonal || payer.isPersonal) {
    throw new HttpError(
      422,
      ERROR_CODES.RELATED_PAYER_INVALID_PAIR,
      'A payer link connects two different company organizations.',
    );
  }
}

/** FR-010 — at most one non-revoked link per ordered pair. */
export function assertNoLiveLinkForPair(existing: ReadonlyArray<{ readonly state: RelatedPayerLinkState }>): void {
  if (existing.some((link) => link.state !== 'revoked')) {
    throw new HttpError(422, ERROR_CODES.RELATED_PAYER_LINK_EXISTS, 'This organization is already linked as a payer.');
  }
}
