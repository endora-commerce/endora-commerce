import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_TOKENS, ERROR_CODES, type CmsBrandTokens } from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163 (T017) — brand tokens over HTTP
 * (`specs/163-page-builder-marketing-pages/contracts/storefront-and-admin-api.md` §1).
 *
 * The tokens are one `cms`-owned row per scope, written by the Command
 * `cms.brand_tokens.update` (research R-1, R-2). What this file holds that the
 * unit test cannot: the gates, the 409 and 400 on the wire, the channel read the
 * storefront gets (Principle XII — an override never leaks to another channel),
 * exactly one audit entry per write and none from `settings` (Principle XIII),
 * and a rolled-back write that leaves neither a row change nor an audit entry.
 *
 * The table is this file's alone, so its rows are taken aside in `beforeAll`
 * and put back in `afterAll` (standing rule 5).
 *
 * Every case starts from no global set and no set on this file's channels
 * (`beforeEach`), and writes the sets it reads itself: under a shuffled order
 * a case cannot lean on what an earlier one saved (issue #1118).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
/** `cms.read` and `cms.write`, no `cms.brand` (the `content_manager` seeded role). */
const CONTENT_MANAGER = { b2b_session: 'stub-content-manager-session' };
const ADMIN_URL = '/api/v1/admin/cms/brand-tokens';
const STOREFRONT_URL = '/api/v1/storefront/cms/brand-tokens';
const ACTION = 'cms.brand_tokens.update';
const OBJECT_TYPE = 'cms_brand_tokens';

const RUN = `pb163_${randomUUID().slice(0, 8)}`;

function tokensWith(primary: string): CmsBrandTokens {
  return { ...DEFAULT_BRAND_TOKENS, colors: { ...DEFAULT_BRAND_TOKENS.colors, primary } };
}

const GLOBAL_TOKENS = tokensWith('#1d4ed8');
const OVERRIDE_TOKENS = tokensWith('#0f766e');
const DEFAULT_CHANNEL_TOKENS = tokensWith('#7c3aed');

/** The dark scheme's text at ≈ 2.8:1 on black — below the 4.5:1 body floor. */
const LOW_CONTRAST_TOKENS: CmsBrandTokens = {
  ...GLOBAL_TOKENS,
  schemes: {
    ...GLOBAL_TOKENS.schemes,
    dark: { ...GLOBAL_TOKENS.schemes.dark, background: '#000000', text: '#555555' },
  },
};

interface StoredRow {
  id: string;
  sales_channel_id: string | null;
  tokens: unknown;
  version: number;
  updated_at: Date;
}

interface AdminRead {
  global: { tokens: CmsBrandTokens | null; version: number };
  channel?: { salesChannelId: string; tokens: CmsBrandTokens | null; version: number };
  effective: CmsBrandTokens;
  warnings: Array<{ pair: string; ratio: number; required: number }>;
}

describe('brand tokens (feature 163, contract §1)', () => {
  let h: BackendServerHandle;
  let defaultChannel: { id: string; code: string };
  let overrideChannel: { id: string; code: string };
  let otherChannel: { id: string; code: string };
  let saved: StoredRow[] = [];
  const createdChannelIds: string[] = [];

  /** The channels whose sets the cases write, so the ones `beforeEach` clears. */
  const resetChannelIds = (): string[] => [defaultChannel.id, overrideChannel.id, otherChannel.id];

  async function rows(): Promise<StoredRow[]> {
    return (await h.em().execute(
      // The global row only. The channel rows this file writes sit on channels it creates, plus
      // the default channel's, which `beforeAll` takes aside beside the global one.
      'select id, sales_channel_id::text as sales_channel_id, tokens, version, updated_at from cms_brand_tokens where sales_channel_id is null',
    )) as StoredRow[];
  }

  async function createChannel(suffix: string): Promise<{ id: string; code: string }> {
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: `${RUN}-${suffix}`,
      name: { 'en-US': `Brand ${suffix}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['USD'],
      defaultCurrency: 'USD',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    createdChannelIds.push(channel.id);
    return { id: channel.id, code: channel.code };
  }

  function getAdmin(salesChannelId?: string, cookies = ADMIN) {
    return h.app.inject({
      method: 'GET',
      url: salesChannelId ? `${ADMIN_URL}?salesChannelId=${salesChannelId}` : ADMIN_URL,
      cookies,
    });
  }

  function put(payload: unknown, cookies = ADMIN) {
    return h.app.inject({ method: 'PUT', url: ADMIN_URL, cookies, payload: payload as object });
  }

  function getStorefront(channelCode?: string) {
    return h.app.inject({
      method: 'GET',
      url: STOREFRONT_URL,
      ...(channelCode ? { headers: { 'x-sales-channel': channelCode } } : {}),
    });
  }

  async function auditCount(objectId: string): Promise<number> {
    return h.em().count(AuditLogEntry, { action: ACTION, objectType: OBJECT_TYPE, objectId });
  }

  async function versionOf(salesChannelId?: string): Promise<number> {
    const read = (await getAdmin(salesChannelId)).json() as { data: AdminRead };
    return salesChannelId ? read.data.channel!.version : read.data.global.version;
  }

  /** Arrange: save `tokens` for the global scope, or for one channel, at its current version. */
  async function save(tokens: CmsBrandTokens, salesChannelId?: string): Promise<void> {
    const res = await put({
      scope: salesChannelId ? { kind: 'channel', salesChannelId } : { kind: 'all' },
      tokens,
      expectedVersion: await versionOf(salesChannelId),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const found = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannel = { id: found.id, code: found.code };
    // The global row and the default channel's: the cases write both.
    saved = (await h.em().execute(
      'select id, sales_channel_id::text as sales_channel_id, tokens, version, updated_at from cms_brand_tokens where sales_channel_id is null or sales_channel_id = ?',
      [defaultChannel.id],
    )) as StoredRow[];
    overrideChannel = await createChannel('override');
    otherChannel = await createChannel('other');
  }, 60_000);

  beforeEach(async () => {
    await h.em().execute(
      'delete from cms_brand_tokens where sales_channel_id is null or sales_channel_id = any(?::uuid[])',
      [`{${resetChannelIds().join(',')}}`],
    );
  });

  afterAll(async () => {
    const em = h.em();
    await em.execute(
      'delete from cms_brand_tokens where sales_channel_id is null or sales_channel_id = any(?::uuid[])',
      [`{${[defaultChannel.id, ...createdChannelIds].join(',')}}`],
    );
    for (const row of saved) {
      await em.execute(
        'insert into cms_brand_tokens (id, sales_channel_id, tokens, version, updated_at) values (?, ?, ?::jsonb, ?, ?)',
        [row.id, row.sales_channel_id, JSON.stringify(row.tokens), row.version, row.updated_at],
      );
    }
    if (createdChannelIds.length > 0) {
      await em.nativeDelete(SalesChannel, { id: { $in: createdChannelIds } });
    }
    await teardownBackendServer(h);
  });

  it('answers the built-in defaults when nothing is set', async () => {
    const res = await getAdmin();
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: AdminRead };
    expect(data.effective).toEqual(DEFAULT_BRAND_TOKENS);
    expect(data.global).toEqual({ tokens: null, version: 0 });
    expect(data.channel).toBeUndefined();
    expect(data.warnings).toEqual([]);
  });

  it('refuses the write to an admin without `cms.brand`, and lets them read', async () => {
    expect((await getAdmin(undefined, CONTENT_MANAGER)).statusCode).toBe(200);
    const res = await put(
      { scope: { kind: 'all' }, tokens: GLOBAL_TOKENS, expectedVersion: 0 },
      CONTENT_MANAGER,
    );
    expect(res.statusCode).toBe(403);
    expect(await rows()).toEqual([]);
  });

  it('refuses a malformed body with 400 and writes nothing', async () => {
    const res = await put({ scope: { kind: 'all' }, tokens: { version: 2 }, expectedVersion: 0 });
    expect(res.statusCode).toBe(400);
    const badHex = await put({
      scope: { kind: 'all' },
      tokens: tokensWith('#abc'),
      expectedVersion: 0,
    });
    expect(badHex.statusCode).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it('saves the global set with one audit entry, and returns its contrast warnings', async () => {
    const before = await auditCount('global');
    const startedAt = new Date();

    const res = await put({ scope: { kind: 'all' }, tokens: LOW_CONTRAST_TOKENS, expectedVersion: 0 });
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { version: number; warnings: AdminRead['warnings'] } };
    expect(data.version).toBe(1);
    expect(data.warnings.map((w) => w.pair)).toContain('schemes.dark.text/background');

    const read = (await getAdmin()).json() as { data: AdminRead };
    expect(read.data.global).toEqual({ tokens: LOW_CONTRAST_TOKENS, version: 1 });
    expect(read.data.effective).toEqual(LOW_CONTRAST_TOKENS);
    expect(read.data.warnings.map((w) => w.pair)).toContain('schemes.dark.text/background');

    expect(await auditCount('global')).toBe(before + 1);
    const [entry] = await h.em().find(
      AuditLogEntry,
      { action: ACTION, objectType: OBJECT_TYPE, objectId: 'global' },
      { orderBy: { actedAt: 'desc' }, limit: 1 },
    );
    expect(entry!.actorAdminUserId).toEqual(expect.any(String));
    expect(entry!.stateBefore ?? null).toBeNull();
    expect(entry!.stateAfter).toMatchObject({ version: 1, tokens: LOW_CONTRAST_TOKENS });

    // Principle XIII (analysis C2): the change is audited once, by the Command,
    // and never a second time by the settings write path.
    const settingsEntries = (await h.em().execute(
      `select count(*)::int as n from audit_log_entries where action like 'setting%' and acted_at >= ?`,
      [startedAt],
    )) as Array<{ n: number }>;
    expect(settingsEntries[0]!.n).toBe(0);

    // A second save records a second entry, with the state on both sides.
    const second = await put({ scope: { kind: 'all' }, tokens: GLOBAL_TOKENS, expectedVersion: 1 });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { version: number } }).data.version).toBe(2);
    expect(await auditCount('global')).toBe(before + 2);
    const [latest] = await h.em().find(
      AuditLogEntry,
      { action: ACTION, objectType: OBJECT_TYPE, objectId: 'global' },
      { orderBy: { actedAt: 'desc' }, limit: 1 },
    );
    expect(latest!.stateBefore).toMatchObject({ version: 1, tokens: LOW_CONTRAST_TOKENS });
    expect(latest!.stateAfter).toMatchObject({ version: 2, tokens: GLOBAL_TOKENS });
  });

  it('refuses a stale expectedVersion with 409 and records nothing', async () => {
    await save(GLOBAL_TOKENS);
    await save(GLOBAL_TOKENS);
    const current = await versionOf();
    const before = await auditCount('global');
    const res = await put({
      scope: { kind: 'all' },
      tokens: tokensWith('#b91c1c'),
      expectedVersion: current - 1,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.VERSION_CONFLICT } });
    expect(await versionOf()).toBe(current);
    expect(await auditCount('global')).toBe(before);
  });

  it('answers 404 for an unknown channel scope', async () => {
    const res = await put({
      scope: { kind: 'channel', salesChannelId: randomUUID() },
      tokens: OVERRIDE_TOKENS,
      expectedVersion: 0,
    });
    expect(res.statusCode).toBe(404);
  });

  it('serves each channel its own set on the storefront, and never another channel’s', async () => {
    await save(GLOBAL_TOKENS);
    const auditBefore = await auditCount(overrideChannel.id);
    const override = await put({
      scope: { kind: 'channel', salesChannelId: overrideChannel.id },
      tokens: OVERRIDE_TOKENS,
      expectedVersion: 0,
    });
    expect(override.statusCode).toBe(200);
    expect(await auditCount(overrideChannel.id)).toBe(auditBefore + 1);
    const onDefault = await put({
      scope: { kind: 'channel', salesChannelId: defaultChannel.id },
      tokens: DEFAULT_CHANNEL_TOKENS,
      expectedVersion: 0,
    });
    expect(onDefault.statusCode).toBe(200);

    const admin = (await getAdmin(overrideChannel.id)).json() as { data: AdminRead };
    expect(admin.data.channel).toEqual({
      salesChannelId: overrideChannel.id,
      tokens: OVERRIDE_TOKENS,
      version: 1,
    });
    expect(admin.data.global.tokens).toEqual(GLOBAL_TOKENS);
    expect(admin.data.effective).toEqual(OVERRIDE_TOKENS);

    const overridden = await getStorefront(overrideChannel.code);
    expect(overridden.statusCode).toBe(200);
    expect(overridden.headers['cache-control']).toBe('public, max-age=60');
    expect((overridden.json() as { data: CmsBrandTokens }).data).toEqual(OVERRIDE_TOKENS);

    const other = await getStorefront(otherChannel.code);
    expect((other.json() as { data: CmsBrandTokens }).data).toEqual(GLOBAL_TOKENS);

    const noHeader = await getStorefront();
    expect(noHeader.statusCode).toBe(200);
    expect((noHeader.json() as { data: CmsBrandTokens }).data).toEqual(DEFAULT_CHANNEL_TOKENS);
  });

  // T154: the dark scheme's decorative backdrop as a URL — https: or site-relative only.
  it('stores a decorative backdrop URL and serves it on the storefront; refuses an http: one with 400', async () => {
    const channel = await createChannel('backdrop');
    const withBackdrop = (decorativeUrl: string): CmsBrandTokens => ({
      ...GLOBAL_TOKENS,
      schemes: { ...GLOBAL_TOKENS.schemes, dark: { ...GLOBAL_TOKENS.schemes.dark, decorativeUrl } },
    });
    const refused = await put({
      scope: { kind: 'channel', salesChannelId: channel.id },
      tokens: withBackdrop('http://cdn.example.com/backdrop.svg'),
      expectedVersion: 0,
    });
    expect(refused.statusCode).toBe(400);
    expect(await auditCount(channel.id)).toBe(0);

    const tokens = withBackdrop('/media/backdrop.svg');
    const saved = await put({ scope: { kind: 'channel', salesChannelId: channel.id }, tokens, expectedVersion: 0 });
    expect(saved.statusCode).toBe(200);
    const served = (await getStorefront(channel.code)).json() as { data: CmsBrandTokens };
    expect(served.data.schemes.dark.decorativeUrl).toBe('/media/backdrop.svg');
    expect(served.data).toEqual(tokens);
  });

  it('removes a channel override with `tokens: null`, so the channel inherits the global set', async () => {
    await save(GLOBAL_TOKENS);
    const auditBefore = await auditCount(overrideChannel.id);
    await save(OVERRIDE_TOKENS, overrideChannel.id);
    const version = await versionOf(overrideChannel.id);
    const res = await put({
      scope: { kind: 'channel', salesChannelId: overrideChannel.id },
      tokens: null,
      expectedVersion: version,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { version: number } }).data.version).toBe(0);
    expect(await auditCount(overrideChannel.id)).toBe(auditBefore + 2);
    const [entry] = await h.em().find(
      AuditLogEntry,
      { action: ACTION, objectType: OBJECT_TYPE, objectId: overrideChannel.id },
      { orderBy: { actedAt: 'desc' }, limit: 1 },
    );
    expect(entry!.stateBefore).toMatchObject({ tokens: OVERRIDE_TOKENS });
    expect(entry!.stateAfter ?? null).toBeNull();

    const storefront = await getStorefront(overrideChannel.code);
    expect((storefront.json() as { data: CmsBrandTokens }).data).toEqual(GLOBAL_TOKENS);
    const stored = (await h.em().execute('select id from cms_brand_tokens where sales_channel_id = ?', [
      overrideChannel.id,
    ])) as Array<{ id: string }>;
    expect(stored).toEqual([]);
  });

  it('serves the effective set in the page-builder descriptor, per channel (T021)', async () => {
    await save(GLOBAL_TOKENS);
    await save(DEFAULT_CHANNEL_TOKENS, defaultChannel.id);
    const global = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/page-builder/config',
      cookies: ADMIN,
    });
    expect(global.statusCode).toBe(200);
    expect((global.json() as { data: { brandTokens: CmsBrandTokens } }).data.brandTokens).toEqual(
      GLOBAL_TOKENS,
    );
    const channel = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/page-builder/config?salesChannelId=${defaultChannel.id}`,
      cookies: ADMIN,
    });
    expect((channel.json() as { data: { brandTokens: CmsBrandTokens } }).data.brandTokens).toEqual(
      DEFAULT_CHANNEL_TOKENS,
    );
  });

  it('leaves no row change and no audit entry when the write is rolled back', async () => {
    const before = await rows();
    const auditBefore = await auditCount('global');
    const trigger = `${RUN}_fail`;
    // A deferred constraint trigger fires at COMMIT — after the row write and
    // the audit entry are both in the transaction — so the rollback has to
    // take both with it.
    await h.em().execute(
      `create function ${trigger}() returns trigger language plpgsql as $$
       begin raise exception 'forced failure (${RUN})'; end $$`,
    );
    await h.em().execute(
      `create constraint trigger ${trigger} after insert or update or delete on cms_brand_tokens
       deferrable initially deferred for each row execute function ${trigger}()`,
    );
    try {
      const res = await put({
        scope: { kind: 'all' },
        tokens: tokensWith('#b91c1c'),
        expectedVersion: await versionOf(),
      });
      expect(res.statusCode).toBe(500);
    } finally {
      await h.em().execute(`drop trigger if exists ${trigger} on cms_brand_tokens`);
      await h.em().execute(`drop function if exists ${trigger}()`);
    }
    expect(await rows()).toEqual(before);
    expect(await auditCount('global')).toBe(auditBefore);
  });
});
