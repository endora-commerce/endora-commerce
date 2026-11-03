// perf-weight: fast — about 2 min locally (2026-10-29: seeding 3 600 assets and 3 600 Task attachments, then 2 × 31 interleaved reads per figure); not yet timed on the CI runner.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { createCrmOpportunity, seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * `specs/166-asset-reference-visibility/` T049 — SC-004 and FR-014 (research
 * R-5, R-16): a restricted reader's library list pays one exclusion per
 * request, never one owner call per asset.
 *
 * The fixture, in the library's root folder:
 * - **50 visible files**, each used three times by records of different kinds
 *   — a product's gallery (unrestricted), an open Task and an Opportunity the
 *   reader reaches (both restricted, both visible);
 * - **2 000 hidden files**, each attached to one of 200 private Tasks of
 *   another administrator, all **newer** than the visible ones, so the reader's
 *   first page is reached only by excluding every one of them.
 *
 * Reader **B** holds `tasks:read`, `crm:read` and the library's codes, without
 * `tasks:see_private`; the control **W** is the Platform administrator, whose
 * list runs today's query (its first page is 50 hidden files). B's and W's
 * reads are interleaved, so the load of a shared machine falls on both alike.
 *
 * Gated: `GET /assets?limit=50` p95 for B under the budget. Its ratio to W's
 * is recorded, not gated: the owner dropped SC-004's 1.2× clause on 2026-10-30
 * (W's page is 280–500 ms, so 20% left a 60–100 ms margin). Also recorded, not gated:
 * - the by-id answer for a hidden id against a random uuid (FR-012's timing);
 * - `GET /tasks/:id/attachments` for the open Task (50 files): since US3 each
 *   attachment's URL is built from an asset detail, which asks each present
 *   restricted owner `visibleEntityIds` once;
 * - `GET /assets/folders/:id/permalink-count` over a folder of 1 000 hidden and
 *   50 visible permalinked files (one `exclusionFor`);
 * - one `DELETE /assets/folders/:id` (`cancel`) of a folder holding 500 hidden
 *   files only, which re-homes them (one `hiddenAmong`).
 *
 * Tuning knobs (env):
 *   PERF_RUN                 — set to 'true' to run; otherwise skipped.
 *   PERF_ITERATIONS          — reads measured per reader and figure (default 30)
 *   PERF_ASSETS_LIST_P95_MS  — B's list p95 budget (default 1 000)
 *
 * The figures measured when this landed are under T049 in
 * `specs/166-asset-reference-visibility/tasks.md`.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '30');
const listBudget = Number(process.env['PERF_ASSETS_LIST_P95_MS'] ?? '1000');

const VISIBLE = 50;
const PRIVATE_TASKS = 200;
const PER_PRIVATE_TASK = 10;
const COUNT_HIDDEN = 1000;
const DELETE_HIDDEN = 500;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

type Check = (status: number, body: unknown) => void;
type Pair = { restricted: number; wildcard: number; medians: { restricted: number; wildcard: number } };

describe.skipIf(!shouldRun)('assets library — reference visibility at scale (166 T049, SC-004)', () => {
  let h: BackendServerHandle;
  let B: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const W = { b2b_session: 'stub-admin-session' };
  const run = randomUUID().slice(0, 8);
  const prefix = `rvp-${run}-`;
  const openTask = randomUUID();
  let productId: string;
  let opportunityId: string;
  let countFolder: string;
  let deleteFolder: string;
  let visibleIds: Set<string>;
  let hiddenId: string;

  const conn = () => h.em().getConnection();

  /** `count` assets named `<prefix><label>-<n>`, created `offsetMs` + n milliseconds from now, in `folderId`. */
  async function insertAssets(
    label: string,
    count: number,
    offsetMs: number,
    folderId: string | null,
    permalinked = false,
  ): Promise<string[]> {
    const rows = (await conn().execute(
      `insert into "assets"
         ("id", "kind", "filename", "mime_type", "size_bytes", "storage_url", "visibility",
          "storage_backend", "storage_locator", "folder_id", "permalink", "created_at", "updated_at")
       select s.id, 'pdf', ?::text || s.g || '.pdf', 'application/pdf', 2048, 'rv/' || s.id || '.pdf', 'private',
              'local', 'rv/' || s.id || '.pdf', ?::uuid,
              case when ?::boolean then ?::text || s.g || '.pdf' else null end,
              now() + (?::int + s.g) * interval '1 millisecond', now()
         from (select gen_random_uuid() as id, g from generate_series(1, ?::int) g) s
       returning "id"`,
      [`${prefix}${label}-`, folderId, permalinked, `${prefix}${label}/`, offsetMs, count],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** Attach `assetIds` to private Tasks of the harness administrator, `perTask` each, numbered `T-RVP-<run>-<label>-n`. */
  async function hideBehindPrivateTasks(label: string, assetIds: readonly string[], perTask: number): Promise<void> {
    const number = `T-RVP-${run}-${label}-`;
    await conn().execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_private")
       select gen_random_uuid(), ?::text || g, 'RVP private ' || g, ?, true
         from generate_series(0, ?::int - 1) g`,
      [number, TEST_ADMIN_ID, Math.ceil(assetIds.length / perTask)],
    );
    await conn().execute(
      `insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id")
       select t."id", a.id, ?
         from unnest(?::uuid[]) with ordinality as a(id, n)
         join "tasks" t on t."number" = ?::text || ((a.n - 1) / ?::int)`,
      [TEST_ADMIN_ID, `{${assetIds.join(',')}}`, number, perTask],
    );
  }

  async function createFolder(parentId: string | null, name: string): Promise<string> {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      cookies: W,
      payload: { parentId, name: `${prefix}${name}` },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    B = await seedCrmAdmin(h.em(), 'rvp-b', ['tasks:read', 'crm:read', 'assets.read', 'assets.write']);

    const product = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: W,
      payload: {
        sku: `RVP-${run}`,
        type: 'simple',
        name: `RVP ${run}`,
        description: 'desc',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(product.statusCode, product.body).toBe(201);
    productId = (product.json() as { data: { id: string } }).data.id;
    opportunityId = (await createCrmOpportunity(h)).id;
    await conn().execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_private", "is_draft")
       values (?, ?, 'RVP open', ?, false, false)`,
      [openTask, `T-RVP-${run}-open`, TEST_ADMIN_ID],
    );

    // Visible: older than every hidden file, three references each.
    const visible = await insertAssets('visible', VISIBLE, -600_000, null);
    visibleIds = new Set(visible);
    const list = `{${visible.join(',')}}`;
    await conn().execute(
      `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at)
       select gen_random_uuid(), ?, a.id, a.n, now(), now() from unnest(?::uuid[]) with ordinality as a(id, n)`,
      [productId, list],
    );
    await conn().execute(
      `insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id")
       select ?, id, ? from unnest(?::uuid[]) as id`,
      [openTask, TEST_ADMIN_ID, list],
    );
    await conn().execute(
      `insert into "crm_opportunity_attachments" ("id", "opportunity_id", "asset_id", "file_name", "uploaded_by_admin_user_id", "created_at")
       select gen_random_uuid(), ?, id, 'rvp.pdf', ?, now() from unnest(?::uuid[]) as id`,
      [opportunityId, TEST_ADMIN_ID, list],
    );

    // Hidden: 2 000 root files on 200 private Tasks, newer than the visible ones.
    const hidden = await insertAssets('hidden', PRIVATE_TASKS * PER_PRIVATE_TASK, 0, null);
    await hideBehindPrivateTasks('hidden', hidden, PER_PRIVATE_TASK);
    hiddenId = hidden[0]!;

    // The permalink count's folder: 1 000 hidden and 50 visible (unused) permalinked files.
    countFolder = await createFolder(null, 'count');
    await hideBehindPrivateTasks('count', await insertAssets('count-hidden', COUNT_HIDDEN, 0, countFolder, true), 100);
    await insertAssets('count-visible', VISIBLE, 0, countFolder, true);

    // The folder delete's folder: 500 hidden files only, under the count folder.
    deleteFolder = await createFolder(countFolder, 'delete');
    await hideBehindPrivateTasks('delete', await insertAssets('delete-hidden', DELETE_HIDDEN, 0, deleteFolder), 100);
    await conn().execute('analyze "assets"');
    await conn().execute('analyze "task_attachments"');
  }, 600_000);

  afterAll(async () => {
    await conn().execute(`delete from "tasks" where "number" like ?`, [`T-RVP-${run}-%`]);
    await conn().execute(`delete from "crm_opportunity_attachments" where "opportunity_id" = ?`, [opportunityId]);
    await conn().execute(`delete from "gallery_items" where "product_id" = ?`, [productId]);
    await conn().execute(`delete from "assets" where "filename" like ?`, [`${prefix}%`]);
    await conn().execute(`delete from "asset_folders" where "name" like ?`, [`${prefix}%`]);
    B.undo();
    await teardownBackendServer(h);
  }, 600_000);

  /** One reader's reads of `url`; the first warms the process and is not counted. */
  async function measure(url: string, cookies: Record<string, string>, check: Check): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i <= iterations; i += 1) {
      const started = performance.now();
      const response = await h.app.inject({ method: 'GET', url, cookies });
      const elapsed = performance.now() - started;
      check(response.statusCode, response.json());
      if (i > 0) samples.push(elapsed);
    }
    return p95(samples);
  }

  /**
   * B's and W's reads of one URL, **interleaved** — B, W, B, W … — so the load
   * of a shared machine falls on both alike and their ratio means something.
   */
  async function measurePair(
    url: string,
    checkB: Check,
    checkW: Check,
  ): Promise<Pair> {
    const samples = { restricted: [] as number[], wildcard: [] as number[] };
    const readers = [
      ['restricted', B.cookies, checkB],
      ['wildcard', W, checkW],
    ] as const;
    for (let i = 0; i <= iterations; i += 1) {
      for (const [who, cookies, check] of readers) {
        const started = performance.now();
        const response = await h.app.inject({ method: 'GET', url, cookies });
        const elapsed = performance.now() - started;
        check(response.statusCode, response.json());
        // The first round warms the process and is not counted.
        if (i > 0) samples[who].push(elapsed);
      }
    }
    return {
      restricted: p95(samples.restricted),
      wildcard: p95(samples.wildcard),
      medians: { restricted: median(samples.restricted), wildcard: median(samples.wildcard) },
    };
  }

  const page = (body: unknown) => (body as { data: Array<{ id: string }> }).data.map((row) => row.id);

  it(`GET /assets?limit=50 for a restricted reader: p95 < ${listBudget} ms`, async () => {
    const { restricted, wildcard, medians } = await measurePair(
      '/api/v1/admin/assets?limit=50',
      (status, body) => {
        expect(status).toBe(200);
        // Every hidden file is newer: B's first page is the 50 visible ones.
        expect(page(body).filter((id) => visibleIds.has(id))).toHaveLength(VISIBLE);
      },
      (status, body) => {
        expect(status).toBe(200);
        expect(page(body)).toHaveLength(50);
        expect(page(body).some((id) => visibleIds.has(id))).toBe(false);
      },
    );
    // eslint-disable-next-line no-console -- the measurement is the output (T049).
    console.log(
      `[perf] assets list, ${VISIBLE} visible × 3 references beside ${PRIVATE_TASKS * PER_PRIVATE_TASK} hidden: ` +
        `B p95 ${restricted.toFixed(1)} ms; W p95 ${wildcard.toFixed(1)} ms; ratio ${(restricted / wildcard).toFixed(2)} ` +
        `(medians B ${medians.restricted.toFixed(1)} ms, W ${medians.wildcard.toFixed(1)} ms)`,
    );
    expect(restricted).toBeLessThan(listBudget);
  }, 600_000);

  it('records the by-id answer for a hidden id against a random uuid, the attachment list, the permalink count and the folder delete', async () => {
    const missing = await measure(`/api/v1/admin/assets/${randomUUID()}`, B.cookies, (status) => {
      expect(status).toBe(404);
    });
    const hiddenById = await measure(`/api/v1/admin/assets/${hiddenId}`, B.cookies, (status) => {
      expect(status).toBe(404);
    });
    const listsFifty: Check = (status, body) => {
      expect(status).toBe(200);
      expect((body as { data: unknown[] }).data).toHaveLength(VISIBLE);
    };
    const attachments = await measurePair(`/api/v1/admin/tasks/${openTask}/attachments`, listsFifty, listsFifty);
    const countOf = (body: unknown) => (body as { data: { permalinkedAssets: number } }).data.permalinkedAssets;
    const count = await measurePair(
      `/api/v1/admin/assets/folders/${countFolder}/permalink-count`,
      (status, body) => {
        expect(status).toBe(200);
        expect(countOf(body)).toBe(VISIBLE);
      },
      (status, body) => {
        expect(status).toBe(200);
        expect(countOf(body)).toBe(VISIBLE + COUNT_HIDDEN);
      },
    );

    const deleteStarted = performance.now();
    const deleted = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/folders/${deleteFolder}`,
      cookies: B.cookies,
      payload: { ifNonEmpty: 'cancel' },
    });
    const deleteMs = performance.now() - deleteStarted;
    expect(deleted.statusCode, deleted.body).toBe(200);
    const rehomed = (await conn().execute(
      `select count(*)::int as n from "assets" where "folder_id" = ? and "filename" like ?`,
      [countFolder, `${prefix}delete-hidden-%`],
    )) as Array<{ n: number }>;
    expect(rehomed[0]!.n).toBe(DELETE_HIDDEN);

    // eslint-disable-next-line no-console -- the measurement is the output (T049).
    console.log(
      `[perf] assets by id as B: missing p95 ${missing.toFixed(1)} ms, hidden p95 ${hiddenById.toFixed(1)} ms; ` +
        `GET /tasks/:id/attachments (${VISIBLE} files): B p95 ${attachments.restricted.toFixed(1)} ms, ` +
        `W p95 ${attachments.wildcard.toFixed(1)} ms; ` +
        `permalink count (${COUNT_HIDDEN} hidden + ${VISIBLE}): B p95 ${count.restricted.toFixed(1)} ms, ` +
        `W p95 ${count.wildcard.toFixed(1)} ms; ` +
        `folder delete (cancel, ${DELETE_HIDDEN} hidden re-homed) as B: ${deleteMs.toFixed(1)} ms`,
    );
  }, 600_000);
});
