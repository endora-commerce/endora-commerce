import type { OrganizationStatus, RelatedPayerAddressScopeKind, RelatedPayerLinkState } from '@endora-commerce/contracts';

/**
 * Whether a payer link may be used for a new order (FR-012, FR-002). A pure rule:
 * the caller reads the inputs — presence, the channel setting, the payer's record and
 * its live billing addresses — and this answers. The order of the checks is FR-012's,
 * so the first failing condition is the reason given.
 */
export interface LinkUsabilityInput {
  /** The module is effectively present (Principle XVII). */
  readonly modulePresent: boolean;
  /** `related_payers.enabled` on the order's sales channel. */
  readonly channelEnabled: boolean;
  /** The instant the usability is judged at (RP-15: no time zone involved). */
  readonly now: Date;
  readonly link: {
    readonly state: RelatedPayerLinkState;
    readonly validFrom: Date | null;
    readonly validTo: Date | null;
    readonly addressScope: RelatedPayerAddressScopeKind;
    readonly billingAddressId: string | null;
  };
  /** The payer Organization, or `null` when it no longer exists. */
  readonly payer: { readonly status: OrganizationStatus; readonly isPersonal: boolean; readonly deleted: boolean } | null;
  /** The payer's live billing addresses. */
  readonly payerBillingAddressIds: readonly string[];
}

export type LinkUnusableReason =
  | 'module_absent'
  | 'capability_disabled'
  | 'link_inactive'
  | 'link_revoked'
  | 'outside_window'
  | 'payer_missing'
  | 'payer_not_active'
  | 'payer_personal'
  | 'no_billing_address';

export type LinkUsability =
  | { readonly usable: true; readonly billingAddressIds: readonly string[] }
  | { readonly usable: false; readonly reason: LinkUnusableReason };

export function evaluateLinkUsability(input: LinkUsabilityInput): LinkUsability {
  const refuse = (reason: LinkUnusableReason): LinkUsability => ({ usable: false, reason });
  if (!input.modulePresent) return refuse('module_absent');
  if (!input.channelEnabled) return refuse('capability_disabled');
  const { link } = input;
  if (link.state === 'revoked') return refuse('link_revoked');
  if (link.state !== 'active') return refuse('link_inactive');
  // Two instants, inclusive at both ends (RP-15).
  const now = input.now.getTime();
  // `!= null`: an ORM-hydrated empty column may arrive as `undefined` as well as `null`.
  if (link.validFrom != null && now < link.validFrom.getTime()) return refuse('outside_window');
  if (link.validTo != null && now > link.validTo.getTime()) return refuse('outside_window');
  if (input.payer === null || input.payer.deleted) return refuse('payer_missing');
  if (input.payer.status !== 'active') return refuse('payer_not_active');
  if (input.payer.isPersonal) return refuse('payer_personal');
  const allowed =
    link.addressScope === 'one'
      ? input.payerBillingAddressIds.filter((id) => id === link.billingAddressId)
      : [...input.payerBillingAddressIds];
  if (allowed.length === 0) return refuse('no_billing_address');
  return { usable: true, billingAddressIds: allowed };
}
