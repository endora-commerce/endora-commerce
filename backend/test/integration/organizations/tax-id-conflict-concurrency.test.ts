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
      `update "organizations" o set "tax_id" = 'R' || substr(replace(o."id"::text, '-', ''), 1, 31)
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
});
