import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T045 — `GET /catalog/categories` returns a nested Category tree with `children`
 * recursion. Seed data (T093) provides a 3-level hierarchy.
 */

interface CategoryShape {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  productCount: number;
  children: CategoryShape[];
}

function maxDepth(nodes: CategoryShape[], acc = 1): number {
  if (nodes.length === 0) return acc - 1;
  return Math.max(...nodes.map((n) => maxDepth(n.children, acc + 1)));
}

describe('GET /api/v1/catalog/categories — nested tree', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns a nested tree with children[] recursion', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/categories' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: CategoryShape[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    // At least one root must have a populated children[] array (nested tree shape).
    const treeDepth = maxDepth(body.data);
    expect(treeDepth).toBeGreaterThanOrEqual(2);
    for (const node of body.data) {
      expect(Array.isArray(node.children)).toBe(true);
      expect(typeof node.productCount).toBe('number');
    }
  });
});
