import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cmsReservedSegmentsResponseSchema, ERROR_CODES } from '@endora-commerce/contracts';
import { CMS_SETTING_CODES } from '@endora-commerce/mod-cms';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * The reserved-slug refusal and the value the editor reads
 * (`specs/105-cms-root-page-urls/` FR-031…FR-033;
 * `contracts/cms-page-url.md` §5.1–§5.4).
 *
 * **Nothing here creates precedence.** A CMS page already loses to a storefront
 * route: `/[...slug]` is a root catch-all and sorts last under Next's own
 * sorter, measured in `research.md` D-9, with nothing configured and nothing
 * built. What these cases are about is the *silence* that follows — a page that
 * saves, publishes and is never served while the operator is told nothing,
 * which is indistinguishable from a working page because the URL answers 200
 * with somebody else's content.
 *
 * The value is written through the ordinary settings API rather than seeded, so
 * what the test exercises is the path an operator takes.
 */
describe('CMS reserved slug segments contract (feature 105, FR-031…FR-033)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
  });

  afterEach(async () => {
    await reserve([]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Write the deployment's reserved set, the way an operator does. */
  async function reserve(segments: unknown[]): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${encodeURIComponent(CMS_SETTING_CODES.RESERVED_SLUG_SEGMENTS)}/value`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ scope: 'all', value: segments }),
    });
    expect(res.statusCode).toBe(200);
  }

  async function readReserved(): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/pages/reserved-segments',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    return cmsReservedSegmentsResponseSchema.parse(res.json().data).segments;
  }

  async function createPage(slug: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Reserved ${slug}`,
        slug,
        active: true,
        description: null,
        salesChannelIds: [channelId],
        languages: ['en-US'],
      }),
    });
  }

  async function patchPage(id: string, body: Record<string, unknown>) {
    return h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/pages/${id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify(body),
    });
  }

  it('reserves nothing by default, so a fresh platform refuses no slug', async () => {
    // The default is empty and that is not a gap left open (§5.2): a list
    // shipped by `cms` would be a derived fact about a *consumer* — the
    // storefront's route table — written into the *owner*.
    expect(await readReserved()).toEqual([]);

    const res = await createPage(`free-${Date.now()}`);
    expect(res.statusCode).toBe(201);
  });

  it('publishes the value the refusal enforces, normalised (FR-033)', async () => {
    // One source, two readers. The editor's inline warning and the save-time
    // refusal read the same value, so they cannot disagree — and what the
    // editor gets is what the refusal compares, not the raw setting.
    await reserve(['/Cart', 'checkout/pay', 'cart', 7, '  kontakt  ']);

    expect(await readReserved()).toEqual(['cart', 'checkout', 'kontakt']);
  });

  it('refuses a create whose first segment is reserved, naming the segment', async () => {
    await reserve(['cart']);

    const res = await createPage('cart');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.CMS_SLUG_RESERVED, details: { segment: 'cart' } },
    });
    // §5.4 — the code for a consumer to branch on, the sentence for the
    // operator to read, and the sentence names the segment.
    expect(String(res.json().error.message)).toContain('cart');
  });

  it('refuses a slug *under* a reserved segment, because the first segment is what collides', async () => {
    await reserve(['checkout']);

    const res = await createPage('checkout/pay');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.CMS_SLUG_RESERVED, details: { segment: 'checkout' } },
    });
  });

  it('does not refuse a slug that merely starts with the same letters', async () => {
    // A prefix match would refuse `carts-and-baskets` for a reserved `cart`,
    // which collides with nothing: the storefront routes on whole segments.
    await reserve(['cart']);

    const res = await createPage(`carting-${Date.now()}`);

    expect(res.statusCode).toBe(201);
  });

  it('refuses an update that writes a reserved slug', async () => {
    await reserve(['login']);
    await reserve([]);
    const created = await createPage(`renamed-${Date.now()}`);
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    await reserve(['login']);

    const res = await patchPage(id, { slug: 'login' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_SLUG_RESERVED } });
  });

  it('lets an update that writes no slug through, even on a page whose slug is now reserved', async () => {
    // The reserved set is deployment configuration and may grow after a page
    // was saved. Refusing every edit of such a page would punish the operator
    // for a decision somebody else made later; what is refused is *choosing*
    // the address, and this request chooses nothing.
    const slug = `grandfathered-${Date.now()}`;
    const created = await createPage(slug);
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    await reserve([slug]);
    const res = await patchPage(id, { description: 'Edited while its slug is reserved' });

    expect(res.statusCode).toBe(200);
  });

  it('is gated by `cms.read`, like every other CMS admin read', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/pages/reserved-segments',
    });
    expect(res.statusCode).toBe(401);
  });
});
