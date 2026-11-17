import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { seedSuspendedOrganization, TEST_SUSPENDED_ORGANIZATION_ID } from '../../helpers/seed-commerce.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  organizationTreePath,
  organizationsOffTheirTree,
  staleReachGovernorRows,
} from '../../helpers/organization-tree.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';

/**
 * Issue #956 — the harness seeds organizations with the hierarchy paths the
 * organizations module itself writes.
 *
 * The tree reads `organizations.path` as a prefix, and the sales-representative
 * reach and the per-tree-root tax-ID scope both read it. A seed that leaves the
 * column's `''` default, or a child whose path does not extend its parent's,
 * makes every test above it exercise the unreadable-path fallback (#954)
 * instead of the normal path. So every organization the shared seeds write —
 * the default seed, the suspended tenant (the same id as the second tenant
 * `seedOtherTestOrganization` writes, so a file seeds one or the other), and an
 * ad-hoc tree three levels deep — is held to the shape the repair migration
 * derives from the `parent_id` chain, and the materialised reach-governor table
 * to a rebuild from scratch.
 */
describe('harness — seeded organizations carry real tree paths [real DB]', () => {
  let h: BackendServerHandle;
  const tree: { root?: string; branch?: string; leaf?: string } = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em().fork();
    await seedSuspendedOrganization(em);
    const root = await seedAdHocOrganization(em, 'Harness Tree Root');
    const branch = await seedAdHocOrganization(em, 'Harness Tree Branch', { parent: root });
    const leaf = await seedAdHocOrganization(em, 'Harness Tree Leaf', { parent: branch });
    Object.assign(tree, { root: root.id, branch: branch.id, leaf: leaf.id });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function stored(id: string): Promise<{ path: string; version: number }> {
    const rows = (await h
      .em()
      .getConnection()
      .execute('select "path", "version" from "organizations" where "id" = ?', [id])) as Array<{
      path: string;
      version: number;
    }>;
    return rows[0]!;
  }
  const storedPath = async (id: string): Promise<string> => (await stored(id)).path;

  it('stores a root path for each seeded tenant', async () => {
    for (const id of [TEST_ORGANIZATION_ID, TEST_SUSPENDED_ORGANIZATION_ID]) {
      expect(await storedPath(id), id).toBe(`/${id}/`);
    }
  });

  it('stores a child path that extends its parent path, on the first write', async () => {
    expect(await storedPath(tree.root!)).toBe(`/${tree.root}/`);
    expect(await storedPath(tree.branch!)).toBe(`/${tree.root}/${tree.branch}/`);
    expect(await storedPath(tree.leaf!)).toBe(`/${tree.root}/${tree.branch}/${tree.leaf}/`);
    // The root's version is that of a row never updated since its insert; the
    // children carry the same, so their path went in with the insert rather
    // than being patched over an `''` the reach-governor triggers had already
    // read.
    const inserted = (await stored(tree.root!)).version;
    for (const id of [tree.branch!, tree.leaf!]) expect((await stored(id)).version, id).toBe(inserted);
    expect(organizationTreePath(tree.leaf!, { path: `/${tree.root}/${tree.branch}/` })).toBe(
      `/${tree.root}/${tree.branch}/${tree.leaf}/`,
    );
  });

  it('leaves no organization whose path differs from the one its parent chain implies', async () => {
    expect(await organizationsOffTheirTree(h.em())).toEqual([]);
  });

  it('reads the seeded tree through the tree service, not the unreadable-path fallback', async () => {
    const service = new OrganizationTreeService(() => h.em());
    expect(new Set(await service.subtreeIds(tree.root!))).toEqual(new Set([tree.root, tree.branch, tree.leaf]));
    expect(await service.ancestorIds(tree.leaf!)).toEqual(expect.arrayContaining([tree.root, tree.branch]));
  });

  it('keeps the materialised reach-governor table equal to a rebuild', async () => {
    expect(await staleReachGovernorRows(h.orm.em)).toBe(0);
  });
});
