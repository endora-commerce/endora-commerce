import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { findDemoOrganization } from './demo-organization.js';

/**
 * `specs/177-tax-id-scope/` T026a (D-290 / OD-12, inventory X12) — the demo
 * organisation is found by its tax ID the way `organizationDetailsPort.findByTaxId`
 * answers: the tree's root first. In `per-tree-root` a branch may share the
 * demo tax ID, and `findOne({ taxId })` would hand back whichever row came
 * first.
 */
function fakeEm(ids: string[]) {
  const execute = vi.fn(async () => ids.map((id) => ({ id })));
  const findOne = vi.fn(async (_entity: unknown, where: { id: string }) => ({ id: where.id }));
  return { em: { execute, findOne } as unknown as EntityManager, execute, findOne };
}

class Organization {}

describe('findDemoOrganization', () => {
  it('answers the first row of the root-first lookup, by id', async () => {
    const { em, execute, findOne } = fakeEm(['root-id', 'branch-id']);
    expect(await findDemoOrganization(em, Organization, 'PL5210000099')).toEqual({ id: 'root-id' });
    const [sql, params] = execute.mock.calls[0]! as unknown as [string, unknown[]];
    expect(params).toEqual(['PL5210000099']);
    // Root first, then depth, creation time and id — the lookup service's order.
    expect(sql).toMatch(/order by \("root_id" is not distinct from "id"\) desc/);
    expect(sql).toMatch(/"created_at" asc,\s*"id" asc/);
    expect(findOne).toHaveBeenCalledWith(Organization, { id: 'root-id' });
  });

  it('answers null when nobody holds the tax ID', async () => {
    const { em, findOne } = fakeEm([]);
    expect(await findDemoOrganization(em, Organization, 'PL5210000099')).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('is the only way the composition steps find the demo organisation', () => {
    for (const file of ['composition.ts', 'sales-pipeline.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/findOne\(Organization, \{ taxId/);
      expect(source, file).toContain('findDemoOrganization(em, Organization, DEMO_ORG_TAX_ID)');
    }
  });
});
