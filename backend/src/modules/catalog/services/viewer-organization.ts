import type {
  OrganizationDetailsPort,
  PriceOrganization,
  ProductAudience,
} from '@b2b/contracts';

/**
 * The buying organisation the pricing engine should resolve a catalogue price
 * against, for the viewer in front of this page — or `null` when there is none.
 *
 * `null` covers three callers, and they get the channel price for three
 * different reasons that happen to agree:
 *
 *  - the **anonymous** visitor and the crawler, who have no identity to price
 *    for and whose answer has to stay the canonical, cacheable, indexable one;
 *  - the **signed-in buyer with no Organization** — feature 026's guest-style
 *    account, and an unbound API key. Authenticated, and with no negotiated
 *    list to resolve against, so the channel price is not a fallback but the
 *    right answer;
 *  - the buyer whose Organization row is **gone**. That one answers with the
 *    channel price rather than throwing, for the reason `comparisons` states at
 *    the same seam: a missing row is not a reason to refuse a catalogue.
 *
 * Shared by `CatalogQueryService` and `ProductLinkService` because a PDP calls
 * both — the hero price and the cross-sell tiles under it come out of one
 * request, and two derivations of "who is asking" is two chances to answer it
 * differently on one page.
 */
export async function viewerOrganizationFor(
  organizations: OrganizationDetailsPort,
  audience: ProductAudience,
): Promise<PriceOrganization | null> {
  if (audience.organizationId === null) return null;
  const record = await organizations.findById(audience.organizationId);
  if (!record) return null;
  return { id: record.id, customerGroupId: record.customerGroupId };
}
