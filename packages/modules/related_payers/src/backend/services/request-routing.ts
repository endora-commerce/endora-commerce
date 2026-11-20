import type {
  RelatedPayerApprovalMode,
  RelatedPayerOperatorReason,
  RelatedPayerRequestRouting,
  RelatedPayerUnregisteredMode,
} from '@endora-commerce/contracts';

export interface RoutingInput {
  /** The approval mode captured on the request when it was created (FR-043) — never re-read. */
  readonly approvalMode: RelatedPayerApprovalMode;
  /** The unregistered-payer mode captured on the request (FR-044). */
  readonly unregisteredMode: RelatedPayerUnregisteredMode;
  /** The Organizations the exact tax ID matched, each judged eligible or not (FR-043). */
  readonly matches: ReadonlyArray<{ readonly organizationId: string; readonly eligible: boolean }>;
  /** Whether the single eligible match has an active user holding the approving permission. */
  readonly hasEligibleApprover: boolean;
}

export interface RoutingDecision {
  readonly routing: RelatedPayerRequestRouting;
  readonly counterpartyOrganizationId: string | null;
  readonly operatorReason: RelatedPayerOperatorReason | null;
}

/**
 * `specs/182-related-payers/` FR-043, FR-044 — where a new request waits. Pure: the caller
 * captured the modes on the request and resolved the match; none of it reaches the sender
 * (FR-041), who sees one `pending` whatever this answers.
 */
export function routeRequest(input: RoutingInput): RoutingDecision {
  const operator = (operatorReason: RelatedPayerOperatorReason, counterpartyOrganizationId: string | null = null) => ({
    routing: 'operator' as const,
    counterpartyOrganizationId,
    operatorReason,
  });
  if (input.matches.length === 0) {
    return input.unregisteredMode === 'invite'
      ? { routing: 'awaiting_registration', counterpartyOrganizationId: null, operatorReason: null }
      : operator('no_account');
  }
  if (input.matches.length > 1) return operator('ambiguous_tax_id');
  const match = input.matches[0]!;
  if (!match.eligible) return operator('ineligible', match.organizationId);
  if (input.approvalMode === 'admin') return operator('approval_mode_admin', match.organizationId);
  if (!input.hasEligibleApprover) return operator('no_eligible_approver', match.organizationId);
  return { routing: 'counterparty', counterpartyOrganizationId: match.organizationId, operatorReason: null };
}
