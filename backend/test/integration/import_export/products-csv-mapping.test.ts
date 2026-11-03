import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createImportProfile } from '../../helpers/import-profile.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T080; US4 #1–#5, #8; FR-040…FR-043,
 * FR-047; SC-005; `contracts/import-profiles-and-csv.md` §2) — a products file mapped by an import
 * profile: the source language for Global writes Global, a mapped locale writes its Channel ×
 * language targets and nothing else, an unmapped locale is a run warning naming the locale and the
 * product count, a target the product is not in is reported for that row, a scope column and a
 * mapped locale column on one cell is `IMPORT_CELL_CONFLICT`; the header grammar, the caps, the
 * profile requirement and the profile snapshot.
 *
 * The C×L writes need `catalog`'s `ProductImportRow` v2 writer (T084, S1): until it lands the
 * "writes" assertions are RED and the refusals / warnings are green.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('170 — products CSV through an import profile [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let vipId = '';
  let retailId = '';
  let profileId = '';
  let inVip: MinimumProductFixture;
  let retailOnly: MinimumProductFixture;

  const post = (csv: string, query: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products${query}`,
      ...ADMIN,
      headers: { 'content-type': 'text/csv' },
      payload: csv,
    });
  const withProfile = (csv: string, extra = '') => post(csv, `?profileId=${profileId}${extra}`);
  type Report = {
    imported: number;
    errors: Array<{ rowNumber: number; reason: string }>;
    warnings?: Array<{ kind: string; locale: string; sourceChannel: string | null; products: number }>;
    fieldErrors?: Array<{ rowNumber: number; column: string; code: string }>;
    cellCounts?: Array<{ column: string; null: number; inherit: number }>;
  };
  const reportOf = (res: { json(): unknown }) => (res.json() as { data: Report }).data;

  async function scoped(productId: string, scope: Record<string, string>) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/scoped-values?${new URLSearchParams(scope).toString()}`,
      ...ADMIN,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { fields: { name: { value: string | null; source: string } } } }).data.fields;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    inVip = await createMinimumProduct(em, { sku: `S170-MAP-A-${RUN}`, nameEn: 'Drill X', namePl: 'Drill X', channelIds: [vipId, retailId] });
    retailOnly = await createMinimumProduct(em, { sku: `S170-MAP-B-${RUN}`, nameEn: 'Saw', namePl: 'Saw', channelIds: [retailId] });
    profileId = await createImportProfile(h, {
      sourceLanguageForGlobal: 'en_US',
      localeMapping: [{ sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: vipId, languageCode: 'pl-PL' }] }],
    });
  });

  afterAll(async () => {
    if (!h) return;
    await teardownBackendServer(h);
  });

  it('writes the Global source to Global and the mapped locale to its C x L target only (US4 #1, #2, FR-047)', async () => {
    const res = await withProfile(`sku,name[en_US],name[pl_PL]\n${inVip.sku},Drill X ${RUN},Wiertarka X ${RUN}\n`);
    expect(res.statusCode, res.body).toBe(200);
    expect(reportOf(res)).toMatchObject({ imported: 1, errors: [] });
    expect((await scoped(inVip.id, {})).name.value).toBe(`Drill X ${RUN}`);
    const vipPl = (await scoped(inVip.id, { channelId: vipId, languageCode: 'pl-PL' })).name;
    expect(vipPl).toMatchObject({ value: `Wiertarka X ${RUN}`, source: 'set' });
    // Not mapped there: the retail channel x Polish inherits the Global name.
    expect((await scoped(inVip.id, { channelId: retailId, languageCode: 'pl-PL' })).name.value).toBe(`Drill X ${RUN}`);
  });

  it('warns once per unmapped locale with the product count and writes it nowhere (US4 #3, SC-005)', async () => {
    const res = await withProfile(`sku,name[de_DE]\n${inVip.sku},Bohrmaschine\n${retailOnly.sku},Saege\n`);
    expect(res.statusCode, res.body).toBe(200);
    expect(reportOf(res).warnings).toEqual([{ kind: 'unmapped_locale', locale: 'de_DE', sourceChannel: null, products: 2 }]);
    expect(reportOf(res).imported).toBe(0);
  });

  it('reports a mapped target the product does not belong to, for that row (US4 #4, FR-042)', async () => {
    const res = await withProfile(`sku,name[pl_PL]\n${retailOnly.sku},Pila\n`);
    expect(res.statusCode, res.body).toBe(200);
    expect(reportOf(res).fieldErrors).toEqual([{ rowNumber: 2, column: 'name[pl_PL]', code: 'not_a_member' }]);
  });

  it('refuses a row whose scope column and mapped locale column land on one cell (IMPORT_CELL_CONFLICT)', async () => {
    const res = await withProfile(`sku,name@pl_b2b_vip/pl-PL,name[pl_PL]\n${inVip.sku},One,Two\n`);
    expect(res.statusCode, res.body).toBe(200);
    const report = reportOf(res);
    expect(report.imported).toBe(0);
    expect(report.errors[0]?.reason).toContain('IMPORT_CELL_CONFLICT');
  });

  it('refuses a products import without a profile, and with an unknown one', async () => {
    const none = await post(`sku,name\n${inVip.sku},x\n`, '');
    expect(none.statusCode, none.body).toBe(422);
    expect((none.json() as { error: { code: string } }).error.code).toBe('IMPORT_PROFILE_REQUIRED');
    const unknown = await post(`sku,name\n${inVip.sku},x\n`, `?profileId=${randomUUID()}`);
    expect(unknown.statusCode, unknown.body).toBe(404);
    expect((unknown.json() as { error: { code: string } }).error.code).toBe('IMPORT_PROFILE_NOT_FOUND');
  });

  it('refuses a profile whose entity is not products at save (the only entity with a mapping)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/import-export/profiles',
      ...ADMIN,
      payload: { name: `Stock ${RUN}`, entity: 'stock', sourceLanguageForGlobal: null, localeMapping: [] },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it.each([
    ['an unknown channel', 'name@nowhere_channel'],
    ['a language the channel does not offer', 'name@pl_b2b_vip/de-DE'],
    ['an unknown column', 'name_en'],
    ['two headers equal after normalisation', 'name[pl_PL],name[pl-pl]'],
    ['an over-long code', `name@${'c'.repeat(101)}`],
    ['injection characters in a code', 'name@pl_b2b_vip<script>'],
  ])('refuses the whole file for %s, writing nothing (FR-043)', async (_label, columns) => {
    const width = columns.split(',').length;
    const res = await withProfile(`sku,${columns}\n${inVip.sku}${',x'.repeat(width)}\n`);
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses more than 500 columns and more than 50 000 rows', async () => {
    const wide = Array.from({ length: 501 }, (_, i) => `name@c${i}`).join(',');
    expect((await withProfile(`sku,${wide}\n`)).statusCode).toBe(400);
    const tall = `sku,name\n${`${inVip.sku},x\n`.repeat(50_001)}`;
    expect((await withProfile(tall)).statusCode).toBe(400);
  });

  it('refuses a body over 10 MiB before reading it', async () => {
    const res = await withProfile(`sku,name\n${inVip.sku},${'x'.repeat(10 * 1024 * 1024)}\n`);
    expect(res.statusCode).toBe(413);
  });

  it('writes nothing on a dry run, and reports the row it would write', async () => {
    const dry = await withProfile(`sku,name[pl_PL]\n${inVip.sku},Dry ${RUN}\n`, '&dryRun=true');
    expect(dry.statusCode, dry.body).toBe(200);
    expect(reportOf(dry).imported).toBe(1);
    expect((await scoped(inVip.id, { channelId: vipId, languageCode: 'pl-PL' })).name.value).not.toBe(`Dry ${RUN}`);
  });
});
