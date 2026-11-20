import type { RelatedPayerLink } from '../entities/related-payer-link.entity.js';

/**
 * What the audit entry of a link Command may say (`specs/conventions/audit-state.md`,
 * D-288; `specs/182-related-payers/contracts/commands-audit.md`).
 *
 * A `RelatedPayerLink` is `@OrgScoped` on the buyer, so its states carry ids, codes,
 * dates and booleans — never a name, tax ID, address, e-mail or comment, and never the
 * buyer anchor `organizationId` of the link itself. The payer's id is an id of another
 * record and may be recorded.
 */

/** Who acted, as the audit log tells them apart (FR-100, SC-006). */
export type LinkActorKind = 'operator' | 'automation' | 'buyer' | 'payer';

/**
 * Every top-level key a link Command's audit state may hold. Anything else is a value
 * until somebody classifies it on purpose — `link-commands.audit.test.ts` holds every
 * recorded state to this list.
 */
export const RELATED_PAYERS_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // Codes.
  'state',
  'addressScope',
  'commercialTerms',
  'origin',
  'actorKind',
  'revokedByKind',
  // An automation source label — a code (`^[a-z0-9_.-]{1,64}$`), never prose.
  'source',
  // Ids of other records.
  'payerOrganizationId',
  'billingAddressId',
  'originRequestId',
  // Dates and booleans.
  'validFrom',
  'validTo',
  'notifyPayerOnOrders',
  // Field names and the lock.
  'changedFields',
  'version',
  // Requests (contracts/commands-audit.md): codes, ids, booleans and one length — never the
  // tax ID, the contact e-mail, the comment, the rejection reason or a name (FR-100).
  'direction',
  'routing',
  'operatorReason',
  'approvalMode',
  'unregisteredMode',
  'counterpartyMatched',
  'counterpartyOrganizationId',
  'step',
  'linkId',
  'rejectionReasonLength',
]);

/** The fields a link update may change, in the order `changedFields` sorts them. */
export const LINK_EDITABLE_FIELDS = [
  'addressScope',
  'billingAddressId',
  'commercialTerms',
  'notifyPayerOnOrders',
  'validFrom',
  'validTo',
] as const;
export type LinkEditableField = (typeof LINK_EDITABLE_FIELDS)[number];

/** The editable fields' values — all codes, ids, dates or booleans (list 1). */
export function linkTermsState(link: RelatedPayerLink): Record<LinkEditableField, unknown> {
  return {
    addressScope: link.addressScope,
    billingAddressId: link.billingAddressId,
    commercialTerms: link.commercialTerms,
    notifyPayerOnOrders: link.notifyPayerOnOrders,
    // RP-15 — instants, recorded as ISO strings so a before/after comparison is by value.
    validFrom: link.validFrom ? link.validFrom.toISOString() : null,
    validTo: link.validTo ? link.validTo.toISOString() : null,
  };
}

/** The state `related_payers.link.create` records. */
export function linkCreatedState(link: RelatedPayerLink, actorKind: LinkActorKind): Record<string, unknown> {
  return {
    state: link.state,
    ...linkTermsState(link),
    origin: link.origin,
    ...(link.originSource ? { source: link.originSource } : {}),
    actorKind,
    payerOrganizationId: link.payerOrganizationId,
    ...(link.originRequestId ? { originRequestId: link.originRequestId } : {}),
  };
}
