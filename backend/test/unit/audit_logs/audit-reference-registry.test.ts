import { describe, expect, it, vi } from 'vitest';
import type { AuditReferenceResolver } from '@endora-commerce/contracts';
import { AuditReferenceRegistry } from '../../../src/modules/audit_logs/services/audit-reference-registry.js';

/**
 * The audit-log reference registry (feature 075, D-87 drain).
 *
 * `audit_logs` used to turn an `objectId` into a name by running SQL against
 * `products`, `warehouses`, `price_lists`, `customer_accounts` and
 * `organizations` — five other modules' tables, from a module that is
 * `nonDeactivatable` and so could not have declared any of them without taking
 * the operator's switch away from `inventory`. The reads are inverted onto this
 * registry: each owner pushes a resolver for its own type.
 *
 * The enumeration policy is **skip**, and `inventory` is the case that can
 * actually happen: of the five contributing owners it is the only one whose
 * manifest does not declare `activation.nonDeactivatable`, so it is the only one
 * an operator can switch off. The other four are `OWNER LOCKED` — the policy
 * still holds for them, it simply has no reachable state to be observed in, so
 * the off-state assertions below are written against `inventory`.
 */

function resolver(
  ownerModuleId: string,
  referenceType: string,
  rows: Record<string, string>,
  onResolve?: () => void,
): AuditReferenceResolver {
  return {
    ownerModuleId,
    referenceType,
    resolve: async (ids) => {
      onResolve?.();
      return ids
        .filter((id) => id in rows)
        .map((id) => ({ id, label: rows[id]!, url: `/${referenceType}/${id}` }));
    },
  };
}

describe('AuditReferenceRegistry', () => {
  it('resolves ids through the contributor that claimed the type', async () => {
    const registry = new AuditReferenceRegistry(() => true);
    registry.register(resolver('catalog', 'product', { p1: 'Widget' }));
    registry.register(resolver('inventory', 'warehouse', { w1: 'Main' }));

    const products = await registry.resolve('product', ['p1']);
    expect(products.get('p1')).toEqual({ id: 'p1', label: 'Widget', url: '/product/p1' });

    const warehouses = await registry.resolve('warehouse', ['w1']);
    expect(warehouses.get('w1')).toEqual({ id: 'w1', label: 'Main', url: '/warehouse/w1' });
  });

  it('omits an id no contributor has a row for', async () => {
    const registry = new AuditReferenceRegistry(() => true);
    registry.register(resolver('catalog', 'product', { p1: 'Widget' }));

    const resolved = await registry.resolve('product', ['p1', 'deleted']);
    expect(resolved.has('deleted')).toBe(false);
    expect(resolved.size).toBe(1);
  });

  it('answers with an empty map for a type nobody claimed', async () => {
    const registry = new AuditReferenceRegistry(() => true);
    const resolved = await registry.resolve('warehouse', ['w1']);
    expect(resolved.size).toBe(0);
  });

  it('never calls a resolver with an empty id list', async () => {
    const onResolve = vi.fn();
    const registry = new AuditReferenceRegistry(() => true);
    registry.register(resolver('catalog', 'product', { p1: 'Widget' }, onResolve));

    expect((await registry.resolve('product', [])).size).toBe(0);
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('skips a contributor that is not effectively present, and does not read its tables', async () => {
    const onResolve = vi.fn();
    const registry = new AuditReferenceRegistry((id) => id !== 'inventory');
    registry.register(resolver('inventory', 'warehouse', { w1: 'Main' }, onResolve));

    const resolved = await registry.resolve('warehouse', ['w1']);
    expect(resolved.size).toBe(0);
    // The point of the skip: a module that is off is not read through on its
    // own behalf, so the query must not run at all.
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('restores the contributor when it is switched back on', async () => {
    let inventoryPresent = false;
    const registry = new AuditReferenceRegistry((id) =>
      id === 'inventory' ? inventoryPresent : true,
    );
    registry.register(resolver('inventory', 'warehouse', { w1: 'Main' }));

    expect((await registry.resolve('warehouse', ['w1'])).size).toBe(0);
    inventoryPresent = true;
    expect((await registry.resolve('warehouse', ['w1'])).get('w1')?.label).toBe('Main');
  });

  it('reports every contributor by owner, presence-blind', () => {
    const registry = new AuditReferenceRegistry(() => false);
    registry.register(resolver('catalog', 'product', {}));
    registry.register(resolver('inventory', 'warehouse', {}));

    expect(registry.owners()).toEqual(['catalog', 'inventory']);
  });

  it('ignores a re-registration of the same resolver instance', async () => {
    const registry = new AuditReferenceRegistry(() => true);
    const only = resolver('catalog', 'product', { p1: 'Widget' });
    registry.register(only);
    registry.register(only);

    expect(registry.owners()).toEqual(['catalog']);
  });

  it('refuses a second contributor for a type another module already claims', () => {
    const registry = new AuditReferenceRegistry(() => true);
    registry.register(resolver('catalog', 'product', {}));

    expect(() => registry.register(resolver('pim_ergonode', 'product', {}))).toThrow(
      /product/,
    );
  });
});
