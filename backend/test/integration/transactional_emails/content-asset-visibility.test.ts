import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { removeCrmAssets, seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * Asset ids stored in e-mail bodies and the e-mail logo setting (issue #1354,
 * the `transactional_emails` half of #544; owner ruling 2026-10-30, option a).
 *
 * An e-mail block, template or e-mail body and `transactional_emails.logo_asset_id`
 * are rendered into every message sent, and used to store an asset id without
 * asking whether it exists. A file the library hides from the caller is now
 * refused exactly as a missing one — and a missing one, which used to be
 * accepted, is refused too. An id the record already stores is accepted.
 *
 * **R** may edit e-mails and settings and read the library, and may not read
 * Tasks: a file attached to a Task is hidden from R.
 */
describe('transactional emails — asset ids a body or logo write newly adds (issue #1354)', () => {
  let h: BackendServerHandle;
  let R: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const W = { b2b_session: 'stub-admin-session' };
  const BASE = '/api/v1/admin/transactional-emails';
  const LANGUAGE = 'zz-ZZ';
  const LOGO = 'transactional_emails.logo_asset_id';

  const run = randomUUID().slice(0, 8);
  const taskId = randomUUID();
  const assetIds: string[] = [];
  let hidden: string;
  let blockId: string;
  let templateId: string;
  let emailCode: string;
  let emailId: string;
  let logoBefore: unknown;

  const inject = (
    method: 'POST' | 'PUT' | 'GET' | 'DELETE',
    url: string,
    cookies: Record<string, string>,
    payload?: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    h.app.inject({ method, url, cookies, ...(payload === undefined ? {} : { payload }) });

  async function seedAsset(): Promise<string> {
    const id = randomUUID();
    await h.em().getConnection().execute(
      `insert into "assets"
         ("id", "kind", "filename", "mime_type", "size_bytes", "storage_url", "visibility",
          "storage_backend", "storage_locator", "created_at", "updated_at")
       values (?, 'image', ?, 'image/png', 2048, ?, 'public', 'local', ?, now(), now())`,
      [id, `teav-${run}-${id.slice(0, 8)}.png`, `teav/${id}`, `teav/${id}`],
    );
    assetIds.push(id);
    return id;
  }

  const tree = (assetId: string) => ({
    root: { props: {} },
    content: [
      {
        type: 'transactional_emails.EmailImage',
        props: { id: `img-${assetId.slice(0, 8)}`, imageSource: 'library', src: '', assetId, alt: '' },
      },
    ],
    zones: {},
  });

  const versionOf = async (url: string): Promise<number> =>
    ((await inject('GET', url, W)).json() as { data: { version: number } }).data.version;

  beforeAll(async () => {
    h = await setupBackendServer();
    R = await seedCrmAdmin(h.em(), 'teav-r', [
      'transactional_emails:read',
      'transactional_emails:write',
      'settings:read',
      'settings:write',
      'assets.read',
      'assets.write',
    ]);
    const [logo] = await h.em().getConnection().execute<Array<{ global_value: unknown }>>(
      `select global_value from settings where code = ?`,
      [LOGO],
    );
    logoBefore = logo?.global_value ?? null;

    hidden = await seedAsset();
    const conn = h.em().getConnection();
    await conn.execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_draft", "is_private")
       values (?, ?, ?, ?, false, false)`,
      [taskId, `T-TEAV-${run}`, `TEAV ${run}`, TEST_ADMIN_ID],
    );
    await conn.execute(
      `insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
      [taskId, hidden, TEST_ADMIN_ID],
    );

    const block = await inject('POST', `${BASE}/blocks`, W, {
      code: `teav_block_${run}`,
      name: `TEAV ${run}`,
      languages: ['en-US'],
    });
    expect(block.statusCode, block.body).toBe(200);
    blockId = (block.json() as { data: { id: string } }).data.id;

    const template = await inject('POST', `${BASE}/templates`, W, {
      code: `teav_template_${run}`,
      name: `TEAV ${run}`,
      languages: ['en-US'],
    });
    expect(template.statusCode, template.body).toBe(200);
    templateId = (template.json() as { data: { id: string } }).data.id;

    const [email] = await conn.execute<Array<{ id: string; code: string }>>(
      `select id, code from transactional_emails order by code limit 1`,
    );
    emailId = email!.id;
    emailCode = email!.code;
  });

  afterAll(async () => {
    const conn = h.orm.em.getConnection();
    if (blockId) await conn.execute(`delete from email_blocks where id = ?`, [blockId]);
    if (templateId) await conn.execute(`delete from email_templates where id = ?`, [templateId]);
    if (emailId) {
      await conn.execute(`delete from transactional_email_contents where email_id = ? and language = ?`, [
        emailId,
        LANGUAGE,
      ]);
    }
    await conn.execute(`update settings set global_value = ?::jsonb where code = ?`, [
      logoBefore === null ? null : JSON.stringify(logoBefore),
      LOGO,
    ]);
    await conn.execute(`delete from task_attachments where task_id = ?`, [taskId]);
    await conn.execute(`delete from tasks where id = ?`, [taskId]);
    await removeCrmAssets(h.orm.em, assetIds);
    R?.undo();
    await teardownBackendServer(h);
  });

  /** The answer with the asked id and the request id taken out: what must be equal byte for byte. */
  function normalised(response: LightMyRequestResponse, id: string): unknown {
    const body = JSON.parse(response.body.split(id).join('<id>')) as { error?: Record<string, unknown> };
    if (body.error) delete body.error.requestId;
    return { status: response.statusCode, body };
  }

  /** Each write that stores an asset id it was sent, as R. */
  const PATHS: ReadonlyArray<{ name: string; send: (assetId: string) => Promise<LightMyRequestResponse> }> = [
    {
      name: 'PUT /transactional-emails/blocks/:id/content/:language',
      send: async (assetId) =>
        inject('PUT', `${BASE}/blocks/${blockId}/content/en-US`, R.cookies, {
          content: tree(assetId),
          expectedVersion: await versionOf(`${BASE}/blocks/${blockId}`),
        }),
    },
    {
      name: 'PUT /transactional-emails/templates/:id/content/:language',
      send: async (assetId) =>
        inject('PUT', `${BASE}/templates/${templateId}/content/en-US`, R.cookies, {
          content: tree(assetId),
          expectedVersion: await versionOf(`${BASE}/templates/${templateId}`),
        }),
    },
    {
      name: 'PUT /transactional-emails/:code/content',
      send: (assetId) =>
        inject('PUT', `${BASE}/${emailCode}/content?language=${LANGUAGE}`, R.cookies, {
          subject: `TEAV ${run}`,
          content: tree(assetId),
        }),
    },
    {
      name: 'PUT /transactional-emails/branding (logoAssetId)',
      send: (assetId) => inject('PUT', `${BASE}/branding`, R.cookies, { logoAssetId: assetId }),
    },
    {
      name: `PUT /settings/${LOGO}/value`,
      send: (assetId) => inject('PUT', `/api/v1/admin/settings/${LOGO}/value`, R.cookies, { scope: 'all', value: assetId }),
    },
  ];

  /** Whether any of the stores above holds the id. */
  async function stored(assetId: string): Promise<boolean> {
    const [row] = await h.em().getConnection().execute<Array<{ n: string }>>(
      `select (
         (select count(*) from email_blocks where id = ? and content::text like ?)
       + (select count(*) from email_templates where id = ? and content::text like ?)
       + (select count(*) from transactional_email_contents where email_id = ? and content::text like ?)
       + (select count(*) from settings where code = ? and global_value::text like ?)
       )::text as n`,
      [blockId, `%${assetId}%`, templateId, `%${assetId}%`, emailId, `%${assetId}%`, LOGO, `%${assetId}%`],
    );
    return Number(row!.n) > 0;
  }

  it('the premise: R may not see the file, W may', async () => {
    expect((await inject('GET', `/api/v1/admin/assets/${hidden}`, R.cookies)).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/admin/assets/${hidden}`, W)).statusCode).toBe(200);
  });

  it.each(PATHS)('$name refuses a hidden file exactly as a missing one, and stores neither', async (path) => {
    const missing = randomUUID();
    const forHidden = await path.send(hidden);
    const forMissing = await path.send(missing);
    expect(forMissing.statusCode, `random uuid: ${forMissing.body}`).toBe(404);
    expect((forMissing.json() as { error: { code: string } }).error.code).toBe('ASSET_NOT_FOUND');
    expect(normalised(forHidden, hidden)).toEqual(normalised(forMissing, missing));
    expect(await stored(hidden)).toBe(false);
    expect(await stored(missing)).toBe(false);
  });

  it.each(PATHS)('$name stores a file R may see, as before', async (path) => {
    const visible = await seedAsset();
    const response = await path.send(visible);
    expect(response.statusCode, response.body).toBeLessThan(300);
    expect(await stored(visible)).toBe(true);
  });

  it('accepts a body that keeps an image the record already stores, hidden or not', async () => {
    const first = await inject('PUT', `${BASE}/blocks/${blockId}/content/en-US`, W, {
      content: tree(hidden),
      expectedVersion: await versionOf(`${BASE}/blocks/${blockId}`),
    });
    expect(first.statusCode, first.body).toBe(200);
    const resave = await inject('PUT', `${BASE}/blocks/${blockId}/content/en-US`, R.cookies, {
      content: tree(hidden),
      expectedVersion: await versionOf(`${BASE}/blocks/${blockId}`),
    });
    expect(resave.statusCode, resave.body).toBe(200);
  });
});
