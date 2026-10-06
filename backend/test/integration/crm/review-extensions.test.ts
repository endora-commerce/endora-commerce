import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { ERROR_CODES, formatOpportunityReferenceToken } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminNotification, CrmOpportunity, CrmOpportunityLink } from '../../helpers/package-entities.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import {
  CRM_ADMIN,
  CRM_API,
  changeOrderStatusAsOperator,
  clearCrmTags,
  createCrmOpportunity,
  createCrmTag,
  linkCrmOrder,
  linkCrmQuoteRequest,
  placeCrmOrder,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmAsset,
  seedCrmOrder,
  seedCrmSalesRep,
  setCrmCountingStatuses,
  setCrmMappings,
  setCrmSetting,
  submitCrmQuoteRequest,
  transitionCrmOpportunity,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';
import { TINY_PNG, uploadCrmAttachment, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';

/**
 * The review's fixes (`specs/143-crm-sales-opportunities/research.md` N-R1 …
 * N-R12) were written against a tree that had no quote-request links, no
 * computed value, no automatic creation, no change history, no references and
 * no creation from an Opportunity. This file holds each fix to the code that
 * has joined since (research N-R13).
 */
describe('crm review fixes, on the code written after them', () => {
  let h: BackendServerHandle;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Reaches every Organization; CRM's two codes and nothing of another module. */
  let crmOnly: Seeded;
  /** CRM's codes and `orders:read`. */
  let withOrders: Seeded;
  /** CRM's codes and `rfqs:handle`. */
  let withQuotes: Seeded;
  /** CRM's codes and `catalog:read`. */
  let withCatalog: Seeded;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    path: string,
    cookies: Record<string, string> = CRM_ADMIN,
    payload?: unknown,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  type Detail = {
    status: { code: string };
    closedKind: string | null;
    version: number;
    value: string | null;
    computedValue: string;
    excludedDocuments: Array<{ kind: string; id: string; reason: string }>;
    references: Array<{ type: string; id: string; available: boolean; label: string | null; url: string | null }>;
    links: Array<Record<string, unknown> & { documentKind: string; documentId: string; available: boolean }>;
  };
  const detail = async (opportunityId: string, cookies: Record<string, string> = CRM_ADMIN): Promise<Detail> => {
    const response = await call('GET', `/opportunities/${opportunityId}`, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: Detail }).data;
  };

  const bellOf = async (adminUserId: string) =>
    (await h.em().find(AdminNotification, { targetAdminUserId: adminUserId }, { filters: false })).map((row) => ({
      kind: row.kind,
      title: row.title,
      body: row.body ?? null,
    }));

  const recalculateAll = () =>
    enterSystemScope('test: crm value recalculation job', () =>
      (h.container.resolve('crmOpportunityValueService') as { recalculateAll(): Promise<number> }).recalculateAll(),
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await clearCrmTags(h.em());
    await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
    crmOnly = await seedCrmAdmin(h.em(), 'ext-crm-only', ['crm:read', 'crm:write', 'crm:analytics']);
    withOrders = await seedCrmAdmin(h.em(), 'ext-orders', ['crm:read', 'crm:write', 'orders:read']);
    withQuotes = await seedCrmAdmin(h.em(), 'ext-quotes', ['crm:read', 'crm:write', 'rfqs:handle']);
    withCatalog = await seedCrmAdmin(h.em(), 'ext-catalog', ['crm:read', 'crm:write', 'catalog:read']);
  });

  afterAll(async () => {
    for (const seeded of [crmOnly, withOrders, withQuotes, withCatalog]) seeded.undo();
    await clearCrmTags(h.em());
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('finding 3 — what another module owns is shown to somebody who may read it there', () => {
    it('shows a linked Quote Request to a holder of rfqs:handle and only that it is linked to anybody else', async () => {
      const quote = await submitCrmQuoteRequest(h);
      const opportunity = await createCrmOpportunity(h);
      expect((await linkCrmQuoteRequest(h, opportunity.id, quote.id)).statusCode).toBe(201);

      // The control: the document is there to be shown.
      const seen = (await detail(opportunity.id, withQuotes.cookies)).links;
      expect(seen).toEqual([
        expect.objectContaining({ documentKind: 'quote_request', available: true, number: quote.businessId }),
      ]);

      for (const reader of [crmOnly, withOrders]) {
        const [link] = (await detail(opportunity.id, reader.cookies)).links;
        expect(link).toMatchObject({ documentKind: 'quote_request', documentId: quote.id, available: false });
        expect(link).not.toHaveProperty('number');
        expect(link).not.toHaveProperty('status');
        expect(link).not.toHaveProperty('total');
        expect(link).not.toHaveProperty('currency');
      }
    });

    it('asks for rfqs:handle to link a Quote Request, and to be offered one to link', async () => {
      const quote = await submitCrmQuoteRequest(h);
      const opportunity = await createCrmOpportunity(h);

      const refused = await linkCrmQuoteRequest(h, opportunity.id, quote.id, crmOnly.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(await h.em().count(CrmOpportunityLink, { documentId: quote.id }, { filters: false })).toBe(0);
      // `orders:read` is not the Quote Requests module's code.
      expect((await linkCrmQuoteRequest(h, opportunity.id, quote.id, withOrders.cookies)).statusCode).toBe(403);

      const lookup = `/lookups/quote-requests?organizationId=${TEST_ORGANIZATION_ID}`;
      expect((await call('GET', lookup, crmOnly.cookies)).statusCode).toBe(403);
      const offered = await call('GET', lookup, withQuotes.cookies);
      expect(offered.statusCode, offered.body).toBe(200);
      expect(JSON.stringify(offered.json())).toContain(quote.businessId);

      const linked = await linkCrmQuoteRequest(h, opportunity.id, quote.id, withQuotes.cookies);
      expect(linked.statusCode, linked.body).toBe(201);
    });

    it('names a document a computed value leaves out only to somebody who may read that document', async () => {
      expect((await setCrmCountingStatuses(h, { order: ['new'], quoteRequest: [] })).statusCode).toBe(202);
      try {
        const order = await seedCrmOrder(h.em(), { currency: 'PLN', total: '500.00' });
        const opportunity = await createCrmOpportunity(h, { currency: 'EUR', valueMode: 'computed' });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

        const excluded = [{ kind: 'order', id: order.id, reason: 'currency_mismatch' }];
        expect((await detail(opportunity.id)).excludedDocuments).toEqual(excluded);
        expect((await detail(opportunity.id, withOrders.cookies)).excludedDocuments).toEqual(excluded);
        // Its status and its currency are what that entry says of the Order.
        expect((await detail(opportunity.id, crmOnly.cookies)).excludedDocuments).toEqual([]);
        expect((await detail(opportunity.id, withQuotes.cookies)).excludedDocuments).toEqual([]);
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });

    it('keeps the stored computed value what the documents make it, whoever caused the recalculation', async () => {
      expect((await setCrmCountingStatuses(h, { order: ['new'], quoteRequest: [] })).statusCode).toBe(202);
      try {
        const order = await seedCrmOrder(h.em(), { total: '321.00' });
        const opportunity = await createCrmOpportunity(h);
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
        // The mode is switched by somebody who may not read Orders: the figure
        // is the Opportunity's own and is not narrowed by who asked for it.
        const switched = await call('PATCH', `/opportunities/${opportunity.id}`, crmOnly.cookies, {
          valueMode: 'computed',
        });
        expect(switched.statusCode, switched.body).toBe(200);
        expect((await detail(opportunity.id)).computedValue).toBe('321.00');
        expect((await detail(opportunity.id, crmOnly.cookies)).value).toBe('321.00');
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });

    it('resolves a reference to an Order or a Product only for somebody who may read it where it lives', async () => {
      const order = await seedCrmOrder(h.em());
      const description =
        `See ${formatOpportunityReferenceToken('order', order.id)} and ` +
        `${formatOpportunityReferenceToken('product', SEED_PRODUCT_101_ID)}.`;
      const opportunity = await createCrmOpportunity(h, { description });
      const note = await call('POST', `/opportunities/${opportunity.id}/comments`, CRM_ADMIN, {
        kind: 'note',
        body: description,
      });
      expect(note.statusCode, note.body).toBe(201);

      const referencesFor = async (cookies: Record<string, string>) => {
        const fromDescription = (await detail(opportunity.id, cookies)).references;
        const notes = await call('GET', `/opportunities/${opportunity.id}/comments?kind=note`, cookies);
        expect(notes.statusCode, notes.body).toBe(200);
        const [listed] = (notes.json() as { data: Array<{ references: Detail['references'] }> }).data;
        // A note says what the description says, to the same reader.
        expect(listed?.references).toEqual(fromDescription);
        return Object.fromEntries(fromDescription.map((reference) => [reference.type, reference]));
      };

      const unavailable = (type: string, id: string) => ({ type, id, available: false, label: null, url: null });
      // The control: both are there to be named.
      const all = await referencesFor(CRM_ADMIN);
      expect(all.order).toMatchObject({ available: true, label: order.businessId });
      expect(all.product).toMatchObject({ available: true });

      const none = await referencesFor(crmOnly.cookies);
      expect(none.order).toEqual(unavailable('order', order.id));
      expect(none.product).toEqual(unavailable('product', SEED_PRODUCT_101_ID));

      const orders = await referencesFor(withOrders.cookies);
      expect(orders.order).toMatchObject({ available: true, label: order.businessId });
      expect(orders.product).toEqual(unavailable('product', SEED_PRODUCT_101_ID));

      const catalog = await referencesFor(withCatalog.cookies);
      expect(catalog.order).toEqual(unavailable('order', order.id));
      expect(catalog.product).toMatchObject({ available: true, label: all.product?.label });
    });

    it('says which Opportunity an Order belongs to only to somebody who may read Orders', async () => {
      const order = await seedCrmOrder(h.em());
      const opportunity = await createCrmOpportunity(h);
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      const path = `/documents/order/${order.id}/opportunity`;

      const allowed = await call('GET', path, withOrders.cookies);
      expect(allowed.statusCode, allowed.body).toBe(200);
      expect((allowed.json() as { data: { id: string } }).data.id).toBe(opportunity.id);
      // Whether an Order exists, and whether it has an Opportunity, is `orders`' to say.
      expect((await call('GET', path, crmOnly.cookies)).statusCode).toBe(403);
      expect((await call('GET', `/documents/order/${randomUUID()}/opportunity`, crmOnly.cookies)).statusCode).toBe(403);
    });

    it('gives a reader without orders:read a change history and an Opportunity that never name the Order', async () => {
      expect(
        (
          await setCrmMappings(h, [
            { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
          ])
        ).statusCode,
      ).toBe(200);
      try {
        const order = await seedCrmOrder(h.em());
        expect(order.businessId).toBeTruthy();
        const opportunity = await createCrmOpportunity(h, { title: 'History without an order number' });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
        await changeOrderStatusAsOperator(h, order.id, 'paid');
        expect((await detail(opportunity.id)).status.code).toBe('qualified');

        const number = `"${order.businessId}"`;
        const control = await call('GET', `/opportunities/${opportunity.id}`, withOrders.cookies);
        expect(control.body).toContain(number);
        for (const path of [`/opportunities/${opportunity.id}`, `/opportunities/${opportunity.id}/history`]) {
          const response = await call('GET', path, crmOnly.cookies);
          expect(response.statusCode, response.body).toBe(200);
          expect(response.body, path).not.toContain(number);
        }
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });

  describe('finding 2 — the bell of an Opportunity nobody created by hand', () => {
    it('tells the assignee of an automatically created Opportunity its number and nothing of its title', async () => {
      const rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read']);
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
      try {
        const placed = await whenCrmEventSettled(h, 'order.created.v1', () => true, () => placeCrmOrder(h));
        const link = await h
          .em()
          .findOneOrFail(CrmOpportunityLink, { documentKind: 'order', documentId: placed.id }, { filters: false });
        const created = await h.em().findOneOrFail(CrmOpportunity, { id: link.opportunityId }, { filters: false });
        // The title of such an Opportunity is the Order's number and the Organization's name.
        expect(created.title).toContain(String(placed.businessId));

        const assigned = (await bellOf(created.assignedAdminUserId ?? '')).filter(
          (entry) => entry.kind === 'crm.opportunity.assigned',
        );
        expect(assigned).toEqual([
          { kind: 'crm.opportunity.assigned', title: `Opportunity ${created.number} was assigned to you`, body: null },
        ]);
      } finally {
        await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
        rep.undo();
      }
    });
  });

  describe('finding 6 — the audit trail of a note that mentions something', () => {
    it('records that a note with references was written, edited and deleted, and never what it said', async () => {
      const order = await seedCrmOrder(h.em());
      const opportunity = await createCrmOpportunity(h);
      const token = formatOpportunityReferenceToken('order', order.id);
      const written = await call('POST', `/opportunities/${opportunity.id}/comments`, CRM_ADMIN, {
        kind: 'note',
        body: `EXT-AUDIT-FIRST about ${token}`,
      });
      expect(written.statusCode, written.body).toBe(201);
      const noteId = (written.json() as { data: { id: string } }).data.id;
      const edited = await call('PATCH', `/opportunities/${opportunity.id}/comments/${noteId}`, CRM_ADMIN, {
        body: `EXT-AUDIT-SECOND about ${token}`,
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect((await call('DELETE', `/opportunities/${opportunity.id}/comments/${noteId}`)).statusCode).toBe(204);

      for (const url of [
        `/api/v1/admin/audit-log?filter[objectType]=crm_opportunity&filter[objectId]=${opportunity.id}`,
        `${CRM_API}/opportunities/${opportunity.id}/history`,
      ]) {
        const audit = await h.app.inject({ method: 'GET', url, cookies: CRM_ADMIN });
        expect(audit.statusCode, audit.body).toBe(200);
        // The control: the three entries are there to be read.
        for (const action of ['note_add', 'note_update', 'note_delete']) {
          expect(audit.body, url).toContain(`crm.opportunity.${action}`);
        }
        expect(audit.body, url).not.toContain('EXT-AUDIT');
        expect(audit.body, url).not.toContain(token);
      }
    });
  });

  describe('findings 4 and 12 — nothing written since reopens, or strands, an Opportunity', () => {
    it('recalculates the value of a closed Opportunity without touching its status, its closing or its version', async () => {
      expect((await setCrmCountingStatuses(h, { order: ['new', 'paid'], quoteRequest: [] })).statusCode).toBe(202);
      try {
        const order = await seedCrmOrder(h.em(), { total: '100.00' });
        const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
        expect((await transitionCrmOpportunity(h, opportunity.id, 'lost')).statusCode).toBe(200);
        const before = await detail(opportunity.id);
        expect(before).toMatchObject({ status: { code: 'lost' }, closedKind: 'lost', computedValue: '100.00' });

        await h.em().getConnection().execute(`update "orders" set "total" = '250.00' where "id" = ?`, [order.id]);
        expect(await recalculateAll()).toBeGreaterThanOrEqual(1);

        const after = await detail(opportunity.id);
        expect(after.computedValue).toBe('250.00');
        expect(after).toMatchObject({ status: { code: 'lost' }, closedKind: 'lost', version: before.version });
      } finally {
        await restoreDefaultCrmWorkflow(h.em());
      }
    });

    it('leaves an automatically created Opportunity closed when its Order moves to a status mapped out of the closed one', async () => {
      // `lost → new` is seeded: the edge a reopening would walk.
      expect(
        (
          await setCrmMappings(h, [
            { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'new' },
          ])
        ).statusCode,
      ).toBe(200);
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
      try {
        const placed = await whenCrmEventSettled(h, 'order.created.v1', () => true, () => placeCrmOrder(h));
        const link = await h
          .em()
          .findOneOrFail(CrmOpportunityLink, { documentKind: 'order', documentId: placed.id }, { filters: false });
        expect((await transitionCrmOpportunity(h, link.opportunityId, 'lost')).statusCode).toBe(200);

        await changeOrderStatusAsOperator(h, placed.id, 'paid');
        expect(await detail(link.opportunityId)).toMatchObject({ status: { code: 'lost' }, closedKind: 'lost' });
      } finally {
        await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
        await restoreDefaultCrmWorkflow(h.em());
      }
    });

    it('creates the Opportunity of a placed document in the start status the workflow has by the time it is written', async () => {
      const organizationOpportunities = () =>
        h.em().find(CrmOpportunity, { title: { $like: 'EXT-RACE%' } }, { filters: false });
      const create = () =>
        enterSystemScope('test: crm automatic creation', () =>
          (
            h.container.resolve('crmOpportunityService') as {
              createForDocument(input: unknown): Promise<{ id: string } | 'already-linked'>;
            }
          ).createForDocument({
            title: 'EXT-RACE order',
            organizationId: TEST_ORGANIZATION_ID,
            currency: 'PLN',
            salesChannelId: null,
            source: 'order',
            document: { kind: 'order', id: randomUUID() },
          }),
        );
      // Somebody is moving the start of the workflow to another status and
      // removing the old one, and has not committed: the creation reads `new`.
      const em = h.em().fork();
      await em.begin();
      const run = (sql: string) => em.getConnection().execute(sql, [], 'run', em.getTransactionContext());
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        await em.commit();
      };
      try {
        await run(`update "crm_opportunity_statuses" set "is_initial" = false where "code" = 'new'`);
        await run(`update "crm_opportunity_statuses" set "is_initial" = true where "code" = 'qualified'`);
        await run(`delete from "crm_opportunity_status_transitions" where 'new' in ("from_status_code", "to_status_code")`);
        await run(`delete from "crm_opportunity_statuses" where "code" = 'new'`);
        const creating = create();
        const waiting = await Promise.race([
          creating.then(() => false),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 400)),
        ]);
        expect(waiting).toBe(true);
        await release();

        // Nobody is there to retry a subscriber: the document still gets its Opportunity.
        const created = await creating;
        expect(created).not.toBe('already-linked');
        expect((await organizationOpportunities()).map((row) => row.statusCode)).toEqual(['qualified']);
      } finally {
        await release();
        await h.em().getConnection().execute(`delete from "crm_opportunities" where "title" like 'EXT-RACE%'`);
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });

  describe('findings 7, 9 and 10 — what is asked with a date, a cursor or a tag', () => {
    it.each([
      '/analytics/handling-time?from=2026-02-31&to=2026-03-01',
      '/analytics/time-in-status?from=2026-01-01&to=2026-13-01',
      '/analytics/rep-effectiveness?from=0000-01-01&to=2026-01-01',
      '/analytics/top-opportunities?from=2026-04-31&to=2026-05-01',
      '/analytics/average-value?from=2026-01-01&to=2025-02-29',
      '/board?createdFrom=2026-02-30',
      '/opportunities?createdTo=2026-06-31',
    ])('answers 400 for %s', async (path) => {
      const response = await call('GET', path);
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it.each(['limit=abc', 'limit=0', 'limit=-1', 'limit=100000', 'cursor=not-a-cursor', 'cursor=eyJvIjotMX0'])(
      'answers 400 for a change history asked with %s',
      async (query) => {
        const opportunity = await createCrmOpportunity(h);
        const response = await call('GET', `/opportunities/${opportunity.id}/history?${query}`);
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      },
    );

    it('sorts by the effective value under a tag filter, and the board adds the same Opportunities', async () => {
      const hot = await createCrmTag(h, `ext-hot-${randomUUID().slice(0, 6)}`);
      const big = await createCrmTag(h, `ext-big-${randomUUID().slice(0, 6)}`);
      const make = async (manualValue: string, tagIds: string[]) =>
        (await createCrmOpportunity(h, { title: `EXT-TAG ${manualValue}`, manualValue, tagIds })).id;
      const low = await make('10.00', [hot.id, big.id]);
      const high = await make('900.00', [hot.id, big.id]);
      await make('5000.00', [hot.id]);
      await make('7000.00', []);
      const tags = `tagId=${hot.id}&tagId=${big.id}`;

      const listed = await call('GET', `/opportunities?sort=value&order=desc&${tags}`, crmOnly.cookies);
      expect(listed.statusCode, listed.body).toBe(200);
      expect((listed.json() as { data: Array<{ id: string }> }).data.map((row) => row.id)).toEqual([high, low]);

      const board = await call('GET', `/board?${tags}&assignedAdminUserId=unassigned`, crmOnly.cookies);
      expect(board.statusCode, board.body).toBe(200);
      const columns = (
        board.json() as {
          data: { columns: Array<{ count: number; valueTotals: Array<{ currency: string; total: string }> }> };
        }
      ).data.columns;
      const unassigned = await call(
        'GET',
        `/opportunities?${tags}&assignedAdminUserId=unassigned&limit=200`,
        crmOnly.cookies,
      );
      const expected = (unassigned.json() as { data: Array<{ value: string | null }> }).data;
      expect(columns.reduce((sum, column) => sum + column.count, 0)).toBe(expected.length);
      const total = columns
        .flatMap((column) => column.valueTotals)
        .reduce((sum, entry) => sum + Number(entry.total), 0);
      expect(total).toBe(expected.reduce((sum, row) => sum + Number(row.value ?? 0), 0));
    });
  });

  describe('finding 1 — every link to an attachment is a download', () => {
    it('hands out a download link from the upload, from attaching a library file and from the list', async () => {
      const store = await useTemporaryAssetStore(h);
      const assets: string[] = [];
      try {
        const opportunity = await createCrmOpportunity(h);
        const uploaded = await uploadCrmAttachment(h, opportunity.id, {
          filename: 'photo.png',
          mime: 'image/png',
          value: TINY_PNG,
        });
        expect(uploaded.statusCode, uploaded.body).toBe(201);
        const first = (uploaded.json() as { data: { assetId: string; url: string | null } }).data;
        assets.push(first.assetId);

        const asset = await seedCrmAsset(h.em());
        assets.push(asset.id);
        const attached = await call('POST', `/opportunities/${opportunity.id}/attachments`, CRM_ADMIN, {
          assetId: asset.id,
        });
        expect(attached.statusCode, attached.body).toBe(201);
        const second = (attached.json() as { data: { url: string | null } }).data;

        const listed = await call('GET', `/opportunities/${opportunity.id}/attachments`);
        const urls = [
          first.url,
          second.url,
          ...(listed.json() as { data: Array<{ url: string | null }> }).data.map((row) => row.url),
        ];
        expect(urls).toHaveLength(4);
        for (const url of urls) {
          expect(new URL(url ?? '', 'http://localhost').searchParams.get('download'), String(url)).toBe('1');
        }

        // A file of the library that a browser would run is refused by id as well.
        const page = await seedCrmAsset(h.em(), { filename: 'offer.html', mimeType: 'text/html' });
        assets.push(page.id);
        const refused = await call('POST', `/opportunities/${opportunity.id}/attachments`, CRM_ADMIN, {
          assetId: page.id,
        });
        expect(refused.statusCode, refused.body).toBe(415);
        expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
      } finally {
        await removeCrmAssets(h.em(), assets);
        await store.undo();
      }
    });
  });
});
