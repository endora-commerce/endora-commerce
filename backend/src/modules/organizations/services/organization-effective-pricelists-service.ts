import type { EntityManager } from '@mikro-orm/postgresql';
import { Organization } from '../entities/organization.entity.js';
import { PriceList } from '../../price_lists/entities/price-list.entity.js';
import {
  evaluateApplicationRule,
  type ResolutionContext,
} from '../../price_lists/services/application-rule-evaluator.js';

/**
 * Maps the application-rule-evaluator's `RuleCriterionType` tags to the
 * customer-facing "reason" labels surfaced by the Organization detail
 * panel (feature 026 US5). The Organization detail page reads
 * `reasons[]` and renders one chip per entry.
 *
 * The category criterion is mapped to `segment_rule_match` because in
 * practice a category-scoped price list functions as a segment rule
 * from the operator's perspective.
 */
export type ApplicablePriceListReason =
  | 'direct_organization_match'
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
  /**
   * Sales-channel id used to evaluate channel-bound rules. The org-detail
   * panel is read-only; passing the platform's system-default channel is
   * sufficient because the panel surfaces what applies "to this
   * Organization broadly" — channel-specific overrides are visible when
   * an admin opens the relevant Sales Channel.
   */
  resolveDefaultSalesChannelId: () => Promise<string>;
}

/**
 * Returns the set of Price Lists currently applicable to a given
 * Organization, each tagged with the reasons it applies. Implementation
 * reuses the existing application-rule evaluator (no new persistence
 * surface) — see research.md R6.
 */
export class OrganizationEffectivePriceListsService {
  constructor(private readonly deps: OrganizationEffectivePriceListsDeps) {}

  async listApplicable(organizationId: string): Promise<ApplicablePriceListEntry[]> {
    const em = this.deps.emFactory();
    const org = await em.findOne(Organization, { id: organizationId, deletedAt: null });
    if (!org) return [];

    const salesChannelId = await this.deps.resolveDefaultSalesChannelId();
    const now = new Date();

    const candidates = await em.find(
      PriceList,
      { status: 'active' },
      { orderBy: { modifiedAt: 'desc', name: 'asc' } },
    );

    const ctx: ResolutionContext = {
      organizationId: org.id,
      customerGroupId: org.customerGroupId ?? null,
      salesChannelId,
      currencyCode: 'PLN',
      productCategoryIds: new Set<string>(),
    };

    const results: ApplicablePriceListEntry[] = [];
    for (const pl of candidates) {
      // Time-window check: skip lists that haven't started or have expired.
      if (pl.startsAt && pl.startsAt > now) continue;
      if (pl.endsAt && pl.endsAt < now) continue;

      const evaluation = evaluateApplicationRule(pl.applicationRule, ctx);
      if (!evaluation.matched) continue;

      const reasons: ApplicablePriceListReason[] = [];
      if (evaluation.explicitOn.has('organization')) reasons.push('direct_organization_match');
      if (evaluation.explicitOn.has('customerGroup')) reasons.push('customer_group_match');
      if (evaluation.explicitOn.has('salesChannel')) reasons.push('sales_channel_inheritance');
      if (evaluation.explicitOn.has('category')) reasons.push('segment_rule_match');
      // The "all" rule (kind='all') matches without any explicitOn — surface
      // as a segment-rule-match-like blanket entry so the UI shows something.
      if (reasons.length === 0) reasons.push('segment_rule_match');

      results.push({
        priceListId: pl.id,
        name: pl.name,
        priority: reasons.length, // higher specificity → higher priority
        reasons,
      });
    }

    // Sort by priority desc, then by name asc for stable display.
    results.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.name.localeCompare(b.name);
    });

    return results;
  }
}
