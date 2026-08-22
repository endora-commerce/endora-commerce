import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  organizationSubtreeResponseSchema,
  organizationAncestorsResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';

/**
 * Feature 056 US1 — organization tree HTTP contract (T008).
 *
 * POST /:id/parent (assign / move / detach), GET /:id/subtree, GET /:id/ancestors,
 * and DELETE /:id → 409 `has_children`. Response shapes match the T001 schemas.
 */

let seq = 0;
async function makeRoot(h: BackendServerHandle, name: string): Promise<Organization> {
  seq += 1;
  const em = h.em();
  const org = em.create(Organization, {
    name,
    taxId: `PL056CTR${String(seq).padStart(6, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  });
  await em.persistAndFlush(org);
  org.path = `/${org.id}/`;
  await em.flush();
  return org;
}

describe('organization tree HTTP contract (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('assigns a parent, moves, and detaches back to a root', async () => {
    const head = await makeRoot(h, 'Ctr HO');
    const branch = await makeRoot(h, 'Ctr Branch');
    const other = await makeRoot(h, 'Ctr Other');

    // Assign branch under head.
    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${branch.id}/parent`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { parentId: head.id },
    });
    expect(assign.statusCode).toBe(200);

    let ancestors = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${branch.id}/ancestors`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(ancestors.statusCode).toBe(200);
    let parsed = organizationAncestorsResponseSchema.parse(ancestors.json());
    expect(parsed.items.map((i) => i.id)).toEqual([head.id]);

    // Move branch under `other`.
    const move = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${branch.id}/parent`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { parentId: other.id },
    });
    expect(move.statusCode).toBe(200);
    ancestors = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${branch.id}/ancestors`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    parsed = organizationAncestorsResponseSchema.parse(ancestors.json());
    expect(parsed.items.map((i) => i.id)).toEqual([other.id]);

    // Detach → root again.
    const detach = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${branch.id}/parent`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { parentId: null },
    });
    expect(detach.statusCode).toBe(200);
    ancestors = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${branch.id}/ancestors`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    parsed = organizationAncestorsResponseSchema.parse(ancestors.json());
    expect(parsed.items).toEqual([]);
  });

  it('reads a subtree pre-order with the tree-node shape', async () => {
    const head = await makeRoot(h, 'Ctr Subtree HO');
    const a = await makeRoot(h, 'Ctr Subtree A');
    const b = await makeRoot(h, 'Ctr Subtree B');
    for (const [child, parent] of [
      [a, head],
      [b, a],
    ] as const) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${child.id}/parent`,
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { parentId: parent.id },
      });
      expect(res.statusCode).toBe(200);
    }

    const subtree = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${head.id}/subtree`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(subtree.statusCode).toBe(200);
    const parsed = organizationSubtreeResponseSchema.parse(subtree.json());
    const ids = new Set(parsed.items.map((i) => i.id));
    expect(ids).toEqual(new Set([head.id, a.id, b.id]));
    const headNode = parsed.items.find((i) => i.id === head.id);
    expect(headNode?.depth).toBe(0);
    expect(headNode?.parentId).toBeNull();
    const bNode = parsed.items.find((i) => i.id === b.id);
    expect(bNode?.depth).toBe(2);
    expect(bNode?.parentId).toBe(a.id);
  });

  it('rejects a cycle-inducing assignment with 422', async () => {
    const root = await makeRoot(h, 'Ctr Cycle Root');
    const child = await makeRoot(h, 'Ctr Cycle Child');
    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${child.id}/parent`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { parentId: root.id },
    });
    expect(assign.statusCode).toBe(200);

    const cycle = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${root.id}/parent`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { parentId: child.id },
    });
    expect(cycle.statusCode).toBe(422);
  });

  it('blocks deleting an organization that still has children (409 has_children)', async () => {
    const parent = await makeRoot(h, 'Ctr Del Parent');
    const child = await makeRoot(h, 'Ctr Del Child');
    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${child.id}/parent`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { parentId: parent.id },
    });
    expect(assign.statusCode).toBe(200);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${parent.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(409);
    const body = del.json() as { error: { details?: { code?: string } } };
    expect(body.error.details?.code).toBe('has_children');

    // The childless leaf can be deleted.
    const delChild = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${child.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(delChild.statusCode).toBe(204);
  });
});
