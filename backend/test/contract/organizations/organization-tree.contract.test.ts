import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  ERROR_CODES,
  organizationSubtreeResponseSchema,
  organizationAncestorsResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

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

  /**
   * `specs/177-tax-id-scope/` T036 (FR-020) — in `per-tree-root` a tax ID
   * shared inside a tree may not be split across two by a move; in `global`
   * nothing is shared, so moves behave as before. The scope is set through the
   * route and the one found put back after, once the shared tax IDs are made
   * unique again (`global`'s constraint cannot return over them).
   */
  describe('moves and the tax-ID scope', () => {
    let initialScope: 'global' | 'per-tree-root';
    const sharing: string[] = [];
    const admin = { b2b_session: 'stub-admin-session' };

    const putScope = async (scope: 'global' | 'per-tree-root') => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/organizations/tax-id-scope',
        cookies: admin,
        payload: { scope },
      });
      expect(res.statusCode, res.body).toBe(200);
    };

    /** A company row; under `parent` when given, sharing `taxId` when given. */
    async function org(input: { taxId?: string; parent?: { id: string; path: string } } = {}): Promise<{ id: string; path: string; taxId: string }> {
      const id = randomUUID();
      const taxId = input.taxId ?? `TR${id.replace(/-/g, '').slice(0, 14).toUpperCase()}`;
      const path = `${input.parent?.path ?? '/'}${id}/`;
      await h.em().execute(
        `insert into "organizations"
           ("id","name","tax_id","status","vat_status","is_personal","registered_address","parent_id","path","created_at","updated_at")
         values (?, ?, ?, 'active', 'vat_payer', false, '{}'::jsonb, ?, ?, now(), now())`,
        [id, `Tree scope ${id.slice(0, 8)}`, taxId, input.parent?.id ?? null, path],
      );
      if (input.taxId) sharing.push(id);
      return { id, path, taxId };
    }

    const reparent = (id: string, parentId: string | null) =>
      h.app.inject({ method: 'POST', url: `/api/v1/admin/organizations/${id}/parent`, cookies: admin, payload: { parentId } });

    beforeAll(async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/organizations/tax-id-scope', cookies: admin });
      initialScope = (res.json() as { data: { scope: 'global' | 'per-tree-root' } }).data.scope;
    });

    afterEach(async () => {
      if (sharing.length > 0) {
        await h.em().execute(
          `update "organizations" set "tax_id" = 'R' || substr(replace("id"::text, '-', ''), 1, 31)
            where "id" = any(?::uuid[])`,
          [`{${sharing.join(',')}}`],
        );
        sharing.length = 0;
      }
      await putScope(initialScope);
    });

    it('per-tree-root: detaching or moving a sharer out of its tree is refused with the tax IDs', async () => {
      await putScope('per-tree-root');
      const head = await org();
      const branch = await org({ taxId: head.taxId, parent: head });
      const other = await org();

      for (const target of [null, other.id]) {
        const res = await reparent(branch.id, target);
        expect(res.statusCode, res.body).toBe(409);
        const error = (res.json() as { error: { code: string; details: { code: string; taxIds: string[] } } }).error;
        expect(error.code).toBe(ERROR_CODES.ORGANIZATION_TREE_INVALID);
        expect(error.details).toEqual({ code: 'tax_id_shared_across_trees', taxIds: [head.taxId] });
      }
    });

    it('per-tree-root: a subtree holding a shared tax ID cannot leave the tree either', async () => {
      await putScope('per-tree-root');
      const head = await org();
      const middle = await org({ parent: head });
      await org({ taxId: head.taxId, parent: middle });
      const other = await org();
      const res = await reparent(middle.id, other.id);
      expect(res.statusCode, res.body).toBe(409);
      expect((res.json() as { error: { details: { taxIds: string[] } } }).error.details.taxIds).toEqual([head.taxId]);
    });

    it('per-tree-root: the whole sharing tree may move, and a sharer may move inside its tree', async () => {
      await putScope('per-tree-root');
      const head = await org();
      const left = await org({ parent: head });
      const branch = await org({ taxId: head.taxId, parent: head });
      const inside = await reparent(branch.id, left.id);
      expect(inside.statusCode, inside.body).toBe(200);

      const elsewhere = await org();
      const whole = await reparent(head.id, elsewhere.id);
      expect(whole.statusCode, whole.body).toBe(200);
    });

    it('global: moves are unaffected by tax IDs', async () => {
      await putScope('global');
      const head = await org();
      const branch = await org({ parent: head });
      const other = await org();
      expect((await reparent(branch.id, other.id)).statusCode).toBe(200);
      expect((await reparent(branch.id, null)).statusCode).toBe(200);
    });
  });
});
