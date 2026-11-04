import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  QUOTE_REQUEST_DOCUMENT_TYPE,
  quoteRequestDocumentChoicesSchema,
  slugify,
  type QuoteRequestDocumentData,
} from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ensureAdminWithRole } from '../../helpers/admin-search-fixtures.js';
import { ensureSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import { bindOrganizationToDefaultChannel } from '../../helpers/sales-channel-access.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';

/**
 * `specs/153-quote-request-pdf-template/` T038, T045–T048 — the quote PDF's
 * admin routes Q1–Q3 (`contracts/quote-request-document.md` §6): the gate ahead
 * of validation, visibility, the choices, remembering, the resolution order
 * (SC-004), the stale-template fallback, the file, cross-organisation and
 * cross-channel refusals (SC-005), every status exportable, the offer's version
 * untouched (FR-010), and the off-state of the facility (FR-060).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const DT = '/api/v1/admin/document-templates';
const QR = '/api/v1/admin/quote-requests';
const NONE_ID = '00000000-0000-4000-8000-0000001530a2';
const stamp = Date.now();
const NONE_SESSION = `stub-153-none-${stamp}`;
const NONE = { b2b_session: NONE_SESSION };
const REP_SESSION = `stub-153-rep-${stamp}`;
const REP = { b2b_session: REP_SESSION };

interface Choices {
  templates: { id: string; name: string; salesChannelId: string | null; isDefault: boolean }[];
  rememberedTemplateId: string | null;
  rememberedTemplateMissing: boolean;
  effectiveDefaultId: string | null;
  suggestedLanguage: string;
  requesterEmail: string | null;
}

describe('quote request PDF — admin routes Q1–Q3 (spec 153)', () => {
  let h: BackendServerHandle;
  let channelA: string;
  let channelB: string;
  let quoteA: string;
  let quoteB: string;
  let quoteNone: string;
  let foreignQuote: string;

  const raise = async (organizationId = TEST_ORGANIZATION_ID, customerAccountId = TEST_CUSTOMER_ID): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: QR,
      cookies: ADMIN,
      payload: {
        organizationId,
        customerAccountId,
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 8 },
          { productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  };
  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);
  const onChannel = (id: string, channelId: string | null) =>
    sql(`update quote_requests set sales_channel_id = ? where id = ?`, [channelId, id]);
  const quoteRow = async (id: string) =>
    (await sql(`select version, document_template_id, status from quote_requests where id = ?`, [id]))[0] as {
      version: number;
      document_template_id: string | null;
      status: string;
    };

  async function template(name: string, salesChannelId: string | null, setDefault: boolean): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: DT,
      cookies: ADMIN,
      payload: { documentType: QUOTE_REQUEST_DOCUMENT_TYPE, name, salesChannelId, source: { kind: 'built_in' }, setDefault },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }
  const choices = async (id: string, cookies = ADMIN): Promise<Choices> => {
    const res = await h.app.inject({ method: 'GET', url: `${QR}/${id}/document-templates`, cookies });
    expect(res.statusCode, res.body).toBe(200);
    return quoteRequestDocumentChoicesSchema.parse((res.json() as { data: unknown }).data) as Choices;
  };
  const exportPdf = (id: string, query = '', cookies = ADMIN) =>
    h.app.inject({ method: 'GET', url: `${QR}/${id}/pdf${query}`, cookies });
  const audits = (id: string) =>
    h.em().find(AuditLogEntry, { objectType: 'quote_request', objectId: id, action: 'quote_request.set_document_template' });

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(`delete from document_templates where document_type = ?`, [QUOTE_REQUEST_DOCUMENT_TYPE]);
    await ensureAdminWithRole(h, NONE_ID, 'quote_pdf_none', ['orders:read']);
    ADMIN_COOKIES[NONE_SESSION] = { adminUserId: NONE_ID };
    const em = h.em();
    const a = await ensureSalesChannel(em, `qr153_a_${stamp}`);
    a.defaultLanguage = 'pl-PL';
    a.languages = ['pl-PL', 'en-US'];
    await em.persistAndFlush(a);
    channelA = a.id;
    channelB = (await ensureSalesChannel(em, `qr153_b_${stamp}`)).id;
    quoteA = await raise();
    quoteB = await raise();
    quoteNone = await raise();
    await onChannel(quoteA, channelA);
    await onChannel(quoteB, channelB);

    // A representative assigned to another organisation only (SC-005).
    let foreignOrg = '';
    await withSystemScope('153: a representative of another organisation', async () => {
      const fork = h.orm.em.fork();
      let role = await fork.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['rfqs:handle', 'price_lists:read'];
      if (!role) role = fork.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      else role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      await fork.persistAndFlush(role);
      const org = fork.create(Organization, {
        name: `153 foreign ${stamp}`,
        taxId: `PL153F${String(stamp).slice(-7)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
      });
      const rep = fork.create(AdminUser, {
        email: `153-rep-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '153',
        lastName: 'Rep',
      });
      await fork.persistAndFlush([org, rep]);
      const account = fork.create(CustomerAccount, {
        organizationId: org.id,
        email: `153-foreign-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        firstName: '153',
        lastName: 'Foreign',
      });
      await fork.persistAndFlush([account, fork.create(OrganizationSalesRepAssignment, { organizationId: org.id, adminUserId: rep.id })]);
      foreignOrg = org.id;
      ADMIN_COOKIES[REP_SESSION] = { adminUserId: rep.id };
      foreignQuote = account.id;
    });
    // `foreignQuote` held the account id above; raise the foreign quote now.
    // The admin request below names no channel, so it is raised on the system
    // default, which `createOnBehalf` accepts only for an Organization assigned
    // to it (feature 163, owner decision 2026-10-29 "A").
    await bindOrganizationToDefaultChannel(h, foreignOrg);
    foreignQuote = await raise(foreignOrg, foreignQuote);
  }, 90_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[NONE_SESSION];
    delete ADMIN_COOKIES[REP_SESSION];
    await sql(`delete from document_templates where document_type = ?`, [QUOTE_REQUEST_DOCUMENT_TYPE]);
    await teardownBackendServer(h);
  });

  describe('the gate, ahead of validation', () => {
    it('401 without a session and 403 without rfqs:handle, on all four routes, even with nonsense', async () => {
      const id = randomUUID();
      const routes = [
        ['GET', `${QR}/${id}/document-templates`],
        ['PUT', `${QR}/${id}/document-template`],
        ['GET', `${QR}/${id}/pdf?templateId=nope`],
        ['POST', `${QR}/${id}/pdf/send`],
      ] as const;
      for (const [method, url] of routes) {
        expect((await h.app.inject({ method, url, payload: { nonsense: true } })).statusCode, `${method} ${url}`).toBe(401);
        expect((await h.app.inject({ method, url, cookies: NONE, payload: { nonsense: true } })).statusCode, `${method} ${url}`).toBe(403);
      }
    });

    it('an unknown quote is 404; a representative of another organisation gets the same 404 (SC-005)', async () => {
      expect((await exportPdf(randomUUID())).statusCode).toBe(404);
      expect((await h.app.inject({ method: 'GET', url: `${QR}/${randomUUID()}/document-templates`, cookies: ADMIN })).statusCode).toBe(404);
      for (const url of [`${QR}/${quoteA}/document-templates`, `${QR}/${quoteA}/pdf`]) {
        const res = await h.app.inject({ method: 'GET', url, cookies: REP });
        expect(res.statusCode, url).toBe(404);
      }
      const put = await h.app.inject({ method: 'PUT', url: `${QR}/${quoteA}/document-template`, cookies: REP, payload: { documentTemplateId: null } });
      expect(put.statusCode).toBe(404);
      // …and that representative does reach their own organisation's quote.
      expect((await h.app.inject({ method: 'GET', url: `${QR}/${foreignQuote}/document-templates`, cookies: REP })).statusCode).toBe(200);
    });
  });

  describe('with only the built-in layout', () => {
    it('Q1 offers no template, the built-in languages, the channel’s language and the requester', async () => {
      const a = await choices(quoteA);
      expect(a).toMatchObject({ templates: [], rememberedTemplateId: null, rememberedTemplateMissing: false, effectiveDefaultId: null, suggestedLanguage: 'pl-PL' });
      expect(a.requesterEmail).toMatch(/@/);
      // A quote with no channel: the system default channel's language.
      expect((await choices(quoteNone)).suggestedLanguage).toMatch(/^[a-z]{2}/);
    });

    it('Q3 prints the built-in layout, as a file named after the quote, and remembers nothing', async () => {
      const res = await exportPdf(quoteA);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.rawPayload.subarray(0, 5).toString('utf8')).toBe('%PDF-');
      const businessId = ((await h.app.inject({ method: 'GET', url: `${QR}/${quoteA}`, cookies: ADMIN })).json() as { data: { businessId: string } }).data.businessId;
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${slugify(businessId, { preserve: '_', maxLength: 120, fallback: 'quote-request' })}.pdf"`);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-document-template-source']).toBe('built_in');
      expect(res.headers['x-document-template-id']).toBe('');
      expect(res.headers['x-document-template-missing']).toBe('false');
      expect((await quoteRow(quoteA)).document_template_id).toBeNull();
    });

    it('every quote status is exportable (Q3) — a canceled quote too', async () => {
      const id = await raise();
      const cancel = await h.app.inject({ method: 'POST', url: `${QR}/${id}/cancel`, cookies: ADMIN, headers: { 'if-match': '"1"' }, payload: { reason: 'test' } });
      expect([200, 409]).toContain(cancel.statusCode);
      expect((await exportPdf(id)).statusCode).toBe(200);
    });
  });

  describe('choosing and remembering (FR-002–FR-007, SC-004, SC-005)', () => {
    let globalDefault: string;
    let globalOther: string;
    let channelBDefault: string;

    beforeAll(async () => {
      globalDefault = await template('Global default', null, true);
      globalOther = await template('Another global', null, false);
      channelBDefault = await template('Channel B', channelB, true);
    });

    it('Q1 answers global ∪ own channel — channel first — and the effective default', async () => {
      const a = await choices(quoteA);
      expect(a.templates.map((t) => t.id)).toEqual([globalOther, globalDefault]);
      expect(a.effectiveDefaultId).toBe(globalDefault);
      const b = await choices(quoteB);
      expect(b.templates.map((t) => t.id)).toEqual([channelBDefault, globalOther, globalDefault]);
      expect(b.effectiveDefaultId).toBe(channelBDefault);
      expect((await choices(quoteNone)).templates.map((t) => t.id)).not.toContain(channelBDefault);
    });

    it('without a choice: the channel default, else the global default (SC-004)', async () => {
      expect((await exportPdf(quoteB)).headers['x-document-template-id']).toBe(channelBDefault);
      const a = await exportPdf(quoteA);
      expect(a.headers['x-document-template-id']).toBe(globalDefault);
      expect(a.headers['x-document-template-source']).toBe('default');
      expect((await quoteRow(quoteA)).document_template_id).toBeNull();
    });

    it('an explicit choice is remembered, audited once, and leaves the offer version alone (FR-005, FR-010)', async () => {
      const before = await quoteRow(quoteA);
      const res = await exportPdf(quoteA, `?templateId=${globalOther}&language=en-US`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['x-document-template-id']).toBe(globalOther);
      expect(res.headers['x-document-template-source']).toBe('explicit');
      const after = await quoteRow(quoteA);
      expect(after.document_template_id).toBe(globalOther);
      expect(after.version).toBe(before.version);
      expect((await audits(quoteA)).map((row) => [row.stateBefore, row.stateAfter])).toEqual([
        [{ documentTemplateId: null }, { documentTemplateId: globalOther }],
      ]);
      // The same choice again records nothing; no choice uses the remembered one.
      await exportPdf(quoteA, `?templateId=${globalOther}`);
      expect(await audits(quoteA)).toHaveLength(1);
      expect((await exportPdf(quoteA)).headers['x-document-template-id']).toBe(globalOther);
      expect((await choices(quoteA)).rememberedTemplateId).toBe(globalOther);
      const detail = (await h.app.inject({ method: 'GET', url: `${QR}/${quoteA}`, cookies: ADMIN })).json() as { data: { documentTemplateId: string | null } };
      expect(detail.data.documentTemplateId).toBe(globalOther);
    });

    it('a template of another channel is neither offered nor accepted (SC-005)', async () => {
      const res = await exportPdf(quoteA, `?templateId=${channelBDefault}`);
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe('DOCUMENT_TEMPLATE_NOT_SELECTABLE');
      const put = await h.app.inject({ method: 'PUT', url: `${QR}/${quoteA}/document-template`, cookies: ADMIN, payload: { documentTemplateId: channelBDefault } });
      expect(put.statusCode).toBe(422);
      expect((await quoteRow(quoteA)).document_template_id).toBe(globalOther);
    });

    it('Q2 forgets with null, audited', async () => {
      const put = await h.app.inject({ method: 'PUT', url: `${QR}/${quoteA}/document-template`, cookies: ADMIN, payload: { documentTemplateId: null } });
      expect(put.statusCode, put.body).toBe(200);
      expect((put.json() as { data: { documentTemplateId: string | null } }).data.documentTemplateId).toBeNull();
      expect(await audits(quoteA)).toHaveLength(2);
      expect((await h.app.inject({ method: 'PUT', url: `${QR}/${quoteA}/document-template`, cookies: ADMIN, payload: { documentTemplateId: 'x' } })).statusCode).toBe(400);
    });

    it('a deleted remembered template falls back to the default, says so, and is never cleared (FR-007)', async () => {
      const doomed = await template('Doomed', null, false);
      await h.app.inject({ method: 'PUT', url: `${QR}/${quoteA}/document-template`, cookies: ADMIN, payload: { documentTemplateId: doomed } });
      const del = await h.app.inject({ method: 'DELETE', url: `${DT}/${doomed}`, cookies: ADMIN, payload: { expectedVersion: 1 } });
      expect(del.statusCode, del.body).toBe(204);
      const c = await choices(quoteA);
      expect(c).toMatchObject({ rememberedTemplateId: doomed, rememberedTemplateMissing: true, effectiveDefaultId: globalDefault });
      const res = await exportPdf(quoteA);
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-document-template-id']).toBe(globalDefault);
      expect(res.headers['x-document-template-missing']).toBe('true');
      expect((await quoteRow(quoteA)).document_template_id).toBe(doomed);
    });
  });

  describe('the built-in layout through the facility (FR-024, US3)', () => {
    type Renderer = {
      buildDefinition(input: Record<string, unknown>): Promise<{ definition: { content: unknown[] } }>;
    };
    const headerOf = async (data: QuoteRequestDocumentData, language: string): Promise<string[]> => {
      const renderer = h.container.resolve('documentRenderer') as Renderer;
      const built = await renderer.buildDefinition({ documentType: QUOTE_REQUEST_DOCUMENT_TYPE, salesChannelId: null, language, data, tree: undefined, templateId: undefined });
      const table = (built.definition.content as { stack?: { table?: { body: { text: string }[][] } }[] }[]).find((node) => node.stack?.[0]?.table);
      return table!.stack![0]!.table!.body[0]!.map((cell) => cell.text);
    };
    const sample = async (language: string): Promise<QuoteRequestDocumentData> =>
      ((await h.app.inject({ method: 'GET', url: `${DT}/types/${QUOTE_REQUEST_DOCUMENT_TYPE}?language=${language}`, cookies: ADMIN })).json() as {
        data: { sample: QuoteRequestDocumentData };
      }).data.sample;

    it('prints list price and discount % only when a line is discounted, in the PDF language', async () => {
      await sql(`delete from document_templates where document_type = ?`, [QUOTE_REQUEST_DOCUMENT_TYPE]);
      const discounted = await sample('en-US');
      const header = await headerOf(discounted, 'en-US');
      expect(header).toEqual(expect.arrayContaining(['List price', 'Discount %', 'Price after discount']));
      const flat = { ...discounted, lines: discounted.lines.map((line) => ({ ...line, agreedUnitPrice: line.referenceUnitPrice })) };
      const plain = await headerOf(flat, 'en-US');
      expect(plain).not.toContain('List price');
      expect(plain).not.toContain('Discount %');
      expect(await headerOf(await sample('pl-PL'), 'pl-PL')).toEqual(expect.arrayContaining(['Lp.', 'Cena katalogowa', 'Rabat %']));
    });
  });

  /**
   * `specs/159-quote-request-item-groups/` T053 — the quote's groups on the PDF
   * (FR-041–FR-044, SC-004): asserted on the definition the facility builds for
   * a real export, read through a spy on the renderer the render port resolves to.
   */
  describe('line groups on the PDF (159 US3)', () => {
    type Cell = { text: string; colSpan?: number };
    type Built = { definition: { content: { stack?: { table?: { body: Cell[][] } }[] }[] } };
    let groupedQuote: string;

    const exportedBody = async (id: string): Promise<{ body: string[][]; source: string | undefined }> => {
      const renderer = h.container.resolve('documentRenderer') as { buildDefinition: (input: unknown) => Promise<Built> };
      const spy = vi.spyOn(renderer, 'buildDefinition');
      try {
        const res = await exportPdf(id, '?language=en-US');
        expect(res.statusCode, res.body).toBe(200);
        expect(spy).toHaveBeenCalledTimes(1);
        const built = await (spy.mock.results[0]!.value as Promise<Built>);
        const table = built.definition.content.find((node) => node.stack?.[0]?.table);
        return {
          // pdfmake fills the cells a `colSpan` covers in place; they read as empty here.
          body: table!.stack![0]!.table!.body.map((row) => row.map((cell) => cell?.text ?? '')),
          source: res.headers['x-document-template-source'] as string | undefined,
        };
      } finally {
        spy.mockRestore();
      }
    };
    const firstCells = (body: string[][]) => body.map((row) => row[0] ?? '');

    beforeAll(async () => {
      await sql(`delete from document_templates where document_type = ?`, [QUOTE_REQUEST_DOCUMENT_TYPE]);
      const res = await h.app.inject({
        method: 'POST',
        url: QR,
        cookies: ADMIN,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          groups: [
            { key: 'a', name: 'Hall A' },
            { key: 'b', name: 'Hall B' },
            { key: 'empty', name: 'Nothing here' },
          ],
          items: [
            { productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 10, groupKey: 'b' },
            { productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 8, groupKey: 'a' },
            { productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 2 },
            { productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10, groupKey: 'a' },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      groupedQuote = (res.json() as { data: { id: string } }).data.id;
    });

    afterAll(async () => {
      await sql(`delete from document_templates where document_type = ? and name like '159 %'`, [QUOTE_REQUEST_DOCUMENT_TYPE]);
    });

    const expectSections = (body: string[][]) => {
      const cells = firstCells(body);
      // Heading, lines, subtotal rows per non-empty group in saved order; Other items last; positions 1…n.
      const headings = cells.filter((cell) => cell === 'Hall A · 2 items' || cell === 'Hall B · 1 item' || cell === 'Other items · 1 item');
      expect(headings).toEqual(['Hall A · 2 items', 'Hall B · 1 item', 'Other items · 1 item']);
      expect(cells.filter((cell) => /^\d+$/.test(cell))).toEqual(['1', '2', '3', '4']);
      expect(cells.indexOf('Hall A · 2 items')).toBeLessThan(cells.indexOf('1'));
      expect(cells.indexOf('Hall B · 1 item')).toBeGreaterThan(cells.indexOf('2'));
      expect(cells.indexOf('Other items · 1 item')).toBeGreaterThan(cells.indexOf('3'));
      expect(cells.join('|')).not.toContain('Nothing here');
      // One subtotal row per totals row of the table, over the section (Hall A: 3 × 8 + 2 × 10 = 44).
      const hallA = body.slice(cells.indexOf('Hall A · 2 items'), cells.indexOf('Hall B · 1 item'));
      expect(hallA.some((row) => row[0] === 'Total net' && String(row.at(-1) ?? '').includes('44.00'))).toBe(true);
    };

    it('the built-in layout prints the groups without being configured (FR-041, FR-044)', async () => {
      const { body, source } = await exportedBody(groupedQuote);
      expect(source).toBe('built_in');
      expectSections(body);
    });

    it('a template saved before the feature — grouping null, or no grouping key — prints them too', async () => {
      const id = await template('159 pre-feature', null, true);
      const { body, source } = await exportedBody(groupedQuote);
      expect(source).toBe('default');
      expectSections(body);

      // A table stored with no `grouping` key at all.
      const [row] = (await sql(`select content from document_templates where id = ?`, [id])) as { content: { languages: Record<string, { content: { type: string; props: Record<string, unknown> }[] }> } }[];
      for (const tree of Object.values(row!.content.languages)) {
        for (const node of tree.content) if (node.type === 'document_templates.ItemsTable') delete node.props['grouping'];
      }
      await sql(`update document_templates set content = ? where id = ?`, [JSON.stringify(row!.content), id]);
      expectSections((await exportedBody(groupedQuote)).body);
    });

    it('a table set to No grouping prints the grouped quote flat', async () => {
      const [row] = (await sql(`select id, content from document_templates where document_type = ? and name = '159 pre-feature'`, [QUOTE_REQUEST_DOCUMENT_TYPE])) as { id: string; content: { languages: Record<string, { content: { type: string; props: Record<string, unknown> }[] }> } }[];
      for (const tree of Object.values(row!.content.languages)) {
        for (const node of tree.content) if (node.type === 'document_templates.ItemsTable') node.props['grouping'] = { by: 'none' };
      }
      await sql(`update document_templates set content = ? where id = ?`, [JSON.stringify(row!.content), row!.id]);
      const cells = firstCells((await exportedBody(groupedQuote)).body);
      expect(cells.slice(1)).toEqual(['1', '2', '3', '4']);
    });

    it('a quote with no group prints its lines as before — no heading or subtotal row (SC-004)', async () => {
      await sql(`delete from document_templates where document_type = ? and name like '159 %'`, [QUOTE_REQUEST_DOCUMENT_TYPE]);
      const cells = firstCells((await exportedBody(quoteNone)).body);
      expect(cells.slice(1)).toEqual(['1', '2']);
    });
  });

  describe('off-state (FR-060, SC-006)', () => {
    it('while document templates are off every quote PDF route answers 503 and the remembered choice is kept', async () => {
      const remembered = (await quoteRow(quoteB)).document_template_id;
      await withModuleOff('document_templates', 'deactivated', async () => {
        for (const [method, url, payload] of [
          ['GET', `${QR}/${quoteB}/document-templates`, undefined],
          ['PUT', `${QR}/${quoteB}/document-template`, { documentTemplateId: null }],
          ['GET', `${QR}/${quoteB}/pdf`, undefined],
          ['POST', `${QR}/${quoteB}/pdf/send`, { recipients: ['a@example.com'] }],
        ] as const) {
          const res = await h.app.inject({ method, url, cookies: ADMIN, ...(payload ? { payload } : {}) });
          expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(503);
          expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
        }
      });
      expect((await quoteRow(quoteB)).document_template_id).toBe(remembered);
      expect((await exportPdf(quoteB)).statusCode).toBe(200);
    });
  });
});
