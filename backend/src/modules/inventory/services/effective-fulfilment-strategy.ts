import type { FulfilmentStrategy } from '@b2b/contracts';

/**
 * Effective fulfilment-strategy resolver — pure function.
 *
 * The warehouse-picking strategy used to reserve stock at order placement is
 * configurable at three levels, resolved with precedence:
 *
 *   Product  >  Organization  >  Sales Channel (setting)  >  platform default
 *
 * Product and Organization each contribute an optional override layer; the
 * sales-channel layer (and the platform default behind it) are resolved
 * upstream by the Settings module and arrive already collapsed into
 * `channelDefault`. The first layer with a non-null `strategy` wins and
 * supplies BOTH its `strategy` and its `warehouseOrder` — the warehouse walk
 * for `defined_order` never mixes across layers.
 *
 * The result feeds the existing `resolveAllocations(...)` unchanged.
 */
export interface FulfilmentLayer {
  strategy: FulfilmentStrategy | null | undefined;
  warehouseOrder: string[] | null | undefined;
}

export interface EffectiveFulfilment {
  strategy: FulfilmentStrategy;
  warehouseOrder: string[];
}

export function resolveEffectiveFulfilmentStrategy(
  product: FulfilmentLayer,
  organization: FulfilmentLayer,
  channelDefault: EffectiveFulfilment,
): EffectiveFulfilment {
  for (const layer of [product, organization]) {
    if (layer.strategy) {
      return { strategy: layer.strategy, warehouseOrder: layer.warehouseOrder ?? [] };
    }
  }
  return channelDefault;
}
