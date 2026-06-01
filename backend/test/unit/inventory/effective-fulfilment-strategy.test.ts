import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveFulfilmentStrategy,
  type EffectiveFulfilment,
} from '../../../src/modules/inventory/services/effective-fulfilment-strategy.js';

const CHANNEL_DEFAULT: EffectiveFulfilment = {
  strategy: 'default_first',
  warehouseOrder: [],
};

describe('resolveEffectiveFulfilmentStrategy — precedence Product > Organization > Channel', () => {
  it('falls back to the channel default when neither product nor org override', () => {
    const r = resolveEffectiveFulfilmentStrategy(
      { strategy: null, warehouseOrder: null },
      { strategy: null, warehouseOrder: null },
      CHANNEL_DEFAULT,
    );
    expect(r).toEqual(CHANNEL_DEFAULT);
  });

  it('uses the organization override when the product has none', () => {
    const r = resolveEffectiveFulfilmentStrategy(
      { strategy: null, warehouseOrder: null },
      { strategy: 'highest_stock_first', warehouseOrder: null },
      CHANNEL_DEFAULT,
    );
    expect(r).toEqual({ strategy: 'highest_stock_first', warehouseOrder: [] });
  });

  it('product override wins over both organization and channel', () => {
    const r = resolveEffectiveFulfilmentStrategy(
      { strategy: 'lowest_stock_first', warehouseOrder: null },
      { strategy: 'highest_stock_first', warehouseOrder: null },
      CHANNEL_DEFAULT,
    );
    expect(r.strategy).toBe('lowest_stock_first');
  });

  it('carries the warehouse order from the winning layer and never mixes layers', () => {
    // Product wins → its (empty) order is used, NOT the organization's list.
    const r = resolveEffectiveFulfilmentStrategy(
      { strategy: 'defined_order', warehouseOrder: ['wp-1', 'wp-2'] },
      { strategy: 'defined_order', warehouseOrder: ['wo-9'] },
      CHANNEL_DEFAULT,
    );
    expect(r).toEqual({ strategy: 'defined_order', warehouseOrder: ['wp-1', 'wp-2'] });
  });

  it('uses the organization warehouse order when the org layer wins', () => {
    const r = resolveEffectiveFulfilmentStrategy(
      { strategy: null, warehouseOrder: ['ignored'] },
      { strategy: 'defined_order', warehouseOrder: ['wo-1', 'wo-2'] },
      CHANNEL_DEFAULT,
    );
    expect(r).toEqual({ strategy: 'defined_order', warehouseOrder: ['wo-1', 'wo-2'] });
  });

  it('treats undefined the same as null (no override)', () => {
    const r = resolveEffectiveFulfilmentStrategy(
      { strategy: undefined, warehouseOrder: undefined },
      { strategy: undefined, warehouseOrder: undefined },
      { strategy: 'any', warehouseOrder: [] },
    );
    expect(r).toEqual({ strategy: 'any', warehouseOrder: [] });
  });

  it('normalizes a winning layer with a missing warehouse order to []', () => {
    const r = resolveEffectiveFulfilmentStrategy(
      { strategy: 'any', warehouseOrder: null },
      { strategy: null, warehouseOrder: null },
      CHANNEL_DEFAULT,
    );
    expect(r).toEqual({ strategy: 'any', warehouseOrder: [] });
  });
});
