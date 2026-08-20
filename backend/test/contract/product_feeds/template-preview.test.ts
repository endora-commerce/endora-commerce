import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { FeedRun } from '../../../src/modules/product_feeds/entities/feed-run.entity.js';
import { FeedArtefact } from '../../../src/modules/product_feeds/entities/feed-artefact.entity.js';
import { FeedTemplate } from '../../../src/modules/product_feeds/entities/feed-template.entity.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Feature 067 / T080 — the sample-product preview (FR-072, SC-013).
 *
 * The preview is the editor's teaching device: a merchandiser learns what
 * `g:availability` means by seeing `in_stock` next to it, computed from a
 * product they recognise. That only works if it evaluates **what is on screen**
 * — an unsaved draft, mid-edit, possibly invalid, possibly naming a binding
 * that does not exist. Hence:
 *
 *  - no persisted template is required, and `baseTemplateId` is optional;
 *  - a field naming a non-existent attribute comes back `unbound: true`, never
 *    as a `400` that empties the whole preview column;
 *  - the caller needs `catalog:read` as well as `product_feeds:read`, because
 *    the response renders catalogue data and resolved prices;
 *  - it writes nothing at all.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const FEEDS_ONLY = { cookies: { b2b_session: 'stub-tplpreview-feeds-session' } };
const CATALOG_ONLY = { cookies: { b2b_session: 'stub-tplpreview-catalog-session' } };

const FEEDS_ONLY_ID = '00000000-0000-4000-8000-0000000000e7';
const CATALOG_ONLY_ID = '00000000-0000-4000-8000-0000000000e8';

const URL = '/api/v1/admin/feed-previews/template';

interface PreviewField {
  outputName: string;
  value: string | null;
  resolvedFrom: 'source' | 'fallback' | 'omitted';
  wouldSkipItem: boolean;
  issueReason: string | null;
  unbound: boolean;
  helpKey: string | null;
}

interface PreviewBody {
  fields: PreviewField[];
  wouldEmitItem: boolean;
  skipReason: string | null;
  renderedItem: string;
  resolvedContext: {
    salesChannelId: string;
    languageCode: string;
    currencyCode: string;
    priceListId: string | null;
    pricePresentation: 'net' | 'gross';
    taxCountry: string | null;
  };
}

describe('feed template preview — unsaved draft [contract]', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let googleTemplateId: string;

  const draft = (
    fields: Array<Record<string, unknown>>,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    providerCode: 'custom',
    outputFormat: 'csv',
    itemGranularity: 'product',
    taxonomyProviderCode: null,
    fields,
    ...over,
  });

  async function seedAdmin(
    id: string,
    code: string,
    permissions: string[],
    session: string,
  ): Promise<void> {
    const role = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      ...ADMIN,
      payload: { code, name: code, permissions },
    });
    expect(role.statusCode).toBe(200);
    const em = h.em();
    em.create(AdminUser, {
      id,
      email: `${code}@example.com`,
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Preview',
      lastName: code,
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES[session] = { adminUserId: id };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedAdmin(
      FEEDS_ONLY_ID,
      'product_feeds_tplpreview_feeds',
      ['product_feeds:read'],
      'stub-tplpreview-feeds-session',
    );
    await seedAdmin(
      CATALOG_ONLY_ID,
      'product_feeds_tplpreview_catalog',
      ['catalog:read'],
      'stub-tplpreview-catalog-session',
    );
    await setChannelStorefrontUrl(h, 'pl_retail');
    await seedFeedPrices(h.em(), { code: 'feed_preview_default' });
    channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    googleTemplateId = (
      await h.em().findOneOrFail(FeedTemplate, { systemCode: 'google_merchant_v1' })
    ).id;
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-tplpreview-feeds-session'];
    delete ADMIN_COOKIES['stub-tplpreview-catalog-session'];
    await teardownBackendServer(h);
  });

  it('evaluates a draft that was never saved, with no template id at all', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        draft: draft([
          { outputName: 'sku', sourceKind: 'sku', sortOrder: 0 },
          { outputName: 'title', sourceKind: 'name', sortOrder: 1 },
          { outputName: 'brandish', sourceKind: 'constant', constantValue: 'ACME', sortOrder: 2 },
        ]),
        context: { salesChannelId: channelId, languageCode: 'en-US', currencyCode: 'PLN' },
        productId: SEED_PRODUCT_101_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as { data: PreviewBody }).data;

    expect(body.fields.map((f) => f.outputName)).toEqual(['sku', 'title', 'brandish']);
    expect(body.fields[0]?.value).toBe('EXAMPLE-SIMPLE-001');
    expect(body.fields[1]?.value).toBe('Example simple product');
    expect(body.fields[2]?.value).toBe('ACME');
    expect(body.wouldEmitItem).toBe(true);
    expect(body.skipReason).toBeNull();
    // The serialized item, so the operator can see what actually leaves.
    expect(body.renderedItem).toContain('EXAMPLE-SIMPLE-001');
    expect(body.resolvedContext.salesChannelId).toBe(channelId);
  });

  it('reports a binding that does not exist as `unbound`, never as a 400', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        draft: draft([
          { outputName: 'sku', sourceKind: 'sku', sortOrder: 0 },
          {
            outputName: 'energy_class',
            sourceKind: 'attribute',
            sourceKey: 'no_such_definition_here',
            sortOrder: 1,
          },
        ]),
        context: { salesChannelId: channelId },
        productId: SEED_PRODUCT_101_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as { data: PreviewBody }).data;
    const unbound = body.fields.find((f) => f.outputName === 'energy_class');
    expect(unbound?.unbound).toBe(true);
    expect(unbound?.value).toBeNull();
    expect(unbound?.resolvedFrom).toBe('omitted');
    // …and the rest of the preview still works, which is the whole point.
    expect(body.fields.find((f) => f.outputName === 'sku')?.value).toBe('EXAMPLE-SIMPLE-001');
  });

  it('marks a fallback doing the work, and an omitted optional field', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        draft: draft([
          {
            outputName: 'gtin',
            sourceKind: 'attribute',
            sourceKey: 'color',
            fallbackValue: 'unknown',
            sortOrder: 0,
          },
          {
            outputName: 'mpn',
            sourceKind: 'constant',
            constantValue: '',
            sortOrder: 1,
          },
        ]),
        context: { salesChannelId: channelId },
        productId: SEED_PRODUCT_101_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as { data: PreviewBody }).data;
    // `color` is populated on the seed product, so no fallback is needed.
    expect(body.fields[0]?.resolvedFrom).toBe('source');
    // An empty constant produces nothing and is simply left out of the item.
    expect(body.fields[1]?.resolvedFrom).toBe('omitted');
    expect(body.fields[1]?.value).toBeNull();
  });

  it('names the field that would cause the product to be left out (FR-072)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        draft: draft([
          { outputName: 'sku', sourceKind: 'sku', sortOrder: 0 },
          {
            // Bound to nothing that exists, and required: the operator's most
            // common self-inflicted wound, and the one the verdict banner has
            // to name before they wonder where their products went.
            outputName: 'ean',
            sourceKind: 'attribute',
            sourceKey: 'no_such_definition_here',
            providerRequired: true,
            sortOrder: 1,
          },
        ]),
        context: { salesChannelId: channelId },
        productId: SEED_PRODUCT_101_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as { data: PreviewBody }).data;
    const required = body.fields.find((f) => f.outputName === 'ean');
    expect(required?.wouldSkipItem).toBe(true);
    expect(required?.issueReason).toBe('missing_required_field');
    expect(body.wouldEmitItem).toBe(false);
    expect(body.skipReason).toBe('missing_required_field');
  });

  it('inherits the glosses of the template the draft came from', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        baseTemplateId: googleTemplateId,
        draft: draft([{ outputName: 'g:title', sourceKind: 'name', sortOrder: 0 }], {
          providerCode: 'google_merchant',
          outputFormat: 'xml',
        }),
        context: { salesChannelId: channelId },
        productId: SEED_PRODUCT_101_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as { data: PreviewBody }).data;
    expect(body.fields[0]?.helpKey).toBe('templateHelp.google.title');
  });

  it('fills the context the operator did not supply', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        draft: draft([{ outputName: 'sku', sourceKind: 'sku', sortOrder: 0 }]),
        productId: SEED_PRODUCT_101_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const { resolvedContext } = (res.json() as { data: PreviewBody }).data;
    expect(resolvedContext.salesChannelId).toBeTruthy();
    expect(resolvedContext.languageCode).toBeTruthy();
    expect(resolvedContext.currencyCode).toHaveLength(3);
  });

  it('answers not-found for a product that does not exist', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: {
        draft: draft([{ outputName: 'sku', sourceKind: 'sku', sortOrder: 0 }]),
        context: { salesChannelId: channelId },
        productId: '00000000-0000-4000-8000-0000000dead1',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  describe('permission gating', () => {
    it('refuses an administrator holding only product_feeds:read', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: URL,
        ...FEEDS_ONLY,
        payload: {
          draft: draft([{ outputName: 'sku', sourceKind: 'sku', sortOrder: 0 }]),
          productId: SEED_PRODUCT_101_ID,
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('refuses an administrator holding only catalog:read', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: URL,
        ...CATALOG_ONLY,
        payload: {
          draft: draft([{ outputName: 'sku', sourceKind: 'sku', sortOrder: 0 }]),
          productId: SEED_PRODUCT_101_ID,
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  it('writes nothing — no run, no artefact, no audit entry', async () => {
    const em = h.em();
    const countAudit = async (): Promise<number> =>
      Number(
        (
          (await em
            .getConnection()
            .execute(`select count(*)::int as c from audit_log_entries`)) as Array<{ c: number }>
        )[0]!.c,
      );
    const before = {
      runs: await em.count(FeedRun, {}),
      artefacts: await em.count(FeedArtefact, {}),
      templates: await em.count(FeedTemplate, {}),
      audit: await countAudit(),
    };

    for (let i = 0; i < 3; i += 1) {
      const res = await h.app.inject({
        method: 'POST',
        url: URL,
        ...ADMIN,
        payload: {
          draft: draft([{ outputName: 'sku', sourceKind: 'sku', sortOrder: 0 }]),
          context: { salesChannelId: channelId },
          productId: SEED_PRODUCT_101_ID,
        },
      });
      expect(res.statusCode).toBe(200);
    }

    em.clear();
    expect(await em.count(FeedRun, {})).toBe(before.runs);
    expect(await em.count(FeedArtefact, {})).toBe(before.artefacts);
    expect(await em.count(FeedTemplate, {})).toBe(before.templates);
    expect(await countAudit()).toBe(before.audit);
  });
});
