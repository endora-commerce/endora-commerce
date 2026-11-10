import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { quoteRequestSchema, type QuoteRequestReadPort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  AdminRole,
  AdminUser,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';

/**
 * Feature 159 — named, ordered line groups on quote requests
 * (`specs/159-quote-request-item-groups/contracts/quote-requests-api.md`).
 *
 * § ordering (T013): every reading of a quote's lines presents them in the
 * saved order (FR-011) — groups by position, each group's lines by position,
 * then the ungrouped lines — and a quote stored before the feature (every
 * `position = 0`) keeps its `(created_at, id)` order.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const PRODUCTS = [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID] as const;

interface ReplyItem {
  id: string;
  productId: string;
  groupId: string | null;
  position: number;
}
interface Reply {
  id: string;
  version: number;
  status: string;
  itemGroups: { id: string; name: string; position: number }[];
  items: ReplyItem[];
}

describe('159 — quote request line groups [contract]', () => {
  const OTHER_REP_ID = randomUUID();
  let h: BackendServerHandle;

  const sql = async <T extends object>(query: string, params: unknown[] = []): Promise<T[]> =>
    h.em().getConnection().execute<T[]>(query, params);

  const readPort = (): QuoteRequestReadPort => h.container.resolve('quoteRequestReadPort') as QuoteRequestReadPort;

  async function raise(): Promise<Reply> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: PRODUCTS.map((productId) => ({ productId, quantity: 1 })) },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: Reply }).data;
  }

  const adminRead = async (id: string): Promise<Reply> => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${id}`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Reply }).data;
  };

  const customerRead = async (id: string): Promise<Reply> => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: CUSTOMER });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Reply }).data;
  };

  /** The line ids of a quote, by product, as stored. */
  async function lineIdsByProduct(quoteId: string): Promise<Map<string, string>> {
    const rows = await sql<{ id: string; product_id: string }>(
      `select "id", "product_id" from "quote_request_items" where "quote_request_id" = ?`,
      [quoteId],
    );
    return new Map(rows.map((row) => [row.product_id, row.id]));
  }

  const stamp = Date.now();
  const REP_SESSION = `stub-159-rep-${stamp}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    // A representative assigned to another organisation only (FR-082).
    await withSystemScope('159: a representative of another organisation', async () => {
      const fork = h.orm.em.fork();
      let role = await fork.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['rfqs:handle'];
      if (!role) role = fork.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      else role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      await fork.persistAndFlush(role);
      const org = fork.create(Organization, {
        name: `159 foreign ${stamp}`,
        taxId: `PL159F${String(stamp).slice(-7)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
      });
      const rep = fork.create(AdminUser, {
        email: `159-rep-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '159',
        lastName: 'Rep',
      });
      await fork.persistAndFlush([org, rep]);
      await fork.persistAndFlush(fork.create(OrganizationSalesRepAssignment, { organizationId: org.id, adminUserId: rep.id }));
      // #305 — the seeded organization is another representative's: an
      // unassigned organization is in every representative's reach.
      await fork.persistAndFlush(fork.create(OrganizationSalesRepAssignment, { organizationId: TEST_ORGANIZATION_ID, adminUserId: OTHER_REP_ID }));
      ADMIN_COOKIES[REP_SESSION] = { adminUserId: rep.id };
    });
  }, 90_000);

  afterAll(async () => {
    await h.em().getConnection().execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [OTHER_REP_ID]);
    delete ADMIN_COOKIES[REP_SESSION];
    await teardownBackendServer(h);
  });

  const patch = (quote: { id: string; version: number }, payload: unknown, cookies: Record<string, string> = ADMIN) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${quote.id}`,
      cookies,
      headers: { 'if-match': `"${quote.version}"` },
      payload: payload as Record<string, unknown>,
    });

  const line = (productId: string, groupKey?: string | null, id?: string) => ({
    ...(id ? { id } : {}),
    productId,
    quantity: 2,
    agreedUnitPrice: 10,
    ...(groupKey === undefined ? {} : { groupKey }),
  });

  const modifyAudits = (quoteId: string) =>
    h.em().fork().find(
      AuditLogEntry,
      { objectType: 'quote_request', objectId: quoteId, action: 'quote_request.modify' },
      { orderBy: { actedAt: 'asc' } },
    );

  describe('ordering (T013, FR-011)', () => {
    it('answers ungrouped lines by position on the admin reply, the customer reply and the read port', async () => {
      const quote = await raise();
      const ids = await lineIdsByProduct(quote.id);
      // 101 at position 2, 102 at 0, 103 at 1.
      await sql(`update "quote_request_items" set "position" = 2 where "id" = ?`, [ids.get(SEED_PRODUCT_101_ID)]);
      await sql(`update "quote_request_items" set "position" = 0 where "id" = ?`, [ids.get(SEED_PRODUCT_102_ID)]);
      await sql(`update "quote_request_items" set "position" = 1 where "id" = ?`, [ids.get(SEED_PRODUCT_103_ID)]);
      const expected = [SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID, SEED_PRODUCT_101_ID];

      const admin = await adminRead(quote.id);
      expect(admin.items.map((item) => item.productId)).toEqual(expected);
      expect(admin.items.map((item) => item.position)).toEqual([0, 1, 2]);
      expect(admin.itemGroups).toEqual([]);

      const customer = await customerRead(quote.id);
      expect(customer.items.map((item) => item.productId)).toEqual(expected);
      expect(customer.items.map((item) => item.groupId)).toEqual([null, null, null]);
      expect(customer.itemGroups).toEqual([]);
      expect(disagreements(deepStrict(quoteRequestSchema), customer)).toEqual([]);

      const records = await readPort().listItems(quote.id);
      expect(records.map((record) => record.productId)).toEqual(expected);
      expect(records.map((record) => record.position)).toEqual([0, 1, 2]);
      expect(records.map((record) => record.group)).toEqual([null, null, null]);
    });

    it('keeps the (created_at, id) order of a quote whose lines all read position 0', async () => {
      const quote = await raise();
      const ids = await lineIdsByProduct(quote.id);
      // Lines stored before the feature: every position the column default.
      await sql(`update "quote_request_items" set "position" = 0 where "quote_request_id" = ?`, [quote.id]);
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      const at = (offset: number) => new Date(base + offset * 1000).toISOString();
      await sql(`update "quote_request_items" set "created_at" = ? where "id" = ?`, [at(2), ids.get(SEED_PRODUCT_101_ID)]);
      await sql(`update "quote_request_items" set "created_at" = ? where "id" = ?`, [at(0), ids.get(SEED_PRODUCT_102_ID)]);
      await sql(`update "quote_request_items" set "created_at" = ? where "id" = ?`, [at(1), ids.get(SEED_PRODUCT_103_ID)]);
      const expected = [SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID, SEED_PRODUCT_101_ID];

      expect((await adminRead(quote.id)).items.map((item) => item.productId)).toEqual(expected);
      expect((await customerRead(quote.id)).items.map((item) => item.productId)).toEqual(expected);
      expect((await readPort().listItems(quote.id)).map((record) => record.productId)).toEqual(expected);
    });

    it('answers groups in order with their lines first; the admin reply keeps an empty group, the customer reply drops it', async () => {
      const quote = await raise();
      const ids = await lineIdsByProduct(quote.id);
      const later = randomUUID();
      const first = randomUUID();
      const empty = randomUUID();
      for (const [id, name, position] of [
        [later, 'Later', 1],
        [first, 'First', 0],
        [empty, 'Empty', 2],
      ] as const) {
        await sql(
          `insert into "quote_request_item_groups" ("id", "quote_request_id", "name", "position", "created_at", "updated_at")
           values (?, ?, ?, ?, now(), now())`,
          [id, quote.id, name, position],
        );
      }
      // 101 ungrouped; 102 in Later; 103 in First.
      await sql(`update "quote_request_items" set "group_id" = ? where "id" = ?`, [later, ids.get(SEED_PRODUCT_102_ID)]);
      await sql(`update "quote_request_items" set "group_id" = ? where "id" = ?`, [first, ids.get(SEED_PRODUCT_103_ID)]);
      const expected = [SEED_PRODUCT_103_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_101_ID];

      const admin = await adminRead(quote.id);
      expect(admin.itemGroups).toEqual([
        { id: first, name: 'First', position: 0 },
        { id: later, name: 'Later', position: 1 },
        { id: empty, name: 'Empty', position: 2 },
      ]);
      expect(admin.items.map((item) => item.productId)).toEqual(expected);
      expect(admin.items.map((item) => item.groupId)).toEqual([first, later, null]);

      const customer = await customerRead(quote.id);
      expect(customer.itemGroups).toEqual([
        { id: first, name: 'First', position: 0 },
        { id: later, name: 'Later', position: 1 },
      ]);
      expect(customer.items.map((item) => item.productId)).toEqual(expected);
      expect(JSON.stringify(customer)).not.toContain(empty);

      const records = await readPort().listItems(quote.id);
      expect(records.map((record) => record.productId)).toEqual(expected);
      expect(records.map((record) => record.group)).toEqual([
        { id: first, name: 'First', position: 0 },
        { id: later, name: 'Later', position: 1 },
        null,
      ]);
    });
  });

  describe('modify / create (T023)', () => {
    it('creates, renames, deletes and reorders groups and places lines; the reply carries an empty group', async () => {
      const quote = await raise();
      const first = await patch(quote, {
        groups: [
          { key: 'a', name: 'Ground floor' },
          { key: 'b', name: 'First floor' },
          { key: 'c', name: 'Options' },
        ],
        items: [line(SEED_PRODUCT_103_ID, 'a'), line(SEED_PRODUCT_101_ID, 'b'), line(SEED_PRODUCT_102_ID, null)],
      });
      expect(first.statusCode, first.body).toBe(200);
      const one = (first.json() as { data: Reply }).data;
      expect(one.itemGroups.map((group) => [group.name, group.position])).toEqual([
        ['Ground floor', 0],
        ['First floor', 1],
        ['Options', 2],
      ]);
      expect(one.items.map((item) => item.productId)).toEqual([SEED_PRODUCT_103_ID, SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID]);
      const [ground, firstFloor, options] = one.itemGroups;
      expect(one.items.map((item) => item.groupId)).toEqual([ground!.id, firstFloor!.id, null]);

      // Rename First floor, delete Ground floor (its line goes to ungrouped), move Options first.
      const second = await patch(one, {
        groups: [
          { key: 'c', id: options!.id, name: 'Options' },
          { key: 'b', id: firstFloor!.id, name: 'Floor 1' },
        ],
        items: [
          line(SEED_PRODUCT_101_ID, 'b', one.items[1]!.id),
          line(SEED_PRODUCT_102_ID, null, one.items[2]!.id),
          line(SEED_PRODUCT_103_ID, null, one.items[0]!.id),
        ],
      });
      expect(second.statusCode, second.body).toBe(200);
      const two = (second.json() as { data: Reply }).data;
      expect(two.itemGroups).toEqual([
        { id: options!.id, name: 'Options', position: 0 },
        { id: firstFloor!.id, name: 'Floor 1', position: 1 },
      ]);
      expect(two.items.map((item) => [item.productId, item.groupId, item.position])).toEqual([
        [SEED_PRODUCT_101_ID, firstFloor!.id, 0],
        [SEED_PRODUCT_102_ID, null, 0],
        [SEED_PRODUCT_103_ID, null, 1],
      ]);
      const rows = await sql<{ count: string }>(
        `select count(*)::text as "count" from "quote_request_item_groups" where "quote_request_id" = ?`,
        [quote.id],
      );
      expect(rows).toEqual([{ count: '2' }]);
      expect(disagreements(deepStrict(quoteRequestSchema), two)).toEqual([]);
    });

    it('a grouped save totals exactly what the same lines ungrouped total (SC-002)', async () => {
      const totalOf = async (id: string): Promise<number | null> => {
        const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/quote-requests', cookies: ADMIN });
        const rows = (res.json() as { data: Array<{ id: string; totalAtAgreedPrice: number | null }> }).data;
        return rows.find((row) => row.id === id)?.totalAtAgreedPrice ?? null;
      };
      const plain = await raise();
      const grouped = await raise();
      const items = [line(SEED_PRODUCT_101_ID), line(SEED_PRODUCT_102_ID), line(SEED_PRODUCT_103_ID)];
      expect((await patch(plain, { items })).statusCode).toBe(200);
      const res = await patch(grouped, {
        groups: [{ key: 'g', name: 'G' }],
        items: items.map((item, index) => ({ ...item, groupKey: index === 1 ? 'g' : null })),
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(await totalOf(grouped.id)).toBe(await totalOf(plain.id));
      expect(await totalOf(grouped.id)).toBe(60);
    });

    it('a PATCH without groups keeps each paired line in its group and puts a new line in Ungrouped (FR-013)', async () => {
      const quote = await raise();
      const grouped = (
        (
          await patch(quote, {
            groups: [{ key: 'g', name: 'Kept' }],
            items: [line(SEED_PRODUCT_101_ID, 'g'), line(SEED_PRODUCT_102_ID, null)],
          })
        ).json() as { data: Reply }
      ).data;
      const res = await patch(grouped, {
        items: [line(SEED_PRODUCT_102_ID), line(SEED_PRODUCT_103_ID), line(SEED_PRODUCT_101_ID)],
      });
      expect(res.statusCode, res.body).toBe(200);
      const after = (res.json() as { data: Reply }).data;
      expect(after.itemGroups).toEqual(grouped.itemGroups);
      expect(after.items.map((item) => [item.productId, item.groupId])).toEqual([
        [SEED_PRODUCT_101_ID, grouped.itemGroups[0]!.id],
        [SEED_PRODUCT_102_ID, null],
        [SEED_PRODUCT_103_ID, null],
      ]);
    });

    it('refuses groups without items (400), a group of another quote (422) and a stale version (409)', async () => {
      const quote = await raise();
      const noItems = await patch(quote, { groups: [{ key: 'g', name: 'G' }] });
      expect(noItems.statusCode, noItems.body).toBe(400);
      expect((noItems.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

      const other = await raise();
      const otherGrouped = (
        (await patch(other, { groups: [{ key: 'g', name: 'Theirs' }], items: [line(SEED_PRODUCT_101_ID, 'g')] })).json() as {
          data: Reply;
        }
      ).data;
      const foreign = await patch(quote, {
        groups: [{ key: 'x', id: otherGrouped.itemGroups[0]!.id, name: 'Stolen' }],
        items: [line(SEED_PRODUCT_101_ID, 'x')],
      });
      expect(foreign.statusCode, foreign.body).toBe(422);
      const body = foreign.json() as { error: { code: string; details: Array<{ path: string }> } };
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details).toEqual([expect.objectContaining({ path: 'groups.0.id' })]);
      // Nothing was written: the other quote keeps its group and this quote has none.
      expect((await adminRead(other.id)).itemGroups).toEqual(otherGrouped.itemGroups);
      expect((await adminRead(quote.id)).itemGroups).toEqual([]);

      const stale = await patch({ id: quote.id, version: quote.version + 7 }, {
        groups: [{ key: 'g', name: 'G' }],
        items: [line(SEED_PRODUCT_101_ID, 'g')],
      });
      expect(stale.statusCode, stale.body).toBe(409);
    });

    it('refuses a grouping outside Created from admin / Pending with RFQ_NOT_QUOTED (FR-012)', async () => {
      const quote = await raise();
      const priced = (await patch(quote, { items: [line(SEED_PRODUCT_101_ID)] })).json() as { data: Reply };
      const approved = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/quote-requests/${quote.id}/approve`,
        cookies: ADMIN,
        headers: { 'if-match': `"${priced.data.version}"` },
        payload: {},
      });
      expect(approved.statusCode, approved.body).toBe(200);
      const version = (approved.json() as { data: Reply }).data.version;
      const res = await patch({ id: quote.id, version }, {
        groups: [{ key: 'g', name: 'Late' }],
        items: [line(SEED_PRODUCT_101_ID, 'g')],
      });
      expect(res.statusCode, res.body).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe('RFQ_NOT_QUOTED');
    });

    it('records the grouping shape before and after on the quote_request.modify audit entry (FR-081)', async () => {
      const quote = await raise();
      const one = (
        (
          await patch(quote, {
            groups: [
              { key: 'a', name: 'A' },
              { key: 'b', name: 'Empty' },
            ],
            items: [line(SEED_PRODUCT_101_ID, 'a'), line(SEED_PRODUCT_102_ID, 'a'), line(SEED_PRODUCT_103_ID)],
          })
        ).json() as { data: Reply }
      ).data;
      await patch(one, {
        groups: [{ key: 'a', id: one.itemGroups[0]!.id, name: 'Renamed' }],
        items: [line(SEED_PRODUCT_101_ID, 'a'), line(SEED_PRODUCT_102_ID), line(SEED_PRODUCT_103_ID)],
      });
      const audits = await modifyAudits(quote.id);
      expect(audits).toHaveLength(2);
      expect(audits[0]!.stateBefore).toMatchObject({ groups: [] });
      // Line counts in order, never a group's name (D-288, #470).
      expect(audits[0]!.stateAfter).toMatchObject({ groups: [{ lineCount: 2 }, { lineCount: 0 }] });
      expect(audits[1]!.stateBefore).toMatchObject({ groups: [{ lineCount: 2 }, { lineCount: 0 }] });
      expect(audits[1]!.stateAfter).toMatchObject({ groups: [{ lineCount: 1 }] });
      const recorded = JSON.stringify(audits.map((entry) => [entry.stateBefore, entry.stateAfter]));
      for (const name of ['"A"', 'Empty', 'Renamed']) expect(recorded, name).not.toContain(name);
    });

    it('creates a quote on behalf with groups (POST)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: ADMIN,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          groups: [
            { key: 'hall', name: 'Hall A' },
            { key: 'none', name: 'Unused' },
          ],
          items: [
            { productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 5, groupKey: null },
            { productId: SEED_PRODUCT_102_ID, quantity: 1, agreedUnitPrice: 5, groupKey: 'hall' },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const created = (res.json() as { data: Reply }).data;
      expect(created.itemGroups.map((group) => group.name)).toEqual(['Hall A', 'Unused']);
      expect(created.items.map((item) => [item.productId, item.groupId])).toEqual([
        [SEED_PRODUCT_102_ID, created.itemGroups[0]!.id],
        [SEED_PRODUCT_101_ID, null],
      ]);
      const audits = await h.em().fork().find(AuditLogEntry, {
        objectType: 'quote_request',
        objectId: created.id,
        action: 'quote_request.create_on_behalf',
      });
      expect(audits[0]!.stateAfter).toMatchObject({ groups: [{ lineCount: 1 }, { lineCount: 0 }] });
      expect(JSON.stringify(audits[0]!.stateAfter)).not.toContain('Hall A');
    });

    it('a representative of another organisation gets 404 and no group data (FR-082)', async () => {
      const quote = await raise();
      const grouped = (
        (await patch(quote, { groups: [{ key: 'g', name: 'Secret floor' }], items: [line(SEED_PRODUCT_101_ID, 'g')] })).json() as {
          data: Reply;
        }
      ).data;
      const rep = { b2b_session: REP_SESSION };
      const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${quote.id}`, cookies: rep });
      expect(read.statusCode).toBe(404);
      expect(read.body).not.toContain('Secret floor');
      const write = await patch(grouped, {
        groups: [{ key: 'g', id: grouped.itemGroups[0]!.id, name: 'Taken' }],
        items: [line(SEED_PRODUCT_101_ID, 'g')],
      }, rep);
      expect(write.statusCode).toBe(404);
      expect(write.body).not.toContain('Secret floor');
      expect((await adminRead(quote.id)).itemGroups.map((group) => group.name)).toEqual(['Secret floor']);
    });
  });

  describe('one product on several lines (research N-31 … N-33)', () => {
    interface SplitReply extends Reply {
      items: Array<
        ReplyItem & { quantity: number; desiredUnitPrice: number | null; agreedUnitPrice: number | null; lineNote: string | null }
      >;
      comparisonAgainstLastSeen?: { diff: Array<Record<string, unknown>> } | null;
    }

    /** A customer's quote of 101 × 8 with a proposal and a note, and 102 × 1. */
    async function raiseWithProposal(): Promise<SplitReply> {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: CUSTOMER,
        payload: {
          items: [
            { productId: SEED_PRODUCT_101_ID, quantity: 8, desiredUnitPrice: 20, lineNote: 'Pallets' },
            { productId: SEED_PRODUCT_102_ID, quantity: 1 },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: SplitReply }).data;
    }

    it('a line split off into another group keeps the original’s proposal and note; both lines are the quote’s own', async () => {
      const quote = await raiseWithProposal();
      const [bolt, other] = quote.items;
      const res = await patch(quote, {
        groups: [
          { key: 'y', name: 'Y' },
          { key: 'z', name: 'Z' },
        ],
        items: [
          { id: bolt!.id, productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 11, groupKey: 'y' },
          { id: other!.id, productId: SEED_PRODUCT_102_ID, quantity: 1, agreedUnitPrice: 12, groupKey: 'z' },
          { productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 11, groupKey: 'z', splitFromId: bolt!.id },
        ],
      });
      expect(res.statusCode, res.body).toBe(200);
      const reply = (res.json() as { data: SplitReply }).data;
      const [y, z] = reply.itemGroups;
      expect(reply.items.map((item) => [item.productId, item.groupId, item.quantity, item.desiredUnitPrice, item.lineNote])).toEqual([
        [SEED_PRODUCT_101_ID, y!.id, 5, 20, 'Pallets'],
        [SEED_PRODUCT_102_ID, z!.id, 1, null, null],
        [SEED_PRODUCT_101_ID, z!.id, 3, 20, 'Pallets'],
      ]);
      expect(disagreements(deepStrict(quoteRequestSchema), reply)).toEqual([]);

      // The customer sees both lines, each in its group, and a comparison that says which Bolt line changed.
      const mine = (await customerRead(quote.id)) as SplitReply;
      expect(mine.items.map((item) => [item.groupId, item.quantity])).toEqual([
        [y!.id, 5],
        [z!.id, 1],
        [z!.id, 3],
      ]);
      const lineEntries = (mine.comparisonAgainstLastSeen?.diff ?? []).filter((entry) => entry['productId'] === SEED_PRODUCT_101_ID);
      expect(lineEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'line_added', groupName: 'Z', quantity: 3 }),
          expect.objectContaining({ kind: 'line_quantity', groupName: 'Y', before: 8, after: 5 }),
        ]),
      );
    });

    it('a splitFromId naming no line of this quote is a plain new line', async () => {
      const quote = await raiseWithProposal();
      const foreign = await raiseWithProposal();
      const [bolt, other] = quote.items;
      const res = await patch(quote, {
        items: [
          { id: bolt!.id, productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 11 },
          { id: other!.id, productId: SEED_PRODUCT_102_ID, quantity: 1, agreedUnitPrice: 12 },
          { productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 11, splitFromId: foreign.items[0]!.id },
        ],
      });
      expect(res.statusCode, res.body).toBe(200);
      const reply = (res.json() as { data: SplitReply }).data;
      expect(reply.items[2]).toMatchObject({ quantity: 3, desiredUnitPrice: null, lineNote: null });
    });
  });

  describe('read port (T056, FR-087)', () => {
    it('listItems answers every line with its group and its position, in display order, after a grouped save', async () => {
      const quote = await raise();
      const saved = await patch(quote, {
        groups: [
          { key: 'a', name: 'Hall A' },
          { key: 'b', name: 'Hall B' },
          { key: 'e', name: 'Empty' },
        ],
        items: [line(SEED_PRODUCT_102_ID, 'b'), line(SEED_PRODUCT_103_ID, null), line(SEED_PRODUCT_101_ID, 'b')],
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const reply = (saved.json() as { data: Reply }).data;
      const hallB = reply.itemGroups.find((group) => group.name === 'Hall B')!;

      const records = await readPort().listItems(quote.id);
      expect(records.map((record) => [record.productId, record.group?.name ?? null, record.position])).toEqual([
        [SEED_PRODUCT_102_ID, 'Hall B', 0],
        [SEED_PRODUCT_101_ID, 'Hall B', 1],
        [SEED_PRODUCT_103_ID, null, 0],
      ]);
      // The group as the reply names it: identity, name and the quote's position.
      expect(records[0]!.group).toEqual({ id: hallB.id, name: 'Hall B', position: 1 });
      // The read model is additive: every pre-159 key still answers as before.
      expect(records[0]).toMatchObject({ quoteRequestId: quote.id, quantity: 2, agreedUnitPrice: expect.any(String) });
    });
  });
});
