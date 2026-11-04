import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReturnCase } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, resetReturnGraph } from './helpers.js';
import {
  asMember,
  errorOf,
  fileCase,
  makeMember,
  makeOrganization,
  orderPlacedBy,
  releaseMembers,
  reparent,
  type ReturnsFixtureMember,
} from './organization-fixtures.js';

/**
 * `specs/170-organization-roles/` WP-14, T144 (FR-053, OR-11, Q-R2 = A; User
 * Story 9 scenarios 3 and 4; `contracts/migration-and-replay.md` §6.3).
 *
 * `returns.view_organization` widens the buyer's case list and case read
 * exactly as `orders.view_organization` widens orders: a holder sees every
 * case of the Organization — its subtree for a roll-up login, which the tenant
 * filter draws — and anyone else only the cases they filed. Out of reach is
 * `404 NOT_FOUND`, never `403` (Principle XI). *Administrator* holds the code.
 *
 * Seeing a colleague's case opens none of its follow-up actions (Q-R2 = A):
 * comments, attachments, the delivery method and cancelling stay the filer's
 * and answer `404 NOT_FOUND` to anyone else, the case unchanged.
 *
 *   ORG:            filer (Member), plain (Member), viewer (custom: both
 *                   `returns` codes), admin (Administrator);
 *   FOREIGN:        foreigner (Member);
 *   HEAD → BRANCH:  headViewer (custom: `returns.view_organization`, roll-up
 *                   on), headPlain (Member, roll-up on); branchFiler in BRANCH.
 */
describe('170 WP-14 — the Organization’s returns need returns.view_organization (FR-053)', () => {
  let h: BackendServerHandle;
  const m = {} as Record<
    'filer' | 'plain' | 'viewer' | 'admin' | 'foreigner' | 'headViewer' | 'headPlain' | 'branchFiler',
    ReturnsFixtureMember
  >;
  const cases = {} as Record<'colleague' | 'plain' | 'viewer' | 'admin' | 'foreign' | 'head' | 'branch', string>;
  let deliveryMethodId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await resetReturnGraph(em);
    const org = await makeOrganization(em, 'WP14 Visibility');
    const foreign = await makeOrganization(em, 'WP14 Visibility Foreign');
    const head = await makeOrganization(em, 'WP14 Head');
    const branch = await makeOrganization(em, 'WP14 Branch');
    await reparent(h, branch, head);

    m.filer = await makeMember(em, org, 'member', { label: 'Filer' });
    m.plain = await makeMember(em, org, 'member', { label: 'Plain' });
    m.viewer = await makeMember(em, org, { permissions: ['returns.create', 'returns.view_organization'] }, { label: 'Viewer' });
    m.admin = await makeMember(em, org, 'administrator', { label: 'Admin' });
    m.foreigner = await makeMember(em, foreign, 'member', { label: 'Foreigner' });
    m.headViewer = await makeMember(em, head, { permissions: ['returns.create', 'returns.view_organization'] }, {
      label: 'HeadViewer',
      rollup: true,
    });
    m.headPlain = await makeMember(em, head, 'member', { label: 'HeadPlain', rollup: true });
    m.branchFiler = await makeMember(em, branch, 'member', { label: 'BranchFiler' });

    cases.colleague = await fileCase(h, m.filer, await orderPlacedBy(em, m.filer));
    cases.plain = await fileCase(h, m.plain, await orderPlacedBy(em, m.plain));
    cases.viewer = await fileCase(h, m.viewer, await orderPlacedBy(em, m.viewer));
    cases.admin = await fileCase(h, m.admin, await orderPlacedBy(em, m.admin));
    cases.foreign = await fileCase(h, m.foreigner, await orderPlacedBy(em, m.foreigner));
    cases.head = await fileCase(h, m.headPlain, await orderPlacedBy(em, m.headPlain));
    cases.branch = await fileCase(h, m.branchFiler, await orderPlacedBy(em, m.branchFiler));

    const method = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/returns/delivery-methods',
      cookies: ADMIN_COOKIE,
      payload: { deliveryMethodId: randomUUID(), returnCost: 5, currency: 'PLN' },
    });
    expect(method.statusCode, method.body).toBe(201);
    deliveryMethodId = (method.json() as { data: { id: string } }).data.id;
  }, 120_000);

  afterAll(async () => {
    releaseMembers();
    await teardownBackendServer(h);
  });

  const ours = (): Set<string> => new Set(Object.values(cases));

  async function listed(member: ReturnsFixtureMember): Promise<Array<{ id: string; customerAccountId?: string }>> {
    const res = await asMember(h, member, 'GET', '/api/v1/returns');
    expect(res.statusCode, res.body).toBe(200);
    const rows = (res.json() as { data: Array<{ id: string; customerAccountId?: string }> }).data;
    const mine = ours();
    return rows.filter((r) => mine.has(r.id));
  }

  async function rowsOf(table: 'return_case_comments' | 'return_case_attachments', caseId: string): Promise<number> {
    const [row] = (await h.em().getConnection().execute(
      `select count(*)::int as "n" from "${table}" where "return_case_id" = ?`,
      [caseId],
    )) as Array<{ n: number }>;
    return row!.n;
  }

  const ids = (rows: Array<{ id: string }>) => new Set(rows.map((r) => r.id));

  describe('a member without returns.view_organization', () => {
    it('lists only the cases they filed', async () => {
      expect(ids(await listed(m.plain))).toEqual(new Set([cases.plain]));
      expect(ids(await listed(m.filer))).toEqual(new Set([cases.colleague]));
    });

    it('gets 404 NOT_FOUND on a colleague’s case', async () => {
      const res = await asMember(h, m.plain, 'GET', `/api/v1/returns/${cases.colleague}`);
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res)?.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('with roll-up on, still lists only their own: roll-up never adds a permission', async () => {
      expect(ids(await listed(m.headPlain))).toEqual(new Set([cases.head]));
      expect((await asMember(h, m.headPlain, 'GET', `/api/v1/returns/${cases.branch}`)).statusCode).toBe(404);
    });
  });

  for (const holder of ['viewer', 'admin'] as const) {
    describe(holder === 'viewer' ? 'a custom role holding returns.view_organization' : 'the Administrator', () => {
      it('lists every case of the Organization, and not the foreign one', async () => {
        expect(ids(await listed(m[holder]))).toEqual(
          new Set([cases.colleague, cases.plain, cases.viewer, cases.admin]),
        );
      });

      it('every summary names its filer (customerAccountId)', async () => {
        const byId = new Map((await listed(m[holder])).map((r) => [r.id, r.customerAccountId]));
        expect(byId.get(cases.colleague)).toBe(m.filer.id);
        expect(byId.get(cases.plain)).toBe(m.plain.id);
        expect(byId.get(cases.viewer)).toBe(m.viewer.id);
        expect(byId.get(cases.admin)).toBe(m.admin.id);
      });

      it('reads a colleague’s case (200)', async () => {
        const res = await asMember(h, m[holder], 'GET', `/api/v1/returns/${cases.colleague}`);
        expect(res.statusCode, res.body).toBe(200);
        expect((res.json() as { data: { customerAccountId: string } }).data.customerAccountId).toBe(m.filer.id);
      });

      it('gets 404 NOT_FOUND on another Organization’s case', async () => {
        const res = await asMember(h, m[holder], 'GET', `/api/v1/returns/${cases.foreign}`);
        expect(res.statusCode, res.body).toBe(404);
        expect(errorOf(res)?.code).toBe(ERROR_CODES.NOT_FOUND);
      });

      it('cannot act on the colleague’s case: comment, attachment, delivery method and cancel are 404, the case unchanged', async () => {
        const em = h.em();
        em.clear();
        const before = await em.findOneOrFail(ReturnCase, { id: cases.colleague }, { filters: false });
        const commentsBefore = await rowsOf('return_case_comments', cases.colleague);
        const attachmentsBefore = await rowsOf('return_case_attachments', cases.colleague);

        const attempts: Array<[string, object | undefined]> = [
          ['comments', { body: 'Not mine' }],
          ['attachments', { assetId: '00000000-0000-4000-8000-0000000170f2' }],
          ['select-delivery-method', { returnDeliveryMethodId: deliveryMethodId }],
          ['cancel', undefined],
        ];
        for (const [action, payload] of attempts) {
          const res = await asMember(h, m[holder], 'POST', `/api/v1/returns/${cases.colleague}/${action}`, payload);
          expect(res.statusCode, `${action}: ${res.body}`).toBe(404);
          expect(errorOf(res)?.code).toBe(ERROR_CODES.NOT_FOUND);
        }

        em.clear();
        const after = await em.findOneOrFail(ReturnCase, { id: cases.colleague }, { filters: false });
        expect(after.statusCode).toBe(before.statusCode);
        expect(after.returnDeliveryMethodId ?? null).toBe(before.returnDeliveryMethodId ?? null);
        expect(await rowsOf('return_case_comments', cases.colleague)).toBe(commentsBefore);
        expect(await rowsOf('return_case_attachments', cases.colleague)).toBe(attachmentsBefore);
      });
    });
  }

  describe('a roll-up login holding returns.view_organization', () => {
    it('lists and reads its subtree’s cases', async () => {
      expect(ids(await listed(m.headViewer))).toEqual(new Set([cases.head, cases.branch]));
      const res = await asMember(h, m.headViewer, 'GET', `/api/v1/returns/${cases.branch}`);
      expect(res.statusCode, res.body).toBe(200);
    });

    it('still gets 404 outside the subtree', async () => {
      const res = await asMember(h, m.headViewer, 'GET', `/api/v1/returns/${cases.colleague}`);
      expect(res.statusCode, res.body).toBe(404);
    });
  });
});
