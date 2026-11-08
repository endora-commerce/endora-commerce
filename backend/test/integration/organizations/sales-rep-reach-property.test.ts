import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { SalesRepAssignmentService } from '../../../../packages/modules/organizations/src/backend/services/sales-rep-assignment-service.js';

/**
 * Issue #305 — the reach rule exists once.
 *
 * The tenant scope describes a sales representative's reach by its complement,
 * the organizations governed by somebody else (`reachOf(rep).excludedOrganizationIds`),
 * computed in one statement. The one-id question stays `canSeeOrganization`.
 * The guarantee that they are **one** rule is this property: for every node of
 * the fixture tree, every representative, flat and roll-up,
 *
 *     canSeeOrganization(rep, id) === !excluded(rep).includes(id)
 *
 * The fixture holds every governance shape the rule distinguishes:
 *
 *     a   (R)              ab (R, S)          s  (S)            u (nobody)
 *     ├── ac (nobody)                         ├── sc (nobody)
 *     └── rs (S)                              └── sr (R)
 *         └── rsc (nobody)                        └── src (nobody)
 */
let seq = 0;
async function node(em: EntityManager, label: string, parent?: Organization): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name: `R305P ${label}`,
    taxId: `PL305P${String(seq).padStart(4, '0')}${Date.now().toString().slice(-6)}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    ...(parent ? { parentId: parent.id } : {}),
  });
  await em.persistAndFlush(org);
  org.path = `${parent ? parent.path : '/'}${org.id}/`;
  await em.flush();
  return org;
}

describe('#305 — canSeeOrganization and the excluded set are one rule', () => {
  let h: BackendServerHandle;
  let svc: SalesRepAssignmentService;
  const rollup = new Set<string>();
  const R = randomUUID();
  const S = randomUUID();
  const T = randomUUID(); // assigned to nothing
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new SalesRepAssignmentService(h.em, undefined, {
      treeService: new OrganizationTreeService(h.em),
      hasRollupCapability: async (adminUserId) => rollup.has(adminUserId),
    });
    const em = h.em();
    const a = await node(em, 'a');
    const ac = await node(em, 'ac', a);
    const rs = await node(em, 'rs', a);
    const rsc = await node(em, 'rsc', rs);
    const ab = await node(em, 'ab');
    const s = await node(em, 's');
    const sc = await node(em, 'sc', s);
    const sr = await node(em, 'sr', s);
    const src = await node(em, 'src', sr);
    const u = await node(em, 'u');
    Object.assign(ids, {
      a: a.id, ac: ac.id, rs: rs.id, rsc: rsc.id, ab: ab.id, s: s.id, sc: sc.id, sr: sr.id, src: src.id, u: u.id,
    });
    const assign = (organizationId: string, adminUserId: string) =>
      em.create(OrganizationSalesRepAssignment, { organizationId, adminUserId });
    assign(a.id, R);
    assign(ab.id, R);
    assign(ab.id, S);
    assign(rs.id, S);
    assign(s.id, S);
    assign(sr.id, R);
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    await h
      .em()
      .getConnection()
      .execute('delete from organization_sales_rep_assignments where admin_user_id in (?, ?)', [R, S]);
    await teardownBackendServer(h);
  });

  const setRollup = (on: boolean): void => {
    for (const rep of [R, S, T]) (on ? rollup.add(rep) : rollup.delete(rep));
  };

  /** Who sees which node, by the rule (§0 of the #305 design). */
  const EXPECTED: Record<'flat' | 'rollup', Record<string, Record<string, boolean>>> = {
    flat: {
      R: { a: true, ac: true, rs: false, rsc: true, ab: true, s: false, sc: true, sr: true, src: true, u: true },
      S: { a: false, ac: true, rs: true, rsc: true, ab: true, s: true, sc: true, sr: false, src: true, u: true },
      T: { a: false, ac: true, rs: false, rsc: true, ab: false, s: false, sc: true, sr: false, src: true, u: true },
    },
    rollup: {
      R: { a: true, ac: true, rs: false, rsc: false, ab: true, s: false, sc: false, sr: true, src: true, u: true },
      S: { a: false, ac: false, rs: true, rsc: true, ab: true, s: true, sc: true, sr: false, src: false, u: true },
      T: { a: false, ac: false, rs: false, rsc: false, ab: false, s: false, sc: false, sr: false, src: false, u: true },
    },
  };
  const REPS = { R, S, T } as const;

  describe.each(['flat', 'rollup'] as const)('%s', (mode) => {
    beforeAll(() => setRollup(mode === 'rollup'));

    it.each(['R', 'S', 'T'] as const)('canSeeOrganization for %s follows the rule', async (rep) => {
      const seen: Record<string, boolean> = {};
      for (const key of Object.keys(ids)) seen[key] = await svc.canSeeOrganization(REPS[rep], ids[key]!);
      expect(seen).toEqual(EXPECTED[mode][rep]);
    });

    it.each(['R', 'S', 'T'] as const)('the excluded set for %s is exactly the complement', async (rep) => {
      const { excludedOrganizationIds } = await svc.reachOf(REPS[rep]);
      const excluded = new Set(excludedOrganizationIds);
      for (const key of Object.keys(ids)) {
        const id = ids[key]!;
        expect(!excluded.has(id), `${rep} ${mode} ${key}`).toBe(await svc.canSeeOrganization(REPS[rep], id));
      }
    });

    it.each(['R', 'S', 'T'] as const)('the assigned set for %s is the reach it governs', async (rep) => {
      const { assignedOrganizationIds } = await svc.reachOf(REPS[rep]);
      const mine = new Set(assignedOrganizationIds);
      const governed = Object.keys(ids).filter((key) => mine.has(ids[key]!)).sort();
      const expected =
        mode === 'flat'
          ? { R: ['a', 'ab', 'sr'], S: ['ab', 'rs', 's'], T: [] }[rep]
          : { R: ['a', 'ab', 'ac', 'sr', 'src'], S: ['ab', 'rs', 'rsc', 's', 'sc'], T: [] }[rep];
      expect(governed).toEqual([...expected].sort());
      expect(await svc.listAssignedOrganizationIds(REPS[rep])).toEqual(expect.arrayContaining(assignedOrganizationIds));
    });
  });

  it('the excluded set never names a personal organization (they cannot be assigned)', async () => {
    setRollup(true);
    const { excludedOrganizationIds } = await svc.reachOf(T);
    if (excludedOrganizationIds.length === 0) return;
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ n: string }>>(
        'select count(*)::text as n from organizations where is_personal and id = any(?::uuid[])',
        [`{${excludedOrganizationIds.join(',')}}`],
      );
    expect(rows[0]!.n).toBe('0');
  });
});
