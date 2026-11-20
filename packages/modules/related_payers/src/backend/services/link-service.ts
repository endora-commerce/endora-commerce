import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrganizationDetailsPort,
  RelatedPayerLink as RelatedPayerLinkDto,
} from '@endora-commerce/contracts';
import { organizationCompanyTaxId } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { RelatedPayerLink } from '../entities/related-payer-link.entity.js';

const STATE_ORDER = { active: 0, inactive: 1, revoked: 2 } as const;

function ordered(links: RelatedPayerLink[]): RelatedPayerLink[] {
  return links.sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/**
 * The read side of payer links (FR-020, research R-5).
 *
 * The buyer's side is the link's own tenant: `listAsBuyer` reads under the ambient
 * filter. The payer's side crosses tenants on purpose and only this way: a system scope,
 * constrained by `payer_organization_id` to the Organization asking — never a widened
 * filter. A caller has already established that the asker may see that Organization.
 */
export class LinkReadService {
  constructor(
    private readonly deps: {
      readonly emFactory: () => EntityManager;
      readonly organizations: Pick<OrganizationDetailsPort, 'findByIds'>;
    },
  ) {}

  async listAsBuyer(buyerOrganizationId: string): Promise<RelatedPayerLink[]> {
    return ordered(await this.deps.emFactory().find(RelatedPayerLink, { organizationId: buyerOrganizationId }));
  }

  async listAsPayer(payerOrganizationId: string): Promise<RelatedPayerLink[]> {
    return withSystemScope('related_payers: links naming us as payer', async () =>
      ordered(await this.deps.emFactory().find(RelatedPayerLink, { payerOrganizationId })),
    );
  }

  async findAsPayer(payerOrganizationId: string, linkId: string): Promise<RelatedPayerLink | null> {
    return withSystemScope('related_payers: a link naming us as payer', () =>
      this.deps.emFactory().findOne(RelatedPayerLink, { id: linkId, payerOrganizationId }),
    );
  }

  /** The admin shape: both Organizations named, one batched read. */
  async toDtos(links: readonly RelatedPayerLink[]): Promise<RelatedPayerLinkDto[]> {
    const ids = [...new Set(links.flatMap((l) => [l.organizationId, l.payerOrganizationId]))];
    const orgs = new Map((ids.length ? await this.deps.organizations.findByIds(ids) : []).map((o) => [o.id, o]));
    return links.map((link) => {
      const buyer = orgs.get(link.organizationId);
      const payer = orgs.get(link.payerOrganizationId);
      return {
        id: link.id,
        buyerOrganizationId: link.organizationId,
        buyerName: buyer?.name ?? '',
        payerOrganizationId: link.payerOrganizationId,
        payerName: payer?.name ?? '',
        payerTaxId: payer ? organizationCompanyTaxId(payer) : null,
        buyerTaxId: buyer ? organizationCompanyTaxId(buyer) : null,
        state: link.state,
        addressScope: link.addressScope,
        billingAddressId: link.billingAddressId,
        validFrom: link.validFrom ? link.validFrom.toISOString() : null,
        validTo: link.validTo ? link.validTo.toISOString() : null,
        commercialTerms: link.commercialTerms,
        notifyPayerOnOrders: link.notifyPayerOnOrders,
        origin: link.origin,
        originSource: link.originSource,
        revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
        revokedByKind: link.revokedByKind,
        version: link.version,
        createdAt: link.createdAt.toISOString(),
        updatedAt: link.updatedAt.toISOString(),
      };
    });
  }
}
