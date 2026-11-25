import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KERNEL_MERGE_PARTICIPATIONS,
  entityOwnerFromPath,
  incompleteModules,
  populationFromMetadata,
  runtimeMergeCoverage,
} from './completeness.js';
import type { MergeParticipationOwnership } from './declarations.js';

/**
 * `specs/192-organization-merge/` T009 (R-9, `contracts/merge-participation-check.md`
 * §4) — the runtime twin: the uncovered set per present module, from the ORM's
 * metadata and the composed declarations. It never reads the pending ledger,
 * and a module that is off is left out (its step is deferred anyway).
 */

const metadata = [
  { className: 'Order', properties: { id: {}, organizationId: {}, payerOrganizationId: {} }, path: '/x/orders/order.entity.js' },
  { className: 'Cart', properties: { id: {}, organizationId: {} }, path: '/x/carts/cart.entity.js' },
  { className: 'Note', properties: { id: {}, body: {} }, path: '/x/notes/note.entity.js' },
  { className: 'CommandOutboxEntry', properties: { id: {}, organizationId: {} }, path: '/x/platform/outbox.js' },
  { className: 'AuditLogEntry', properties: { id: {}, objectType: {}, objectId: {} }, path: '/x/platform/audit.js' },
];
const owners: Record<string, string> = {
  '/x/orders/order.entity.js': 'orders',
  '/x/carts/cart.entity.js': 'carts',
  '/x/notes/note.entity.js': 'notes',
  '/x/platform/outbox.js': 'core',
  '/x/platform/audit.js': 'core',
};

const ordersDeclared: MergeParticipationOwnership = {
  moduleId: 'orders',
  host: 'organization',
  key: 'orders',
  phase: 'records',
  trailing: false,
  batchSize: undefined,
  references: [
    { entity: 'Order', property: 'organizationId', disposition: 're_point' },
    { entity: 'Order', property: 'payerOrganizationId', disposition: 're_point' },
  ],
};

describe('the runtime completeness twin', () => {
  const population = populationFromMetadata(metadata, (_className, path) => (path ? owners[path] : undefined));

  it('derives the population from the metadata, attributed to the owning module', () => {
    expect(population.map((entity) => `${entity.moduleId}:${entity.entity}`).sort()).toEqual([
      'carts:Cart',
      'core:AuditLogEntry',
      'core:CommandOutboxEntry',
      'notes:Note',
      'orders:Order',
    ]);
  });

  it('declares the kernel’s own references as kept', () => {
    expect(KERNEL_MERGE_PARTICIPATIONS.every((p) => p.moduleId === 'core')).toBe(true);
    expect(KERNEL_MERGE_PARTICIPATIONS.flatMap((p) => p.references.map((r) => r.disposition))).toEqual(['kept', 'kept']);
  });

  it('names every present module holding an undeclared reference, and leaves out modules that are off', () => {
    const result = runtimeMergeCoverage({ population, declarations: [ordersDeclared] });
    expect(result.uncoveredModules).toEqual(['carts']);
    expect(incompleteModules(result, () => true)).toEqual(['carts']);
    expect(incompleteModules(result, (moduleId) => moduleId !== 'carts')).toEqual([]);
  });

  it('is complete when every reference is declared', () => {
    const result = runtimeMergeCoverage({
      population,
      declarations: [
        ordersDeclared,
        { ...ordersDeclared, moduleId: 'carts', key: 'carts', references: [{ entity: 'Cart', property: 'organizationId', disposition: 're_point' }] },
      ],
    });
    expect(result.uncoveredModules).toEqual([]);
  });

  it('attributes an entity to the module whose package.json declares it, and the platform to core', () => {
    const root = mkdtempSync(join(tmpdir(), 'merge-owner-'));
    mkdirSync(join(root, 'mod', 'dist', 'backend', 'entities'), { recursive: true });
    writeFileSync(join(root, 'mod', 'package.json'), JSON.stringify({ name: 'x', endora: { type: 'module', id: 'orders' } }));
    mkdirSync(join(root, 'platform', 'dist', 'kernel'), { recursive: true });
    writeFileSync(join(root, 'platform', 'package.json'), JSON.stringify({ name: 'p', endora: { type: 'platform' } }));
    expect(entityOwnerFromPath(join(root, 'mod', 'dist', 'backend', 'entities', 'order.entity.js'))).toBe('orders');
    expect(entityOwnerFromPath(join(root, 'platform', 'dist', 'kernel', 'a.js'))).toBe('core');
    expect(entityOwnerFromPath(join(root, 'nowhere.js'))).toBeUndefined();
    expect(entityOwnerFromPath(undefined)).toBeUndefined();
  });
});
