import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Feature 067 / T079 — feed template CRUD contract (FR-001, FR-002, FR-006,
 * FR-008–FR-010, FR-068, FR-074, FR-076, FR-082).
 *
 * The surface exists so a merchandiser can build a template in the admin
 * without touching markup, so the invariants worth pinning are the ones that
 * make that safe:
 *
 *  - the **field list is saved whole** — one request, one transaction, one
 *    audit entry — and `sortOrder` is normalised to `0..n-1` server-side, so
 *    the editor never manages gaps and the saved order is the file order;
 *  - every refusal in `contracts/admin-templates.md` §5 is a refusal, in plain
 *    terms, naming the field;
 *  - a system template is read-only, and duplicating one yields an ordinary,
 *    editable copy that keeps its `helpKey` glosses;
 *  - a stale `If-Match` loses to nobody: it is refused with the current
 *    version so the editor can offer "save as a new template" (FR-076);
 *  - removing a provider-required field is neither silently accepted nor
 *    hard-blocked — it needs an explicit acknowledgement (FR-074).
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const READER = { cookies: { b2b_session: 'stub-tpl-reader-session' } };
const READER_ID = '00000000-0000-4000-8000-0000000000e1';

const BASE = '/api/v1/admin/feed-templates';

interface TemplateBody {
  id: string;
  name: string;
  providerCode: string;
  outputFormat: string;
  itemGranularity: string;
  taxonomyProviderCode: string | null;
  isSystem: boolean;
  systemCode: string | null;
  usedByFeedCount: number;
  version: number;
  fields: Array<{
    id: string;
    outputName: string;
    sourceKind: string;
    sourceKey: string | null;
    constantValue: string | null;
    fallbackValue: string | null;
    providerRequired: boolean;
    sortOrder: number;
    helpKey: string | null;
    unbound: boolean;
  }>;
}

describe('feed templates — admin CRUD [contract]', () => {
  let h: BackendServerHandle;
  let googleTemplateId: string;
  let channelId: string;

  const etag = (t: { id: string; version: number }): Record<string, string> => ({
    'if-match': `W/"${t.id}:${t.version}"`,
  });

  async function get(id: string): Promise<TemplateBody> {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/${id}`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: TemplateBody }).data;
  }

  /** A fresh operator template with two ordinary fields. */
  async function createTemplate(over: Record<string, unknown> = {}): Promise<TemplateBody> {
    const res = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: `Editor template ${Math.random().toString(36).slice(2, 10)}`,
        providerCode: 'custom',
        outputFormat: 'csv',
        itemGranularity: 'product',
        fields: [
          { outputName: 'sku', sourceKind: 'sku', sortOrder: 0, providerRequired: true },
          { outputName: 'title', sourceKind: 'name', sortOrder: 1 },
        ],
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: TemplateBody }).data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    const role = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/product_feeds_template_reader',
      ...ADMIN,
      payload: {
        code: 'product_feeds_template_reader',
        name: 'Product feeds template reader',
        permissions: ['product_feeds:read'],
      },
    });
    expect(role.statusCode).toBe(200);
    const em = h.em();
    em.create(AdminUser, {
      id: READER_ID,
      email: 'template-reader@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Template',
      lastName: 'Reader',
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES['stub-tpl-reader-session'] = { adminUserId: READER_ID };

    const list = await h.app.inject({ method: 'GET', url: BASE, ...ADMIN });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ id: string; systemCode: string | null }> }).data;
    googleTemplateId = rows.find((t) => t.systemCode === 'google_merchant_v1')!.id;

    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-tpl-reader-session'];
    await teardownBackendServer(h);
  });

  // -------------------------------------------------------------------------
  // Access
  // -------------------------------------------------------------------------

  it('refuses an unauthenticated caller', async () => {
    const res = await h.app.inject({ method: 'GET', url: BASE });
    expect(res.statusCode).toBe(401);
  });

  it('lets a read-only administrator read but never write (US6 AS-7)', async () => {
    const readable = await h.app.inject({ method: 'GET', url: BASE, ...READER });
    expect(readable.statusCode).toBe(200);

    const write = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...READER,
      payload: { name: 'Not allowed', fields: [] },
    });
    expect(write.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Create / read / update — the field list is saved whole (FR-068)
  // -------------------------------------------------------------------------

  it('creates a template with its whole field list and normalises sortOrder', async () => {
    const created = await createTemplate({
      fields: [
        { outputName: 'sku', sourceKind: 'sku', sortOrder: 40 },
        { outputName: 'title', sourceKind: 'name', sortOrder: 7 },
        { outputName: 'link', sourceKind: 'link', sortOrder: 99 },
      ],
    });
    // Submitted order wins; the gaps the editor sent are gone.
    expect(created.fields.map((f) => f.outputName)).toEqual(['sku', 'title', 'link']);
    expect(created.fields.map((f) => f.sortOrder)).toEqual([0, 1, 2]);
    expect(created.version).toBe(1);
    expect(created.isSystem).toBe(false);
    expect(created.usedByFeedCount).toBe(0);
  });

  it('replaces the entire field list on save — add, rename, reorder and remove at once', async () => {
    const created = await createTemplate();
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${created.id}`,
      ...ADMIN,
      headers: etag(created),
      payload: {
        // `sku` survives — dropping it would be a provider-required removal,
        // which has its own confirmation path (FR-074, exercised below).
        fields: [
          { outputName: 'name', sourceKind: 'name', sortOrder: 0 },
          { outputName: 'sku', sourceKind: 'sku', providerRequired: true, sortOrder: 1 },
          { outputName: 'ean', sourceKind: 'constant', constantValue: '000', sortOrder: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const saved = (res.json() as { data: TemplateBody }).data;
    // Renamed (`title` → `name`), reordered, and one added, in one save.
    expect(saved.fields.map((f) => f.outputName)).toEqual(['name', 'sku', 'ean']);
    expect(saved.fields.map((f) => f.sortOrder)).toEqual([0, 1, 2]);
    expect(saved.version).toBe(created.version + 1);
  });

  it('leaves the field list alone when a save carries only the name', async () => {
    const created = await createTemplate();
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${created.id}`,
      ...ADMIN,
      headers: etag(created),
      payload: { name: `${created.name} renamed` },
    });
    expect(res.statusCode).toBe(200);
    const saved = (res.json() as { data: TemplateBody }).data;
    expect(saved.fields.map((f) => f.outputName)).toEqual(['sku', 'title']);
    // …and none of the defaulted keys silently rewrote the template's shape.
    expect(saved.outputFormat).toBe('csv');
    expect(saved.providerCode).toBe('custom');
  });

  // -------------------------------------------------------------------------
  // Optimistic concurrency (FR-076)
  // -------------------------------------------------------------------------

  it('refuses a stale If-Match with the current version', async () => {
    const created = await createTemplate();
    const first = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${created.id}`,
      ...ADMIN,
      headers: etag(created),
      payload: { name: `${created.name} v2` },
    });
    expect(first.statusCode).toBe(200);

    const stale = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${created.id}`,
      ...ADMIN,
      headers: etag(created),
      payload: { name: `${created.name} v3` },
    });
    expect(stale.statusCode).toBe(409);
    const body = stale.json() as { error: { details?: { currentVersion?: number } } };
    expect(body.error.details?.currentVersion).toBe(created.version + 1);
  });

  it('refuses a save with no If-Match at all', async () => {
    const created = await createTemplate();
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${created.id}`,
      ...ADMIN,
      payload: { name: 'No header' },
    });
    expect(res.statusCode).toBe(428);
  });

  // -------------------------------------------------------------------------
  // Validation refusals (admin-templates.md §5)
  // -------------------------------------------------------------------------

  it('refuses two fields sharing an output name (FR-009)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: `Duplicate names ${Math.random().toString(36).slice(2, 8)}`,
        fields: [
          { outputName: 'title', sourceKind: 'name', sortOrder: 0 },
          { outputName: 'title', sourceKind: 'sku', sortOrder: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { details?: { reason?: string; outputName?: string } } };
    expect(body.error.details?.reason).toBe('duplicate_output_name');
    expect(body.error.details?.outputName).toBe('title');
  });

  it('refuses an attribute binding whose key does not exist on this installation', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: `Unknown attribute ${Math.random().toString(36).slice(2, 8)}`,
        fields: [
          {
            outputName: 'gtin',
            sourceKind: 'attribute',
            sourceKey: 'definitely_not_a_definition',
            sortOrder: 0,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { details?: { sourceKey?: string } } };
    expect(body.error.details?.sourceKey).toBe('definitely_not_a_definition');
  });

  it('refuses a provider-required field with neither a source nor a fallback', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: `Required unbound ${Math.random().toString(36).slice(2, 8)}`,
        fields: [
          {
            outputName: 'gtin',
            sourceKind: 'attribute',
            sourceKey: '',
            providerRequired: true,
            sortOrder: 0,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a provider-category binding on a template declaring no taxonomy (FR-082)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: `No taxonomy ${Math.random().toString(36).slice(2, 8)}`,
        providerCode: 'custom',
        fields: [
          { outputName: 'sku', sourceKind: 'sku', sortOrder: 0 },
          { outputName: 'google_category', sourceKind: 'provider_category', sortOrder: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { details?: { reason?: string } } };
    expect(body.error.details?.reason).toBe('taxonomy_required_for_provider_category');
  });

  it('refuses variant granularity with no grouping field', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: `Variant no grouping ${Math.random().toString(36).slice(2, 8)}`,
        itemGranularity: 'variant',
        fields: [{ outputName: 'sku', sourceKind: 'sku', sortOrder: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { details?: { reason?: string } } };
    expect(body.error.details?.reason).toBe('grouping_field_required_for_variant_granularity');
  });

  it('refuses a duplicate template name', async () => {
    const created = await createTemplate();
    const res = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: { name: created.name, fields: [] },
    });
    expect(res.statusCode).toBe(409);
  });

  // -------------------------------------------------------------------------
  // System templates are read-only (FR-008), duplication is the way in (FR-006)
  // -------------------------------------------------------------------------

  it('refuses every mutation of a system template', async () => {
    const google = await get(googleTemplateId);
    expect(google.isSystem).toBe(true);

    const update = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${google.id}`,
      ...ADMIN,
      headers: etag(google),
      payload: { name: 'Rewritten by hand' },
    });
    expect(update.statusCode).toBe(409);
    expect(
      (update.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
    ).toBe('template_is_system');

    const remove = await h.app.inject({
      method: 'DELETE',
      url: `${BASE}/${google.id}`,
      ...ADMIN,
      headers: etag(google),
    });
    expect(remove.statusCode).toBe(409);
  });

  it('duplicates a system template into an independent, editable copy that keeps its glosses', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `${BASE}/${googleTemplateId}/duplicate`,
      ...ADMIN,
      payload: { name: `Google Merchant Center (copy ${Math.random().toString(36).slice(2, 8)})` },
    });
    expect(res.statusCode).toBe(201);
    const copy = (res.json() as { data: TemplateBody }).data;
    const source = await get(googleTemplateId);

    expect(copy.id).not.toBe(source.id);
    expect(copy.isSystem).toBe(false);
    expect(copy.systemCode).toBeNull();
    expect(copy.providerCode).toBe(source.providerCode);
    expect(copy.itemGranularity).toBe(source.itemGranularity);
    expect(copy.fields.map((f) => f.outputName)).toEqual(source.fields.map((f) => f.outputName));
    // The gloss layer is the reason a novice can read `g:availability` at all.
    expect(copy.fields[0]?.helpKey).toBe(source.fields[0]?.helpKey);
    expect(copy.fields[0]?.helpKey).not.toBeNull();

    // Editing the copy leaves the system template untouched.
    const edit = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${copy.id}`,
      ...ADMIN,
      headers: etag(copy),
      payload: { name: `${copy.name} edited` },
    });
    expect(edit.statusCode).toBe(200);
    expect((await get(googleTemplateId)).name).toBe(source.name);
  });

  // -------------------------------------------------------------------------
  // Removing a provider-required field: warn, then obey (FR-074)
  // -------------------------------------------------------------------------

  it('warns rather than silently accepting the removal of a provider-required field', async () => {
    const created = await createTemplate();
    const attempt = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${created.id}`,
      ...ADMIN,
      headers: etag(created),
      payload: { fields: [{ outputName: 'title', sourceKind: 'name', sortOrder: 0 }] },
    });
    expect(attempt.statusCode).toBe(409);
    const body = attempt.json() as {
      error: { details?: { warnings?: Array<{ code: string; outputName: string }> } };
    };
    expect(body.error.details?.warnings).toEqual([
      { code: 'provider_required_field_removed', outputName: 'sku' },
    ]);

    // Nothing was written while the operator had not confirmed.
    expect((await get(created.id)).fields.map((f) => f.outputName)).toEqual(['sku', 'title']);
  });

  it('obeys the same removal once the operator acknowledges it (never hard-blocked)', async () => {
    const created = await createTemplate();
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${created.id}?acknowledgeWarnings=true`,
      ...ADMIN,
      headers: etag(created),
      payload: { fields: [{ outputName: 'title', sourceKind: 'name', sortOrder: 0 }] },
    });
    expect(res.statusCode).toBe(200);
    const saved = res.json() as {
      data: TemplateBody;
      warnings: Array<{ code: string; outputName: string }>;
    };
    expect(saved.data.fields.map((f) => f.outputName)).toEqual(['title']);
    expect(saved.warnings).toEqual([
      { code: 'provider_required_field_removed', outputName: 'sku' },
    ]);
  });

  // -------------------------------------------------------------------------
  // Delete (FR-010)
  // -------------------------------------------------------------------------

  it('deletes an unused template', async () => {
    const created = await createTemplate();
    const res = await h.app.inject({
      method: 'DELETE',
      url: `${BASE}/${created.id}`,
      ...ADMIN,
      headers: etag(created),
    });
    expect(res.statusCode).toBe(204);
    const after = await h.app.inject({ method: 'GET', url: `${BASE}/${created.id}`, ...ADMIN });
    expect(after.statusCode).toBe(404);
  });

  it('refuses to delete a template a feed still uses, naming the feeds', async () => {
    const created = await createTemplate();
    const feed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: 'Feed on a doomed template',
        slug: `doomed-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: created.id,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(feed.statusCode).toBe(201);

    const reread = await get(created.id);
    expect(reread.usedByFeedCount).toBe(1);

    const res = await h.app.inject({
      method: 'DELETE',
      url: `${BASE}/${created.id}`,
      ...ADMIN,
      headers: etag(reread),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as {
      error: { details?: { reason?: string; feeds?: Array<{ id: string; name: string }> } };
    };
    expect(body.error.details?.reason).toBe('template_in_use');
    expect(body.error.details?.feeds?.map((f) => f.name)).toContain('Feed on a doomed template');
  });

  // -------------------------------------------------------------------------
  // The guided binding catalogue (FR-070)
  // -------------------------------------------------------------------------

  it('lists only sources that exist on this installation', async () => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/field-sources`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    const { groups } = (
      res.json() as {
        data: {
          groups: Array<{
            kind: string;
            sources: Array<{ sourceKind: string; sourceKey: string | null; requiresTaxonomy: boolean }>;
          }>;
        };
      }
    ).data;

    const kinds = groups.map((g) => g.kind);
    expect(kinds).toContain('product_property');
    expect(kinds).toContain('constant');

    const all = groups.flatMap((g) => g.sources);
    expect(all.some((s) => s.sourceKind === 'sku')).toBe(true);
    expect(all.some((s) => s.sourceKind === 'provider_category' && s.requiresTaxonomy)).toBe(true);

    // The operator-defined half is built from this installation's own product
    // definitions — `color` is seeded, `energy_class` is not.
    const keyed = all.filter(
      (s) => s.sourceKind === 'attribute' || s.sourceKind === 'custom_field',
    );
    expect(keyed.map((s) => s.sourceKey)).toContain('color');
    expect(keyed.map((s) => s.sourceKey)).not.toContain('energy_class');
    for (const source of keyed) expect(source.sourceKey).toBeTruthy();
  });
});
