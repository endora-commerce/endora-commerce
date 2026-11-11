import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type OrganizationCommandPort, type TaxIdScope } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { makeChangeTaxIdCommand } from '../../../../packages/modules/organizations/src/backend/commands/change-tax-id.command.js';
import { makeSetTaxIdScopeCommand } from '../../../../packages/modules/organizations/src/backend/commands/set-tax-id-scope.command.js';
import { TaxIdScopeService } from '../../../../packages/modules/organizations/src/backend/services/tax-id-scope-service.js';
import { runOrganizationWrite, taxIdExistsRefusal } from '../../../../packages/modules/organizations/src/backend/services/organization-write.js';

/**
 * Issue #1040 — `organization.tax_id.change` through the real bus, the route
 * and `organizationCommandPort` against the database, in both tax-ID scopes:
 * the correction in place, the refusals, the same-value no-op, the conflict
 * in each scope (a soft-deleted holder included, D-290 / OD-8), racing pairs,
 * the way back to `global` once a mistakenly shared tax ID is corrected, the
 * event and the names-only audit.
 */
describe('organization.tax_id.change', () => {
  let h: BackendServerHandle;
  let scopes: TaxIdScopeService;
  let initial: TaxIdScope;
  let channelId: string;
  const PAIRS = 50;

  const cradle = () =>
    h.container.cradle as unknown as { commandBus: { run<T>(command: Command<T>): Promise<T> } };

  async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T> {
    return h.em().fork().getConnection().execute(statement, params) as Promise<T>;
  }

  /** Normalised, unique, and recognisable by `afterEach`. */
  const tx = (): string => `TX${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;

  const setScope = (scope: TaxIdScope) => cradle().commandBus.run(makeSetTaxIdScopeCommand({ scopes }, { scope }));

  const change = (organizationId: string, taxId: string) =>
    runOrganizationWrite(cradle().commandBus, makeChangeTaxIdCommand({ organizationId, input: { taxId } }), () =>
      taxIdExistsRefusal(),
    );

  const changeRoute = (organizationId: string, payload: object) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organizationId}/change-tax-id`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload,
    });

  /** A company organization, a root or a branch, as admin create leaves it. */
  async function company(
    options: { taxId?: string; parentId?: string; deleted?: boolean; validated?: boolean } = {},
  ): Promise<{ id: string; taxId: string }> {
    const id = randomUUID();
    const taxId = options.taxId ?? tx();
    let path = `/${id}/`;
    if (options.parentId) {
      const [parent] = await sql<Array<{ path: string }>>('select "path" from "organizations" where "id" = ?', [options.parentId]);
      path = `${parent!.path}${id}/`;
    }
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","parent_id",
          "vat_validated_at","vat_validation_provider","vat_validation_outcome","deleted_at","created_at","updated_at")
       values (?, 'Change Co', ?, 'active', 'vat_payer', false,
               '{"street":"ul. Prosta 1","city":"Łódź","postalCode":"90-001","country":"PL"}'::jsonb, ?, ?,
               ?, ?, ?, ?, now(), now())`,
      [
        id,
        taxId,
        path,
        options.parentId ?? null,
        options.validated ? new Date() : null,
        options.validated ? 'mf_pl' : null,
        options.validated ? 'validated' : null,
        options.deleted ? new Date() : null,
      ],
    );
    return { id, taxId };
  }

  async function row(id: string) {
    const [found] = await sql<
      Array<{
        id: string;
        tax_id: string | null;
        vat_status: string;
        vat_validated_at: Date | null;
        vat_validation_provider: string | null;
        vat_validation_outcome: string | null;
        version: number;
      }>
    >('select * from "organizations" where "id" = ?', [id]);
    return found!;
  }

  const auditsOf = (id: string) =>
    sql<Array<{ action: string; state_before: unknown; state_after: Record<string, unknown> }>>(
      `select "action", "state_before", "state_after" from "audit_log_entries"
        where "action" = 'organization.tax_id.change' and "object_id" = ?`,
      [id],
    );

  function listen(): { events: Array<Record<string, unknown>>; off: () => void } {
    const events: Array<Record<string, unknown>> = [];
    const off = (h.eventBus as unknown as { on(n: string, f: (p: unknown) => void): () => void }).on(
      'organization.tax_id_changed.v1',
      (payload) => events.push(payload as Record<string, unknown>),
    );
    return { events, off };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    scopes = new TaxIdScopeService(() => h.em().fork() as EntityManager);
    initial = await scopes.scope();
    channelId = (await h.em().fork().findOneOrFail(SalesChannel, { systemDefault: true })).id;
  });

  afterEach(async () => {
    // Every row of this file's prefix that shares its tax ID gets one of its
    // own, so the scope the file found can be put back.
    await sql(
      `update "organizations" o set "tax_id" = 'R' || upper(substr(replace(o."id"::text, '-', ''), 1, 31))
        where o."tax_id" like 'TX%'
          and exists (select 1 from "organizations" d where d."tax_id" = o."tax_id" and d."id" <> o."id")`,
    );
    if ((await scopes.scope()) !== initial) await setScope(initial);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('corrects the tax ID in place: same id, members, roles and orders; VAT validation reset, VAT status kept', async () => {
    const org = await company({ validated: true });
    const accountId = randomUUID();
    await sql(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Ewa', 'Zmiana', now(), now())`,
      [accountId, org.id, `${accountId.slice(0, 8)}@change-tax-id.example`],
    );
    const rolesBefore = await sql<Array<{ id: string }>>(
      'select "id" from "organization_roles" where "organization_id" = ? order by "id"',
      [org.id],
    );
    const orderId = randomUUID();
    await sql(
      `insert into "orders" (
         "id", "organization_id", "placed_by_customer_account_id", "sales_channel_id", "status",
         "delivery_address", "billing_address", "delivery_method_id", "delivery_method_snapshot",
         "payment_method_id", "payment_method_snapshot", "subtotal", "tax_total", "delivery_total",
         "total", "currency", "placed_at", "created_at", "updated_at", "business_id")
       values (?, ?, ?, ?, 'placed', '{}', ?::jsonb, ?, '{}', ?, '{}', 10, 0, 0, 10, 'PLN', now(), now(), now(), ?)`,
      [orderId, org.id, accountId, channelId, JSON.stringify({ taxId: org.taxId }), randomUUID(), randomUUID(), `1040-${orderId}`],
    );

    const next = tx();
    const result = await change(org.id, `${next.slice(0, 4).toLowerCase()} ${next.slice(4, 9)}-${next.slice(9)}`);

    expect(result).toMatchObject({ changed: true });
    expect(result.organization.id).toBe(org.id);
    expect(await row(org.id)).toMatchObject({
      tax_id: next,
      vat_status: 'vat_payer',
      vat_validated_at: null,
      vat_validation_provider: null,
      vat_validation_outcome: null,
    });
    const [member] = await sql<Array<{ organization_id: string }>>(
      'select "organization_id" from "customer_accounts" where "id" = ?',
      [accountId],
    );
    expect(member!.organization_id).toBe(org.id);
    expect(
      await sql('select "id" from "organization_roles" where "organization_id" = ? order by "id"', [org.id]),
    ).toEqual(rolesBefore);
    // Historic documents are not rewritten: the order keeps the billing tax ID it was placed with.
    const [order] = await sql<Array<{ organization_id: string; billing_address: { taxId: string } }>>(
      'select "organization_id", "billing_address" from "orders" where "id" = ?',
      [orderId],
    );
    expect(order).toMatchObject({ organization_id: org.id, billing_address: { taxId: org.taxId } });
  });

  it('changes nothing, audits nothing and emits nothing for the same value after normalisation', async () => {
    const org = await company({ validated: true });
    const before = await row(org.id);
    const { events, off } = listen();
    const result = await change(org.id, `${org.taxId.slice(0, 5)}-${org.taxId.slice(5).toLowerCase()}`);
    off();
    expect(result.changed).toBe(false);
    expect(await row(org.id)).toEqual(before);
    expect(await auditsOf(org.id)).toEqual([]);
    expect(events.filter((event) => event['organizationId'] === org.id)).toEqual([]);
  });

  it('refuses a personal organization, a deleted one, and answers 404 for an unknown one', async () => {
    const personalId = randomUUID();
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
       values (?, 'Jan Osobisty', null, 'active', 'vat_exempt', true, ?, '{}'::jsonb, ?, now(), now())`,
      [personalId, randomUUID(), `/${personalId}/`],
    );
    await expect(change(personalId, tx())).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ORGANIZATION_TAX_ID_CHANGE_REFUSED,
      details: { code: 'not_company' },
    });
    const deleted = await company({ deleted: true });
    await expect(change(deleted.id, tx())).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ORGANIZATION_TAX_ID_CHANGE_REFUSED,
      details: { code: 'deleted' },
    });
    expect((await row(deleted.id)).tax_id).toBe(deleted.taxId);
    await expect(change(randomUUID(), tx())).rejects.toMatchObject({ statusCode: 404 });
  });

  for (const scope of ['global', 'per-tree-root'] as const) {
    describe(`in ${scope}`, () => {
      it('refuses a tax ID another tree holds, a soft-deleted holder included, with ORGANIZATION_TAX_ID_EXISTS', async () => {
        await setScope(scope);
        const org = await company();
        const live = await company();
        const deleted = await company({ deleted: true });
        for (const holder of [live, deleted]) {
          await expect(change(org.id, holder.taxId)).rejects.toMatchObject({
            statusCode: 409,
            code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
          });
          const res = await changeRoute(org.id, { taxId: holder.taxId });
          expect(res.statusCode, res.body).toBe(409);
          expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
        }
        expect((await row(org.id)).tax_id).toBe(org.taxId);
      });

      it(`${scope === 'global' ? 'refuses' : 'allows'} the head office's tax ID on a branch`, async () => {
        await setScope(scope);
        const head = await company();
        const branch = await company({ parentId: head.id });
        if (scope === 'global') {
          await expect(change(branch.id, head.taxId)).rejects.toMatchObject({ code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS });
        } else {
          await expect(change(branch.id, head.taxId)).resolves.toMatchObject({ changed: true });
          expect((await row(branch.id)).tax_id).toBe(head.taxId);
        }
      });

      it(`${PAIRS} racing pairs of two trees changing to one new tax ID — one 200, one 409 each, no 500`, async () => {
        await setScope(scope);
        const outcomes: Array<Array<{ status: number; code: string | undefined }>> = [];
        for (let i = 0; i < PAIRS; i += 1) {
          const [a, b] = [await company(), await company()];
          const taxId = tx();
          const pair = await Promise.all([changeRoute(a.id, { taxId }), changeRoute(b.id, { taxId })]);
          outcomes.push(pair.map((res) => ({ status: res.statusCode, code: (res.json() as { error?: { code: string } }).error?.code })));
        }
        for (const pair of outcomes) {
          expect(pair.map((o) => o.status).sort()).toEqual([200, 409]);
          expect(pair.find((o) => o.status === 409)?.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
        }
      }, 300_000);

      it(`${PAIRS} racing pairs of (create a root with X) × (change another root to X) — one wins, no 500`, async () => {
        await setScope(scope);
        for (let i = 0; i < PAIRS; i += 1) {
          const org = await company();
          const taxId = tx();
          const [create, changed] = await Promise.all([
            h.app.inject({
              method: 'POST',
              url: '/api/v1/admin/organizations',
              cookies: { b2b_session: 'stub-admin-session' },
              payload: {
                name: `Race ${taxId}`,
                taxId,
                registeredAddress: { street: 'ul. Wyścigowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
                salesChannelIds: [channelId],
              },
            }),
            changeRoute(org.id, { taxId }),
          ]);
          const statuses = [create.statusCode, changed.statusCode];
          expect(statuses, `${create.body} | ${changed.body}`).not.toContain(500);
          expect(statuses.filter((status) => status === 409)).toHaveLength(1);
          for (const res of [create, changed].filter((r) => r.statusCode === 409)) {
            expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS);
          }
        }
      }, 300_000);
    });
  }

  it('lets the scope go back to global once every mistakenly shared tax ID is corrected', async () => {
    await setScope('per-tree-root');
    const head = await company();
    const branch = await company({ parentId: head.id, taxId: head.taxId });
    const put = () =>
      h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/organizations/tax-id-scope',
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { scope: 'global' },
      });
    const refused = await put();
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_TAX_ID_SCOPE_DUPLICATES);

    // The branch is in fact a separate taxpayer: give it its own tax ID.
    const res = await changeRoute(branch.id, { taxId: tx() });
    expect(res.statusCode, res.body).toBe(200);

    const accepted = await put();
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await scopes.scope()).toBe('global');
  });

  it('emits organization.tax_id_changed.v1 once, on commit, without any tax ID', async () => {
    const org = await company();
    const { events, off } = listen();
    const next = tx();
    await change(org.id, next);
    off();
    const mine = events.filter((event) => event['organizationId'] === org.id);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]!).sort()).toEqual(['changedAt', 'eventId', 'occurredAt', 'organizationId']);
    expect(JSON.stringify(mine[0])).not.toContain(next);
    expect(JSON.stringify(mine[0])).not.toContain(org.taxId);
  });

  it('rolls back, and emits nothing, when the Command fails after its write', async () => {
    const org = await company();
    const { events, off } = listen();
    const command = makeChangeTaxIdCommand({ organizationId: org.id, input: { taxId: tx() } });
    const failing: Command<unknown> = {
      ...command,
      run: async (ctx) => {
        await command.run(ctx);
        throw new Error('injected after the change');
      },
    };
    await expect(cradle().commandBus.run(failing)).rejects.toThrow('injected after the change');
    off();
    expect((await row(org.id)).tax_id).toBe(org.taxId);
    expect(events).toEqual([]);
  });

  it('audits names only (audit-state.md, O-2): changedFields, the VAT reset and the scope', async () => {
    const org = await company({ validated: true });
    const next = 'TXS1040S1040S1040';
    await change(org.id, next);
    const entries = await auditsOf(org.id);
    expect(entries).toHaveLength(1);
    expectNoAuditValues(
      entries.map((entry) => ({ action: entry.action, stateBefore: entry.state_before as never, stateAfter: entry.state_after as never })),
      [org.taxId, next, 'Change Co', 'Łódź', 'Prosta', org.id],
    );
    expect(entries[0]!.state_before).toBeNull();
    expect(entries[0]!.state_after).toMatchObject({ changedFields: ['taxId'], vatStatusReset: true });
    expect(['global', 'per-tree-root']).toContain(entries[0]!.state_after['taxIdScope']);
  });

  it('runs through organizationCommandPort with no VAT validation', async () => {
    const port = h.container.resolve<OrganizationCommandPort>('organizationCommandPort');
    const org = await company();
    const next = tx();
    await expect(port.changeTaxId(org.id, { taxId: next })).resolves.toMatchObject({ id: org.id, taxId: next });
    const [{ count }] = await sql<Array<{ count: number }>>(
      'select count(*)::int as "count" from "organization_tax_id_validations" where "organization_id" = ?',
      [org.id],
    );
    expect(count).toBe(0);
  });
});
