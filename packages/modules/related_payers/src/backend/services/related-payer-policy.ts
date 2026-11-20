import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AddressReadPort,
  type OrganizationDetailsPort,
  type OrganizationPermissionPort,
  type PayerCommercialTerms,
  type PayerPolicySubject,
  type RelatedPayerAddressScopeKind,
  type RelatedPayerLinkState,
  type RelatedPayerPolicyPort,
  type UsablePayer,
  type AddressRecord,
  organizationCompanyTaxId,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { RelatedPayerLink } from '../entities/related-payer-link.entity.js';
import type { RelatedPayerLinkCache } from './link-cache.js';
import { evaluateLinkUsability, type LinkUnusableReason } from './link-usability.js';

/** What the per-process cache holds for a buyer's link (research R-9): codes, ids, instants. */
export interface CachedLink {
  readonly id: string;
  readonly payerOrganizationId: string;
  readonly state: RelatedPayerLinkState;
  readonly addressScope: RelatedPayerAddressScopeKind;
  readonly billingAddressId: string | null;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly commercialTerms: PayerCommercialTerms;
}

export interface RelatedPayerPolicyDeps {
  readonly emFactory: () => EntityManager;
  readonly now: () => Date;
  readonly cache: RelatedPayerLinkCache<CachedLink>;
  /** `related_payers.enabled` on the channel (FR-002). */
  readonly channelEnabled: (salesChannelId: string) => Promise<boolean>;
  readonly permissions: Pick<OrganizationPermissionPort, 'can'>;
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  readonly addresses: Pick<AddressReadPort, 'listForOrganization' | 'findByIds'>;
}

const NOT_USABLE = (reason: LinkUnusableReason | 'no_link' | 'no_permission') =>
  new HttpError(422, ERROR_CODES.RELATED_PAYER_NOT_USABLE, 'This payer cannot be used for this order right now.', {
    reason,
  });

function cached(link: RelatedPayerLink): CachedLink {
  return {
    id: link.id,
    payerOrganizationId: link.payerOrganizationId,
    state: link.state,
    addressScope: link.addressScope,
    billingAddressId: link.billingAddressId ?? null,
    validFrom: link.validFrom ?? null,
    validTo: link.validTo ?? null,
    commercialTerms: link.commercialTerms,
  };
}

/**
 * `relatedPayerPolicyPort` (contracts/ports.md §1) — the one answer to "may this person,
 * buying for this Organization on this channel, name this payer now?" (FR-012, FR-060,
 * FR-063, FR-068).
 *
 * Every read across the buyer/payer boundary is here, and each runs under a system scope
 * with an organization predicate that came from a **validated link** (research R-5):
 * the payer's billing addresses (`addressReadPort` filters by organization **and** runs
 * under the ambient filter, which for a buyer's request is the buyer — so the payer's
 * rows would read as absent) and the buyer's links, read by the buyer id the caller
 * established, never by one a body named.
 *
 * The listing (`usablePayers`) may serve the buyer's links from the per-process cache;
 * the refusal (`assertUsable`) always re-reads, on the caller's transaction when given,
 * because placement must never trust the cache (FR-116).
 */
export class RelatedPayerPolicyService implements RelatedPayerPolicyPort {
  constructor(private readonly deps: RelatedPayerPolicyDeps) {}

  async usablePayers(subject: PayerPolicySubject): Promise<readonly UsablePayer[]> {
    if (!(await this.#mayUse(subject))) return [];
    const links = await this.deps.cache.get(subject.buyerOrganizationId, () =>
      this.#readLinks(this.deps.emFactory(), subject.buyerOrganizationId),
    );
    const out: UsablePayer[] = [];
    for (const link of links) {
      const usable = await this.#evaluate(link);
      if (usable.ok) out.push(usable.payer);
    }
    return out;
  }

  async assertUsable(
    subject: PayerPolicySubject,
    payerOrganizationId: string,
    opts: { tx?: unknown; billingAddressId?: string } = {},
  ): Promise<UsablePayer> {
    if (!(await this.deps.channelEnabled(subject.salesChannelId))) throw NOT_USABLE('capability_disabled');
    if (!(await this.#mayOrderWithPayer(subject))) throw NOT_USABLE('no_permission');
    const em = (opts.tx as EntityManager | undefined) ?? this.deps.emFactory();
    const links = (await this.#readLinks(em, subject.buyerOrganizationId)).filter(
      (l) => l.payerOrganizationId === payerOrganizationId,
    );
    const link = links[0];
    if (!link) throw NOT_USABLE('no_link');
    const usable = await this.#evaluate(link);
    if (!usable.ok) throw NOT_USABLE(usable.reason);
    if (opts.billingAddressId !== undefined && !usable.payer.billingAddressIds.includes(opts.billingAddressId)) {
      // FR-063 — "refused as today": the address is not one this buyer may bill.
      throw new HttpError(403, ERROR_CODES.ADDRESS_NOT_OWNED, 'Address does not belong to the caller organization.');
    }
    return usable.payer;
  }

  async payerBillingAddresses(subject: PayerPolicySubject, payerOrganizationId: string): Promise<readonly AddressRecord[]> {
    const payer = await this.assertUsable(subject, payerOrganizationId);
    return withSystemScope('related_payers: payer billing address for a linked buyer', () =>
      this.deps.addresses.findByIds(payerOrganizationId, payer.billingAddressIds, { liveOnly: true }),
    );
  }

  async pricingContext(
    subject: PayerPolicySubject,
    payerOrganizationId: string,
  ): Promise<{ organizationId: string; customerGroupId: string | null } | null> {
    const payer = await this.assertUsable(subject, payerOrganizationId);
    if (payer.commercialTerms !== 'payer') return null;
    const record = await this.deps.organizations.findById(payerOrganizationId);
    return { organizationId: payerOrganizationId, customerGroupId: record?.customerGroupId ?? null };
  }

  async hasPayerTermsLinks(buyerOrganizationId: string, salesChannelId: string): Promise<boolean> {
    if (!(await this.deps.channelEnabled(salesChannelId))) return false;
    const links = await this.deps.cache.get(buyerOrganizationId, () =>
      this.#readLinks(this.deps.emFactory(), buyerOrganizationId),
    );
    return links.some((l) => l.state === 'active' && l.commercialTerms === 'payer');
  }

  async #mayUse(subject: PayerPolicySubject): Promise<boolean> {
    return (await this.deps.channelEnabled(subject.salesChannelId)) && (await this.#mayOrderWithPayer(subject));
  }

  #mayOrderWithPayer(subject: PayerPolicySubject): Promise<boolean> {
    return this.deps.permissions.can(
      { customerAccountId: subject.customerAccountId, organizationId: subject.buyerOrganizationId },
      'related_payers.order_with_payer',
    );
  }

  /** The buyer's non-revoked links, read by the buyer id the caller established (R-5). */
  async #readLinks(em: EntityManager, buyerOrganizationId: string): Promise<CachedLink[]> {
    const rows = await withSystemScope("related_payers: a buyer's payer links", () =>
      em.find(RelatedPayerLink, { organizationId: buyerOrganizationId, state: 'active' }),
    );
    return rows.map(cached);
  }

  async #evaluate(
    link: CachedLink,
  ): Promise<{ ok: true; payer: UsablePayer } | { ok: false; reason: LinkUnusableReason }> {
    const payer = await this.deps.organizations.findById(link.payerOrganizationId);
    const billing = payer
      ? await withSystemScope('related_payers: payer billing address for a linked buyer', () =>
          this.deps.addresses.listForOrganization(link.payerOrganizationId, 'billing'),
        )
      : [];
    const verdict = evaluateLinkUsability({
      // The port is registered with `providePort`: reaching this line means present.
      modulePresent: true,
      // Checked by the caller before any link is read.
      channelEnabled: true,
      now: this.deps.now(),
      link,
      payer: payer ? { status: payer.status, isPersonal: payer.isPersonal, deleted: payer.deletedAt !== null } : null,
      payerBillingAddressIds: billing.filter((a) => a.kind === 'billing' && !a.deletedAt).map((a) => a.id),
    });
    if (!verdict.usable) return { ok: false, reason: verdict.reason };
    return {
      ok: true,
      payer: {
        linkId: link.id,
        payerOrganizationId: link.payerOrganizationId,
        payerName: payer!.legalName || payer!.name,
        payerTaxId: organizationCompanyTaxId(payer!) ?? '',
        commercialTerms: link.commercialTerms,
        billingAddressIds: verdict.billingAddressIds,
      },
    };
  }
}
