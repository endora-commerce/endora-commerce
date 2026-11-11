import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type TaxIdScope } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TaxIdScopeService } from '../../../../packages/modules/organizations/src/backend/services/tax-id-scope-service.js';
import { makeSetTaxIdScopeCommand } from '../../../../packages/modules/organizations/src/backend/commands/set-tax-id-scope.command.js';
import { makeSetParentCommand } from '../../../../packages/modules/organizations/src/backend/commands/set-parent.command.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { runOrganizationWrite } from '../../../../packages/modules/organizations/src/backend/services/organization-write.js';
import { taxIdSharedAcrossTreesRefusal } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';

/**
 * `specs/177-tax-id-scope/` T034, T036, T038 (FR-021, FR-022, SC-003) — the
 * database is the guarantee; the pre-checks only make the refusal readable. Two
 * writes that each pass their pre-check race to the database, and the loser
 * must be the same 409 the pre-check gives, never a 500 — in `global` from the
 * unique constraint at the statement, in `per-tree-root` from the deferred
 * exclusion constraint at commit.
 *
 * The deadlock this file found — the reach governor's lock against the
 * deferred constraint — is what `organizations_tax_id_write_lock` removes.
 *
 * Every case runs in both scopes: the file sets each through the Command and
 * puts the one it found back at the end, once its shared tax IDs are unique
 * again.
 */
describe('tax-ID conflicts under concurrency', () => {
  let h: BackendServerHandle;
  let scopes: TaxIdScopeService;
  let initial: TaxIdScope;
  let channelId: string;
  const PAIRS = 50;

  const bus = () =>
    (h.container.cradle as unknown as { commandBus: { run<T>(command: Command<T>): Promise<T> } }).commandBus;

  const setScope = (scope: TaxIdScope) => bus().run(makeSetTaxIdScopeCommand({ scopes }, { scope }));

  async function uniquifySharedTaxIds(): Promise<void> {
    // Every row of this file's prefix that shares its tax ID gets one of its own.
    await h.em().fork().getConnection().execute(
      `update "organizations" o set "tax_id" = 'R' || upper(substr(replace(o."id"::text, '-', ''), 1, 31))
        where o."tax_id" like 'CC%'
          and exists (select 1 from "organizations" d where d."tax_id" = o."tax_id" and d."id" <> o."id")`,
    );
  }

  const createBody = (taxId: string, parentId?: string) => ({
    name: `Concurrent ${taxId}`,
    taxId,
    registeredAddress: { street: 'ul. Wyścigowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    salesChannelIds: [channelId],
    ...(parentId ? { parentId } : {}),
  });

  const adminCreate = (payload: object) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      cookies: { b2b_session: 'stub-admin-session' },
      payload,
    });

  const register = (taxId: string, n: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        organization: {
          name: `Concurrent registration ${n}`,
          taxId,
          registeredAddress: { street: 'ul. Wyścigowa 2', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
        },
        firstUser: {
          email: `cc-${taxId.toLowerCase()}-${n}@race.example`,
          password: 'a-very-strong-password-123!',
          firstName: 'Race',
          lastName: `No${n}`,
        },
        acceptedTermsVersion: '1.0.0',
      },
    });

  const ccTaxId = (): string => `CC${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    scopes = new TaxIdScopeService(() => h.em().fork() as EntityManager);
    initial = await scopes.scope();
    const channel = await h.em().fork().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
  });

  afterEach(async () => {
    await uniquifySharedTaxIds();
    if ((await scopes.scope()) !== initial) await setScope(initial);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  for (const scope of ['global', 'per-tree-root'] as const) {
    describe(`in ${scope}`, () => {
      it(`admin create: ${PAIRS} racing pairs of one new tax ID — one 201, one 409 each, no 500`, async () => {
        await setScope(scope);
        // Pair after pair, each pair at once: two writers racing for one tax ID,
        // not a hundred transactions racing for the harness's connection pool.
        const outcomes: Array<Array<{ status: number; code: string | undefined }>> = [];
        for (let i = 0; i < PAIRS; i += 1) {
          const taxId = ccTaxId();
          const pair = await Promise.all([adminCreate(createBody(taxId)), adminCreate(createBody(taxId))]);
          outcomes.push(pair.map((res) => ({ status: res.statusCode, code: (res.json() as { error?: { code: string } }).error?.code })));
        }
        for (const pair of outcomes) {
          expect(pair.map((o) => o.status).sort()).toEqual([201, 409]);
          expect(pair.find((o) => o.status === 409)?.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
        }
      }, 300_000);

      it(`registration: ${PAIRS} racing registrations of one tax ID — one 201, the rest 409, no 500`, async () => {
        await setScope(scope);
        const taxId = ccTaxId();
        const results = await Promise.all(Array.from({ length: PAIRS }, (_, n) => register(taxId, n)));
        const statuses = results.map((res) => res.statusCode);
        expect(statuses.filter((status) => status === 201)).toHaveLength(1);
        expect(statuses.filter((status) => status === 409)).toHaveLength(PAIRS - 1);
        for (const res of results.filter((r) => r.statusCode === 409)) {
          expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
        }
      }, 300_000);

      it('registration refuses a tax ID held only by a branch (FR-022)', async () => {
        await setScope(scope);
        const head = await adminCreate(createBody(ccTaxId()));
        expect(head.statusCode, head.body).toBe(201);
        const branchTaxId = ccTaxId();
        const branch = await adminCreate(createBody(branchTaxId, (head.json() as { data: { id: string } }).data.id));
        expect(branch.statusCode, branch.body).toBe(201);
        const res = await register(branchTaxId, 0);
        expect(res.statusCode, res.body).toBe(409);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
      });
    });
  }

  describe('in per-tree-root, the commit-time backstop', () => {
    it(`admin create: ${PAIRS} racing pairs of a branch and a new root over one fresh tax ID — one 201, one 409, no 500`, async () => {
      await setScope('per-tree-root');
      const outcomes: number[][] = [];
      for (let i = 0; i < PAIRS; i += 1) {
        const taxId = ccTaxId();
        const head = await adminCreate(createBody(ccTaxId()));
        const headId = (head.json() as { data: { id: string } }).data.id;
        // Two would-be holders of a fresh tax ID: a branch of the head, and a root.
        const pair = await Promise.all([adminCreate(createBody(taxId, headId)), adminCreate(createBody(taxId))]);
        outcomes.push(pair.map((res) => res.statusCode));
      }
      for (const pair of outcomes) expect([...pair].sort()).toEqual([201, 409]);
    }, 300_000);

    it('a move whose pre-check is skipped is still refused at commit with the tree refusal', async () => {
      await setScope('per-tree-root');
      const head = await adminCreate(createBody(ccTaxId()));
      const headData = (head.json() as { data: { id: string; taxId: string } }).data;
      const branch = await adminCreate(createBody(headData.taxId, headData.id));
      expect(branch.statusCode, branch.body).toBe(201);
      const branchId = (branch.json() as { data: { id: string } }).data.id;

      class NoPreCheck extends OrganizationTreeService {
        override async assertTaxIdsStayInOneTree(): Promise<void> {}
      }
      const tree = new NoPreCheck(() => h.em().fork() as EntityManager);
      const refusal = await runOrganizationWrite(
        bus(),
        makeSetParentCommand({ tree }, { organizationId: branchId, parentId: null }),
        () => taxIdSharedAcrossTreesRefusal([]),
      ).catch((err: unknown) => err);
      expect(refusal).toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.ORGANIZATION_TREE_INVALID,
        details: { code: 'tax_id_shared_across_trees' },
      });
      const [row] = (await h.em().fork().getConnection().execute(
        'select "parent_id" from "organizations" where "id" = ?',
        [branchId],
      )) as Array<{ parent_id: string | null }>;
      expect(row!.parent_id).toBe(headData.id);
    });
  });

  /**
   * T041c (D-290 / OD-10) — moves take part in the lock order too. A move
   * rewrites `path`, which moves `root_id` and takes the reach governor's lock
   * without touching `tax_id`; the tree Command therefore locks its subtree's
   * tax IDs, ascending, before the rewrite.
   */
  describe('moves racing other writers', () => {
    const reparent = (id: string, parentId: string | null) =>
      h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${id}/parent`,
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { parentId },
      });
    const idOf = (res: { json(): unknown }) => (res.json() as { data: { id: string } }).data.id;
    const codeOf = (res: { json(): unknown }) => (res.json() as { error?: { code: string } }).error?.code;

    for (const scope of ['global', 'per-tree-root'] as const) {
      it(`${scope}: ${PAIRS} racing pairs of (create X in tree A) × (move a subtree holding X into tree B) — never a 500`, async () => {
        await setScope(scope);
        for (let i = 0; i < PAIRS; i += 1) {
          const taxId = ccTaxId();
          const rootA = idOf(await adminCreate(createBody(ccTaxId())));
          const holder = await adminCreate(createBody(taxId, rootA));
          expect(holder.statusCode, holder.body).toBe(201);
          const rootB = idOf(await adminCreate(createBody(ccTaxId())));
          const [create, move] = await Promise.all([
            adminCreate(createBody(taxId, rootA)),
            reparent(idOf(holder), rootB),
          ]);
          const statuses = [create.statusCode, move.statusCode];
          expect(statuses, `${create.body} | ${move.body}`).not.toContain(500);
          if (scope === 'global') {
            // X is already held: the creation is refused whatever the move does.
            expect(create.statusCode).toBe(409);
            expect(codeOf(create)).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
            expect(move.statusCode).toBe(200);
          } else {
            // Exactly one of the two may land; the loser answers its own path's 409.
            expect(statuses.filter((status) => status === 409)).toHaveLength(1);
            if (create.statusCode === 409) expect(codeOf(create)).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
            if (move.statusCode === 409) expect(codeOf(move)).toBe(ERROR_CODES.ORGANIZATION_TREE_INVALID);
          }
        }
      }, 600_000);
    }

    // Two moves sharing two tax IDs need a tree that shares them, which only
    // `per-tree-root` allows; in `global` the state does not exist.
    it(`per-tree-root: ${PAIRS} racing pairs of moves inside one tree whose subtrees hold the same two tax IDs in opposite order — never a 500`, async () => {
      await setScope('per-tree-root');
      for (let i = 0; i < PAIRS; i += 1) {
        const [x, y] = [ccTaxId(), ccTaxId()].sort();
        const root = idOf(await adminCreate(createBody(ccTaxId())));
        const p = idOf(await adminCreate(createBody(x!, root)));
        await adminCreate(createBody(y!, p));
        const q = idOf(await adminCreate(createBody(y!, root)));
        await adminCreate(createBody(x!, q));
        const m = idOf(await adminCreate(createBody(ccTaxId(), root)));
        const n = idOf(await adminCreate(createBody(ccTaxId(), root)));
        const results = await Promise.all([reparent(p, m), reparent(q, n)]);
        expect(results.map((res) => res.statusCode), results.map((res) => res.body).join(' | ')).toEqual([200, 200]);
      }
    }, 600_000);
  });

  /**
   * Review finding 2 — the scope swap took `share row exclusive` and then needed
   * `access exclusive` for its `ALTER TABLE`: a lock upgrade a concurrent writer
   * could deadlock (`40P01`), answered 500. Every party now answers a 2xx or a
   * 409, whichever loses.
   */
  it('scope swaps racing creations answer 2xx or 409, never 500', async () => {
    const put = (scope: TaxIdScope) =>
      h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/organizations/tax-id-scope',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { scope },
      });
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const target: TaxIdScope = i % 2 === 0 ? 'per-tree-root' : 'global';
      const results = await Promise.all([
        adminCreate(createBody(ccTaxId())),
        put(target),
        adminCreate(createBody(ccTaxId())),
        register(ccTaxId(), i),
      ]);
      for (const res of results) {
        statuses.push(res.statusCode);
        expect(res.statusCode, res.body).not.toBeGreaterThanOrEqual(500);
      }
    }
    expect(statuses.every((status) => status < 300 || status === 409)).toBe(true);
  }, 600_000);
});
