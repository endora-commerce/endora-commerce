import type { EntityManager } from '@mikro-orm/postgresql';
import type { PriceListReadPort } from '@endora-commerce/contracts';
import { Organization } from '../entities/organization.entity.js';

/**
 * The reason chips the Organization detail panel renders, one per way a price
 * book reaches the organization (feature 026 US5; since feature 160 the books
 * of `price_lists`, FR-032).
 *
 * `sales_channel_inheritance` and `segment_rule_match` were reasons of the old
 * Application rule and are no longer produced; they stay in the union so a
 * stale client keeps type-checking.
 */
export type ApplicablePriceListReason =
  | 'direct_organization_match'
  | 'ancestor_organization_match'
  | 'customer_group_match'
  | 'sales_channel_inheritance'
  | 'segment_rule_match';

export interface ApplicablePriceListEntry {
  priceListId: string;
  name: string;
  priority: number;
  reasons: ApplicablePriceListReason[];
}

export interface OrganizationEffectivePriceListsDeps {
  emFactory: () => EntityManager;
  /** This module's own inheritance chain (nearest first), as pricing reads it. */
  resolveOrgChain: (organizationId: string) => Promise<readonly string[]>;
  /**
   * `price_lists`' own answer to "which books apply to this organisation"
   * (feature 160, `listForOrganization`). With `price_lists` off the call fails
   * closed and the panel refuses: an empty list here reads as "no price book
   * applies to this organisation", which is a plausible answer and the wrong
   * one.
   */
  priceListRead: PriceListReadPort;
}

/**
 * The price books currently applicable to an Organization, each tagged with how
 * it reaches it: its own membership, an ancestor's, or its customer group's.
 * The audience is the book's header now, so this is one port read rather than
 * an evaluation of a rule this module used to copy.
 */
export class OrganizationEffectivePriceListsService {
  constructor(private readonly deps: OrganizationEffectivePriceListsDeps) {}

  async listApplicable(organizationId: string): Promise<ApplicablePriceListEntry[]> {
    const em = this.deps.emFactory();
    const org = await em.findOne(Organization, { id: organizationId, deletedAt: null });
    if (!org) return [];
    const organizationChain = await this.deps.resolveOrgChain(org.id);
    const books = await this.deps.priceListRead.listForOrganization({
      organizationChain: organizationChain.length > 0 ? organizationChain : [org.id],
      customerGroupId: org.customerGroupId ?? null,
    });
    return books.map((book) => ({
      priceListId: book.id,
      name: book.name,
      priority: book.priority,
      reasons: [
        book.reason === 'organization'
          ? 'direct_organization_match'
          : book.reason === 'ancestor'
            ? 'ancestor_organization_match'
            : 'customer_group_match',
      ],
    }));
  }
}
