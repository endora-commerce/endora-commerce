import { describe, expect, it } from 'vitest';
import { resolveAllocations } from '../../../../packages/modules/inventory/src/backend/services/fulfilment-strategy-resolver.js';

const W = (id: string, code: string, available: number, isDefault = false) => ({
  warehouseId: id,
  warehouseCode: code,
  available,
  isDefault,
});

describe('resolveAllocations (T024) — five strategies + tie-break', () => {
  describe('any', () => {
    it('picks the first warehouse that satisfies the line; lex by code on tie', () => {
      const r = resolveAllocations({
        quantity: 5,
        strategy: 'any',
        candidateWarehouses: [W('w-b', 'pl-krk', 10), W('w-a', 'default', 10)],
        backorderEnabled: false,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.allocations).toEqual([{ warehouseId: 'w-a', quantity: 5, isBackorder: false }]);
    });

    it('refuses when no single warehouse can satisfy', () => {
      const r = resolveAllocations({
        quantity: 5,
        strategy: 'any',
        candidateWarehouses: [W('w-a', 'default', 3), W('w-b', 'pl-krk', 4)],
        backorderEnabled: false,
      });
      expect(r.ok).toBe(false);
    });

    it('falls through to backorder against the first warehouse when enabled', () => {
      const r = resolveAllocations({
        quantity: 5,
        strategy: 'any',
        candidateWarehouses: [W('w-a', 'default', 0), W('w-b', 'pl-krk', 0)],
        backorderEnabled: true,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.allocations[0]?.isBackorder).toBe(true);
    });
  });

  describe('default_first (the only splitting strategy)', () => {
    it('takes from default first, then from others in lex order', () => {
      const r = resolveAllocations({
        quantity: 10,
        strategy: 'default_first',
        candidateWarehouses: [
          W('w-b', 'pl-krk', 100),
          W('w-a', 'default', 2, true),
          W('w-c', 'us-nyc', 50),
        ],
        backorderEnabled: false,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.allocations).toEqual([
          { warehouseId: 'w-a', quantity: 2, isBackorder: false },
          { warehouseId: 'w-b', quantity: 8, isBackorder: false },
        ]);
      }
    });

    it('refuses when total stock across candidates is insufficient and backorder is off', () => {
      const r = resolveAllocations({
        quantity: 10,
        strategy: 'default_first',
        candidateWarehouses: [W('w-a', 'default', 2, true), W('w-b', 'pl-krk', 3)],
        backorderEnabled: false,
      });
      expect(r.ok).toBe(false);
    });

    it('flags the residual as backorder against the first-choice warehouse', () => {
      const r = resolveAllocations({
        quantity: 10,
        strategy: 'default_first',
        candidateWarehouses: [W('w-a', 'default', 2, true), W('w-b', 'pl-krk', 3)],
        backorderEnabled: true,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const wA = r.allocations.find((a) => a.warehouseId === 'w-a');
        expect(wA?.isBackorder).toBe(true);
      }
    });
  });

  describe('lowest_stock_first', () => {
    it('picks the warehouse with the lowest available that can still satisfy', () => {
      const r = resolveAllocations({
        quantity: 5,
        strategy: 'lowest_stock_first',
        candidateWarehouses: [W('w-a', 'default', 100), W('w-b', 'pl-krk', 6)],
        backorderEnabled: false,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.allocations[0]?.warehouseId).toBe('w-b');
    });
  });

  describe('highest_stock_first', () => {
    it('picks the warehouse with the highest available', () => {
      const r = resolveAllocations({
        quantity: 5,
        strategy: 'highest_stock_first',
        candidateWarehouses: [W('w-a', 'default', 100), W('w-b', 'pl-krk', 6)],
        backorderEnabled: false,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.allocations[0]?.warehouseId).toBe('w-a');
    });
  });

  describe('defined_order', () => {
    it('walks the configured warehouseOrder top-to-bottom', () => {
      const r = resolveAllocations({
        quantity: 5,
        strategy: 'defined_order',
        warehouseOrder: ['w-c', 'w-a'],
        candidateWarehouses: [W('w-a', 'default', 10), W('w-b', 'pl-krk', 10), W('w-c', 'us-nyc', 10)],
        backorderEnabled: false,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.allocations[0]?.warehouseId).toBe('w-c');
    });

    it('skips warehouses that are not in the candidate list', () => {
      const r = resolveAllocations({
        quantity: 5,
        strategy: 'defined_order',
        warehouseOrder: ['w-x', 'w-a'],
        candidateWarehouses: [W('w-a', 'default', 10)],
        backorderEnabled: false,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.allocations[0]?.warehouseId).toBe('w-a');
    });
  });
});
