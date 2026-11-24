import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  QUOTE_REQUEST_HOOKABLE_ACTIONS,
  defineModuleErrorCodes,
  type QuoteRequestShareHookData,
} from '@endora-commerce/contracts';
import { CommandBus, CommandHookRefusal, type CommandHookEntry } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import { sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { manifest } from '../../../../packages/modules/quote_requests/src/manifest.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const QR = '/api/v1/admin/quote-requests';
/** The hook module, as a deployment's overlay would register it. */
const HOOK_MODULE = 'acme_approvals';
const ACME = defineModuleErrorCodes(['TEST_VETO']);

/**
 * `specs/192-quote-request-draft-share/` T020 (FR-028, US2 #6,
 * `contracts/share-hook.md` §2, §5) — another module refuses a share through
 * the hookable action `quote_request.share`.
 *
 * The composed `RfqAdminService` runs the share on a Command Bus whose hook
 * registry holds a test hook module on `QUOTE_REQUEST_HOOKABLE_ACTIONS.share`,
 * as `test/integration/newsletter/hookable-actions.test.ts` wires one; the
 * route is the operator's. A veto answers the hook's own status, code and
 * details and rolls everything back: the quote stays unshared, with no
 * `shared` entry, no audit row and no notification record. A passing hook
 * sees the uncommitted share and the date it is writing. A hook module that
 * is off is skipped.
 */
describe('quote_request.share — a hook module may refuse a share', () => {
  let h: BackendServerHandle;
  let original: unknown;

  interface AdminDeps {
    commandBus: unknown;
  }
  const adminDeps = (): AdminDeps =>
    (h.container.resolve('quoteRequests') as { handle(): { adminService: { deps: AdminDeps } } }).handle().adminService.deps;

  const scalar = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await h.em().fork().execute<Array<{ n: string }>>(sql, params))[0]!.n);

  function withHook(options: { veto?: boolean; present?: boolean } = {}) {
    const seen: Array<{ data: QuoteRequestShareHookData; sharedInTransaction: boolean; objectId: string }> = [];
    const entry: CommandHookEntry = {
      id: 'approval-gate',
      on: QUOTE_REQUEST_HOOKABLE_ACTIONS.share,
      phase: 'beforeCommit',
      handler: async (ctx) => {
        const [row] = await ctx.em.execute<Array<{ shared_with_customer: boolean }>>(
          `select "shared_with_customer" from "quote_requests" where "id" = ?`,
          [ctx.objectId],
        );
        seen.push({ data: ctx.data as QuoteRequestShareHookData, sharedInTransaction: row?.shared_with_customer === true, objectId: ctx.objectId });
        if (options.veto) {
          throw new CommandHookRefusal(409, ACME.TEST_VETO, 'An approval is still pending.', { approval: 'pending' });
        }
      },
    };
    const registry = sealedCommandHookRegistry({
      hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'quote_requests', ...declaration })),
      moduleDependencies: { [HOOK_MODULE]: ['quote_requests'] },
      hooks: [{ moduleId: HOOK_MODULE, entries: [entry] }],
      isPresent: (moduleId) => moduleId !== HOOK_MODULE || options.present !== false,
    });
    adminDeps().commandBus = new CommandBus(h.orm, h.auditLogService, new EventBus(), { hooks: registry });
    return seen;
  }

  async function draft(expiresInDays?: number): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: QR,
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 9 }],
        ...(expiresInDays !== undefined ? { expiresInDays } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  const share = (id: string) => h.app.inject({ method: 'POST', url: `${QR}/${id}/share`, cookies: ADMIN });

  beforeAll(async () => {
    h = await setupBackendServer();
    original = adminDeps().commandBus;
  }, 120_000);

  afterEach(() => {
    adminDeps().commandBus = original;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a veto answers the hook’s own refusal and leaves the quote unshared, with nothing recorded', async () => {
    const seen = withHook({ veto: true });
    const id = await draft();

    const res = await share(id);

    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string; details: unknown } }).error).toMatchObject({
      code: 'TEST_VETO',
      details: { approval: 'pending' },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sharedInTransaction).toBe(true);
    expect(await scalar(`select count(*) as "n" from "quote_requests" where "id" = ? and "shared_with_customer"`, [id])).toBe(0);
    expect(await scalar(`select count(*) as "n" from "quote_request_events" where "quote_request_id" = ? and "event_type" = 'shared'`, [id])).toBe(0);
    expect(await scalar(`select count(*) as "n" from "audit_log_entries" where "object_id" = ? and "action" = 'quote_request.share'`, [id])).toBe(0);
    expect(await scalar(`select count(*) as "n" from "quote_request_notifications" where "quote_request_id" = ?`, [id])).toBe(0);
  });

  it('a passing hook sees the uncommitted share and the date it writes; the share commits', async () => {
    const seen = withHook();
    const id = await draft(5);

    const res = await share(id);

    expect(res.statusCode, res.body).toBe(200);
    const expiresAt = (res.json() as { data: { expiresAt: string } }).data.expiresAt;
    expect(seen).toEqual([
      {
        objectId: id,
        sharedInTransaction: true,
        data: {
          quoteRequestId: id,
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          salesChannelId: expect.any(String),
          currentRevisionNumber: 1,
          expiresAt,
        },
      },
    ]);
    expect(await scalar(`select count(*) as "n" from "quote_request_notifications" where "quote_request_id" = ?`, [id])).toBe(3);
  });

  it('a hook module that is off is skipped', async () => {
    const seen = withHook({ veto: true, present: false });
    const id = await draft();
    const res = await share(id);
    expect(res.statusCode, res.body).toBe(200);
    expect(seen).toEqual([]);
  });
});
