import { ApiError, defineEnumLabels } from '@endora-commerce/admin-kit/lib';
import type {
  PayerCommercialTerms,
  RelatedPayerAddressScopeKind,
  RelatedPayerLinkOrigin,
  RelatedPayerLinkState,
  RelatedPayerOperatorReason,
  RelatedPayerRequestState,
} from '@endora-commerce/contracts';

/**
 * The module's enum labels (`specs/conventions/module-i18n.md`): each value names a key in
 * this module's own bundle, resolved with `useTranslation('related_payers')`.
 */
export const relatedPayerLinkStateLabels = defineEnumLabels<RelatedPayerLinkState>({
  active: 'enums.linkState.active',
  inactive: 'enums.linkState.inactive',
  revoked: 'enums.linkState.revoked',
});

export const payerCommercialTermsLabels = defineEnumLabels<PayerCommercialTerms>({
  buyer: 'enums.commercialTerms.buyer',
  payer: 'enums.commercialTerms.payer',
});

export const relatedPayerAddressScopeLabels = defineEnumLabels<RelatedPayerAddressScopeKind>({
  all: 'enums.addressScope.all',
  one: 'enums.addressScope.one',
});

export const relatedPayerLinkOriginLabels = defineEnumLabels<RelatedPayerLinkOrigin>({
  operator: 'enums.origin.operator',
  automation: 'enums.origin.automation',
  request: 'enums.origin.request',
  invitation: 'enums.origin.invitation',
});

/** FR-023 — why a request waits for the operator. */
export const relatedPayerOperatorReasonLabels = defineEnumLabels<RelatedPayerOperatorReason>({
  approval_mode_admin: 'enums.operatorReason.approval_mode_admin',
  second_step: 'enums.operatorReason.second_step',
  no_eligible_approver: 'enums.operatorReason.no_eligible_approver',
  no_account: 'enums.operatorReason.no_account',
  ambiguous_tax_id: 'enums.operatorReason.ambiguous_tax_id',
  ineligible: 'enums.operatorReason.ineligible',
});

export const relatedPayerRequestStateLabels = defineEnumLabels<RelatedPayerRequestState>({
  pending: 'enums.requestState.pending',
  active: 'enums.requestState.active',
  rejected: 'enums.requestState.rejected',
  expired: 'enums.requestState.expired',
  withdrawn: 'enums.requestState.withdrawn',
});

/** The server's sentence for a failed call — already in the reader's language — or `fallback`. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.envelope.error.message : fallback;
}
