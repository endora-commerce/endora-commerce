import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { createImportProfile } from '../../helpers/import-profile.js';

/**
 * Feature 163, Phase 19 (T121) — scoped status in the products CSV
 * (`specs/163-product-data-scopes/` research R17; FR-092).
 *
 * - the export carries `status@<channel code>` and `status@<channel code>/<language>`
 *   columns: the override at that scope, empty where the scope inherits;
 * - importing the exported file unchanged changes nothing, and an edited column
 *   writes exactly that scope (an empty cell is "use inherited");
 * - a file without the columns touches no scope;
 * - the whole-file rule is unchanged: one rejected row — an unknown channel, a
 *   value for a channel the product is not in or a language it does not offer, a
 *   value that is not a status — applies nothing.
 *
 * Feature 174 (`specs/174-product-editor-scope-switcher/contracts/import-profiles-and-csv.md`,
 * `write-encoding.md`) moved this file onto the one write encoding and grammar: an inherited
 * scope exports `INHERIT` and an empty cell is **no change**; the Global columns are `name` and
 * `description`; a products import runs with a profile; an unknown channel or a language the
 * channel does not offer refuses the file (400), a value that is not a status is a field error,
 * and each product applies in its own transaction.
 *
 * Final QA Q-L2 (FR-092, SC-009) — an import never archives and never restores: a
 * status cell, global or scoped, moves the status and leaves `archived_at` as it was.
 *
 * Status values are taken from the contract's enumeration, never hard-coded here
 * beyond the two the fixture sets.
 */
describe('Products CSV — scoped status columns (spec 163, T121)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const channelCode = `csv163-${run}`;
  let channelId: string;
  let productId: string;
  let outsiderId: string;
  let profileId: string;
  const sku = `CSV163-${run}-A`;
  const outsiderSku = `CSV163-${run}-B`;

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  const channelStatus = async (id: string): Promise<string | null> =>
    (await sql<Array<{ status: string | null }>>(
      `select status from product_channel_scopes where product_id = ? and sales_channel_id = ?`,
      [id, channelId],
    ))[0]?.status ?? null;

  const languageStatus = async (id: string, languageCode: string): Promise<string | null> =>
    (await sql<Array<{ status: string }>>(
      `select status from product_channel_language_scopes where product_id = ? and sales_channel_id = ? and language_code = ?`,
      [id, channelId, languageCode],
    ))[0]?.status ?? null;

  async function exportCsv(): Promise<{ header: string[]; row: (skuValue: string) => Record<string, string> }> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/export/products.csv', ...admin });
    expect(res.statusCode, res.body).toBe(200);
    const lines = res.body.split(/\r?\n/).filter((line) => line.length > 0);
    const header = lines[0]!.split(',');
    return {
      header,
      row: (skuValue) => {
        const line = lines.find((l) => l.split(',')[1] === skuValue);
        if (!line) throw new Error(`no exported row for ${skuValue}`);
        const cells = line.split(',');
        return Object.fromEntries(header.map((column, i) => [column, cells[i] ?? '']));
      },
    };
  }

  const post = (lines: string[]) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products?profileId=${profileId}`,
      ...admin,
      headers: { 'content-type': 'text/csv' },
      payload: lines.join('\n'),
    });

  async function importCsv(lines: string[]) {
    const res = await post(lines);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { imported: number; errors: Array<{ row?: number; reason: string }> } }).data;
  }

  const base = 'sku,status,visibility,name,description';

  beforeAll(async () => {
    h = await setupBackendServer();
    profileId = await createImportProfile(h);
    channelId = randomUUID();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, '{"en-US":"163 csv"}'::jsonb, 'pl-PL', '["pl-PL","en-US"]'::jsonb, '["PLN"]'::jsonb, 'PLN',
               true, now(), now())`,
      [channelId, channelCode],
    );
    productId = randomUUID();
    outsiderId = randomUUID();
    for (const [id, skuValue] of [
      [productId, sku],
      [outsiderId, outsiderSku],
    ] as const) {
      await sql(
        `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
         values (?, ?, ?, 'simple', 'active', 'Csv product', null, now(), now())`,
        [id, skuValue, skuValue.toLowerCase()],
      );
    }
    // Only the first product is in the channel.
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/scopes`,
      ...admin,
      payload: {
        channels: [{ channelId, status: 'inactive', languageStatuses: [{ languageCode: 'en-US', status: 'active' }] }],
      },
    });
    expect(patch.statusCode, patch.body).toBe(200);
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from product_channel_language_scopes where product_id in (?, ?)`, [productId, outsiderId]);
      await sql(`delete from product_channel_scopes where product_id in (?, ?)`, [productId, outsiderId]);
      await sql(`delete from sales_channel_products where product_id in (?, ?)`, [productId, outsiderId]);
      await sql(`delete from products where id in (?, ?)`, [productId, outsiderId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  it('exports the override at each channel and channel × language scope, INHERIT where it inherits', async () => {
    const { header, row } = await exportCsv();
    // `contracts/import-profiles-and-csv.md` §3: a column only where some exported product holds an
    // own value there. Nobody holds a pl-PL status, so the file has no such column.
    expect(header).toEqual(expect.arrayContaining([`status@${channelCode}`, `status@${channelCode}/en-US`]));
    expect(header).not.toContain(`status@${channelCode}/pl-PL`);
    expect(row(sku)).toMatchObject({
      [`status@${channelCode}`]: 'inactive',
      [`status@${channelCode}/en-US`]: 'active',
    });
    // A product outside the channel inherits there too.
    expect(row(outsiderSku)[`status@${channelCode}`]).toBe('INHERIT');
  });

  it('round-trips: the exported values imported unchanged change nothing', async () => {
    const columns = [`status@${channelCode}`, `status@${channelCode}/pl-PL`, `status@${channelCode}/en-US`];
    const { row } = await exportCsv();
    const exported = row(sku);
    const report = await importCsv([
      [base, ...columns].join(','),
      [sku, '', '', '', '', ...columns.map((c) => exported[c] ?? '')].join(','),
    ]);
    expect(report).toMatchObject({ imported: 1, errors: [] });
    expect(await channelStatus(productId)).toBe('inactive');
    expect(await languageStatus(productId, 'pl-PL')).toBeNull();
    expect(await languageStatus(productId, 'en-US')).toBe('active');
  });

  it('writes exactly the edited scopes; INHERIT inherits; a file without the columns touches none', async () => {
    const report = await importCsv([
      `${base},status@${channelCode},status@${channelCode}/pl-PL`,
      `${sku},,,,,INHERIT,inactive`,
    ]);
    expect(report).toMatchObject({ imported: 1, errors: [] });
    expect(await channelStatus(productId)).toBeNull();
    expect(await languageStatus(productId, 'pl-PL')).toBe('inactive');
    expect(await languageStatus(productId, 'en-US')).toBe('active');

    expect(await importCsv([base, `${sku},,,Renamed,`])).toMatchObject({ imported: 1, errors: [] });
    expect(await languageStatus(productId, 'pl-PL')).toBe('inactive');
    expect(await languageStatus(productId, 'en-US')).toBe('active');
  });

  it('refuses an invalid scoped cell and applies nothing of it', async () => {
    const before = [await channelStatus(productId), await languageStatus(productId, 'pl-PL')];
    // A language the channel does not offer, and a channel no one has: the file is refused.
    for (const lines of [
      [`${base},status@${channelCode}/de-DE`, `${sku},,,,,active`],
      [`${base},status@no-such-channel-${run}`, `${sku},,,,,active`],
    ]) {
      const res = await post(lines);
      expect(res.statusCode, lines.join(' | ')).toBe(400);
    }
    // Not a status: a field error, nothing of the row written.
    const sideways = await importCsv([`${base},status@${channelCode}`, `${sku},,,,,sideways`]);
    expect(sideways.imported).toBe(0);
    expect((sideways as { fieldErrors?: unknown[] }).fieldErrors).toEqual([
      { rowNumber: 2, column: `status@${channelCode}`, code: 'invalid' },
    ]);
    // A value for a channel the second product is not in: catalog refuses the cell. A row whose
    // every cell is refused imports nothing, so it is not counted, the same as the "not a status" row.
    const outsider = await importCsv([`${base},status@${channelCode}`, `${outsiderSku},,,,,active`]);
    expect(outsider.imported).toBe(0);
    expect(outsider.errors).toEqual([]);
    expect((outsider as { fieldErrors?: unknown[] }).fieldErrors).toEqual([
      { rowNumber: 2, column: `status@${channelCode}`, code: 'SCOPE_INVALID' },
    ]);
    expect([await channelStatus(productId), await languageStatus(productId, 'pl-PL')]).toEqual(before);
  });

  it('a status import never archives nor restores: archived_at is left as it was (FR-092, SC-009)', async () => {
    const archivedAt = async (id: string): Promise<string | null> => {
      const [row] = await sql<Array<{ archived_at: Date | null; status: string }>>(
        `select archived_at, status from products where id = ?`,
        [id],
      );
      return row?.archived_at ? new Date(row.archived_at).toISOString() : null;
    };
    const globalStatus = async (id: string): Promise<string | undefined> =>
      (await sql<Array<{ status: string }>>(`select status from products where id = ?`, [id]))[0]?.status;
    const stamp = new Date('2026-10-01T08:00:00.000Z');
    try {
      // `inactive` on a live product switches it off; it does not archive it.
      expect(await importCsv([base, `${outsiderSku},inactive,,,`])).toMatchObject({ imported: 1, errors: [] });
      expect(await globalStatus(outsiderId)).toBe('inactive');
      expect(await archivedAt(outsiderId)).toBeNull();

      // `active` on an archived product, globally and at a channel scope: the status
      // moves, the archive stays.
      await sql(`update products set archived_at = ? where id in (?, ?)`, [stamp, outsiderId, productId]);
      expect(await importCsv([base, `${outsiderSku},active,,,`])).toMatchObject({ imported: 1, errors: [] });
      expect(await globalStatus(outsiderId)).toBe('active');
      expect(await archivedAt(outsiderId)).toBe(stamp.toISOString());

      expect(await importCsv([`${base},status@${channelCode}`, `${sku},,,,,active`])).toMatchObject({ imported: 1, errors: [] });
      expect(await channelStatus(productId)).toBe('active');
      expect(await archivedAt(productId)).toBe(stamp.toISOString());
    } finally {
      await sql(`update products set archived_at = null, status = 'active' where id in (?, ?)`, [outsiderId, productId]);
    }
  });
});
