import type { BackendServerHandle } from './test-server.js';
import type { PricingService } from '../../../packages/modules/price_lists/src/backend/services/pricing-service.js';

/**
 * Feature 160 — the price surface as a test drives it. Requests never build a
 * surface (`contracts/price-surface.md` §3): a test that asserts a price order
 * first lets the requests register the profiles they need, then runs the
 * worker's pass itself — the harness runs no queue consumer.
 */

interface SurfaceHandle {
  rebuildStale(): Promise<number>;
}

function engine(h: BackendServerHandle): { priceSurface: SurfaceHandle } {
  const container = h.container as unknown as { resolve<T>(name: string): T };
  return container.resolve<{ handle: { pricingEngine: { priceSurface: SurfaceHandle } } }>('priceLists').handle.pricingEngine;
}

/** Run the surface worker's pass now: every never-built and every stale profile is (re)built. */
export async function settlePriceSurface(h: BackendServerHandle): Promise<number> {
  return engine(h).priceSurface.rebuildStale();
}

/**
 * Ask a price-sorted listing once per viewer, so each registers its profiles,
 * then build them. Each viewer is `{ headers, cookies? }` of the listing request.
 */
export async function warmPriceSort(
  h: BackendServerHandle,
  viewers: ReadonlyArray<{ headers: Record<string, string>; cookies?: Record<string, string> | undefined }>,
): Promise<void> {
  for (const viewer of viewers) {
    await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?sort=price&limit=1',
      headers: viewer.headers,
      ...(viewer.cookies ? { cookies: viewer.cookies } : {}),
    });
  }
  await settlePriceSurface(h);
}

/** Count the surface rebuilds the read path asks for, without a queue. */
export function countRebuildRequests(h: BackendServerHandle): { readonly count: number; restore(): void } {
  const container = h.container as unknown as { resolve<T>(name: string): T };
  const producer = container.resolve<{ enqueue(): Promise<boolean> }>('priceListsSurfaceProducer');
  const original = producer.enqueue.bind(producer);
  const counter = { count: 0, restore: () => (producer.enqueue = original) };
  producer.enqueue = async () => {
    counter.count += 1;
    return original();
  };
  return counter;
}

/**
 * The composed pricing engine of a test server — the price-book engine with
 * its channel bridge, caches and read ports, exactly as production builds it.
 * A test that constructed a `PricingService` of its own did so for the old
 * engine, which needed none of them.
 */
export function pricingEngineOf(h: BackendServerHandle): PricingService {
  const container = h.container as unknown as { resolve<T>(name: string): T };
  return container.resolve<{ handle: { pricingEngine: PricingService } }>('priceLists').handle.pricingEngine;
}
