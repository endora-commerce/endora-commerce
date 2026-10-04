import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';

/**
 * An organization that was only ever *created* is a root with a root's path.
 *
 * The fixtures here go through `seedAdHocOrganization`, which — like company
 * registration and the personal organization of a B2C account — names no
 * `path` at all. Such a row used to keep the column's `''` default, and the
 * tree reads a path as a prefix: its subtree was every organization on the
 * platform, and re-parenting it under anything refused as a cycle before the
 * request was looked at any further. These cases assert the three readings
 * against rows stored by the real ORM.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('organizations — the root path of a newly created organization [real DB]', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(() => h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function storedPath(id: string): Promise<string> {
    const rows = (await h
      .em()
      .getConnection()
      .execute('select "path" from "organizations" where "id" = ?', [id])) as Array<{ path: string }>;
    return rows[0]!.path;
  }

  it('stores /<id>/ for an organization created without naming a path', async () => {
    const org = await seedAdHocOrganization(h.em(), 'Root Path A');
    expect(await storedPath(org.id)).toBe(`/${org.id}/`);
  });

  it('answers that organization alone as its own subtree, and no ancestors', async () => {
    const a = await seedAdHocOrganization(h.em(), 'Root Path Subtree A');
    await seedAdHocOrganization(h.em(), 'Root Path Subtree B');

    // The reading that matters most: a subtree is what a roll-up-enabled
    // customer's tenant scope widens to. With an empty path it was every
    // organization in the table.
    expect(await tree.subtreeIds(a.id)).toEqual([a.id]);
    expect(await tree.descendantIds(a.id)).toEqual([]);
    expect(await tree.ancestorIds(a.id)).toEqual([]);
  });

  it('re-parents one newly created root under another → 200, with the child path under the parent', async () => {
    const parent = await seedAdHocOrganization(h.em(), 'Root Path Parent');
    const child = await seedAdHocOrganization(h.em(), 'Root Path Child');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${child.id}/parent`,
      payload: { parentId: parent.id },
      ...ADMIN,
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(await storedPath(child.id)).toBe(`/${parent.id}/${child.id}/`);
    expect(await tree.subtreeIds(parent.id)).toEqual([parent.id, child.id]);
    // And the sibling root created by the cases above is still not part of it.
    expect(await tree.ancestorIds(child.id)).toEqual([parent.id]);
  });
});
