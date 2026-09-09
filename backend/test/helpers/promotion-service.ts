import type {
  CatalogProductReadPort,
  CatalogPromoAttributePort,
  DictionaryValidator,
} from '@endora-commerce/contracts';
import type { AuditLogService } from '@endora-commerce/platform/composition';
import type { OrganizationReadPort } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipService } from '../../src/kernel/sales-channels/sales-channel-membership.service.js';
import { PromotionService } from '../../../packages/modules/promotions/src/backend/services/promotion-service.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * `PromotionService` over the composed container's own dependencies
 * (issues #164 and #251).
 *
 * None of these are constructor arguments the service can be built without,
 * because production never built it without them: each was optional, every
 * test omitted it, and the branch that ran instead was a gate left open.
 * `catalogPort` accepted a promotion naming an attribute that does not exist
 * (#164); then `salesChannelMembership` bound a new promotion to no channel and
 * skipped channel filtering, `dictionaryValidator` stored an unknown currency,
 * `resolveOrganizationStatus` let a blocked Organization keep its org-targeted
 * discounts, and `auditLog` committed the write unrecorded (#251).
 *
 * That is why this helper resolves them from the container rather than stubbing
 * them: a service built here is the one `backend.ts` builds, so a suite written
 * against it is a suite written against the platform. Ten suites were not.
 *
 * `emFactory` stays the caller's `h.em`. The container's own `promotionService`
 * would be truer still, but it forks its own manager, and these suites truncate
 * and then read through `h.em()` — one manager is what keeps those assertions
 * about the rows they just wrote.
 */
export function promotionServiceFor(
  h: BackendServerHandle,
  /**
   * The two catalog ports, for a suite whose assertion is about **who was
   * asked** and which therefore has to wrap one. Everything else stays the
   * composed registration — that is the point of the seam being this narrow.
   */
  catalogOverrides: {
    attributes?: CatalogPromoAttributePort;
    products?: CatalogProductReadPort;
  } = {},
): PromotionService {
  const cradle = h.container.cradle as never as {
    catalogPromoAttributePort: CatalogPromoAttributePort;
    catalogProductReadPort: CatalogProductReadPort;
    salesChannelMembershipPort: SalesChannelMembershipService;
    dictionaryValidator: DictionaryValidator;
    organizationReadPort: OrganizationReadPort;
    auditLogService: AuditLogService;
  };
  return new PromotionService(
    h.em,
    catalogOverrides.attributes ?? cradle.catalogPromoAttributePort,
    catalogOverrides.products ?? cradle.catalogProductReadPort,
    cradle.salesChannelMembershipPort,
    cradle.dictionaryValidator,
    // The closure `backend.ts` builds, spelled the same way: `null` means the
    // Organization could not be read, which the gate treats as "not active".
    async (orgId: string) =>
      (await cradle.organizationReadPort.loadEffectiveOrganization(orgId))?.status ?? null,
    cradle.auditLogService,
  );
}

/**
 * Catalog ports for a suite that composes no container and must not reach
 * `catalog` at all.
 *
 * They throw rather than answering emptily, which is the point: the shape the
 * optional parameters used to produce — a service that quietly skips the reads
 * it cannot make — is exactly what issue #164 removed, and a silent stub would
 * put it back one layer down. A test that starts exercising attributes gets a
 * named failure instead of a passing assertion about nothing.
 */
export function unreachableCatalogPorts(reason: string): {
  attributes: CatalogPromoAttributePort;
  products: CatalogProductReadPort;
} {
  const refuse = (method: string): never => {
    throw new Error(`[test] catalog.${method} is not available here: ${reason}`);
  };
  return {
    attributes: {
      promoRuleAttributeKeys: () => refuse('promoRuleAttributeKeys'),
      getAttributeWithOptions: () => refuse('getAttributeWithOptions'),
    } as unknown as CatalogPromoAttributePort,
    products: new Proxy({} as CatalogProductReadPort, {
      get: (_target, method) => () => refuse(String(method)),
    }),
  };
}

/**
 * The org-status resolver for a suite that seeds no Organization and never
 * calls `applyToCart` (issue #251).
 *
 * Same reasoning as {@link unreachableCatalogPorts}: the resolver is required
 * now, and a stub answering `'active'` would rebuild the open gate the issue
 * closed, one layer down. A suite that starts exercising org-targeted
 * promotions gets a named failure instead of a silently-granted discount.
 */
export function unreachableOrganizationStatus(
  reason: string,
): (orgId: string) => Promise<string | null> {
  return () => {
    throw new Error(`[test] organization status is not resolvable here: ${reason}`);
  };
}
