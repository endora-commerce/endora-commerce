import type { CatalogProductReadPort, CatalogPromoAttributePort } from '@b2b/contracts';
import { PromotionService } from '../../src/modules/promotions/services/promotion-service.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * `PromotionService` over the composed container's catalog ports (issue #164).
 *
 * The two ports are constructor arguments the service cannot be built without,
 * because production never was: `catalogPort` was optional, every test omitted
 * it, and the branch that ran instead — "no port, no semantic validation" —
 * accepted a promotion naming an attribute that does not exist. Ten call sites
 * passed nothing and got that branch; they resolve the real registrations now,
 * which is what the composed module resolves.
 *
 * `emFactory` stays the caller's `h.em`. The container's own `promotionService`
 * would be truer still, but it forks its own manager, and these suites truncate
 * and then read through `h.em()` — one manager is what keeps those assertions
 * about the rows they just wrote.
 */
export function promotionServiceFor(h: BackendServerHandle): PromotionService {
  const cradle = h.container.cradle as never as {
    catalogPromoAttributePort: CatalogPromoAttributePort;
    catalogProductReadPort: CatalogProductReadPort;
  };
  return new PromotionService(
    h.em,
    cradle.catalogPromoAttributePort,
    cradle.catalogProductReadPort,
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
