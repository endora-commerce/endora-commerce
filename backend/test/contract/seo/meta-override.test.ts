import type { EntityManager } from '@mikro-orm/postgresql';
import type { SeoProductMetaWritePort } from '@endora-commerce/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';

/**
 * T235 — admin can read the resolved meta for a product (rule-derived by default), and an
 * override flips `source` to `'override'`; a field the override leaves empty falls back to the
 * rule. Since feature 174 the product read is the static `GET …/seo/meta/product/:id` at a scope
 * (Global here) and the override is written through `seoProductMetaWritePort`, the path catalog's
 * save takes — the generic product `PUT` is refused (`product-meta-read-relaxed.test.ts`).
 */

describe('Admin SEO meta override', () => {
  let h: BackendServerHandle;
  let productId: string;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const product = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    productId = product.id;
  });

  afterAll(async () => {
    await h.em().getConnection().execute(
      `delete from seo_meta_overrides where entity_type = 'product' and entity_id = ? and sales_channel_id is null and locale is null`,
      [productId],
    );
    await teardownBackendServer(h);
  });

  type Body = {
    data: {
      resolved: { title: string; description: string; openGraph: { title: string }; source: string };
      scoped: Record<string, { source: string; value: string | null }>;
    };
  };

  it('returns rule-derived meta at Global when no override exists', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/seo/meta/product/${productId}`, cookies: admin });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Body;
    expect(body.data.resolved.source).toBe('rule');
    expect(body.data.resolved.title.length).toBeGreaterThan(0);
    expect(body.data.scoped['title']).toMatchObject({ source: 'absent', value: null });
  });

  it('an override written through the port flips the resolver to source=override', async () => {
    const port = h.container.resolve<SeoProductMetaWritePort<EntityManager>>('seoProductMetaWritePort');
    await h.em().fork().transactional(async (em) => {
      await port.applyWithin(em, {
        productId,
        scope: { level: 'global' },
        changes: {
          title: { op: 'set', value: 'Hand-tuned title' },
          description: { op: 'set', value: 'Hand-tuned description.' },
        },
      });
    });

    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/seo/meta/product/${productId}`, cookies: admin });
    const body = res.json() as Body;
    expect(body.data.resolved.source).toBe('override');
    expect(body.data.resolved.title).toBe('Hand-tuned title');
    expect(body.data.resolved.description).toBe('Hand-tuned description.');
    // OG title was not overridden, so falls back to the rule (product name).
    expect(body.data.resolved.openGraph.title).not.toBe('Hand-tuned title');
    expect(body.data.scoped['title']).toMatchObject({ source: 'set', value: 'Hand-tuned title' });
  });

  it('returns 404 when the product does not exist', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/seo/meta/product/00000000-0000-4000-8000-000000000000`,
      cookies: admin,
    });
    expect(res.statusCode).toBe(404);
  });
});
