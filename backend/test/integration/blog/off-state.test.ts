import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLOG_SETTING_CODES } from '@endora-commerce/mod-blog';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * `blog` off-state — Constitution XVII item 6 (`specs/163-page-builder-marketing-pages/`
 * T069, analysis I1: the file did not exist before this feature).
 *
 * The surfaces map onto this module as follows:
 *
 *  * **API rejection** — the admin post list and an admin write, the admin
 *    category tree, and every storefront read: the index, a slug, a tag and
 *    the card list `GET /api/v1/blog/posts` that `blog.LatestPosts` renders
 *    (feature 163). A read going 503 while a write still lands, or the editor
 *    going while the storefront keeps serving, are the shapes an operator
 *    would not notice;
 *  * **non-editable configuration** — `blog.posts_per_page`, an ordinary
 *    setting. `blog.activation` is the module's own activation control, the
 *    single exception item 6 names, and is not written here;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked. The
 *    `new-post` palette action's off-state is
 *    `_admin_surfaces/batch-sixteen-palette-off-state.test.ts`' question and is
 *    deliberately not repeated: two derivations of one claim are two answers
 *    waiting to disagree (the `cms` off-state file makes the same choice);
 *  * **the block** — `blog.LatestPosts` leaves the Page Builder's served
 *    descriptor and the storefront's module presence reports `blog` absent,
 *    which is what the storefront filters `blog.*` blocks and skips their
 *    reads by. Asserted on both axes below, beside the harness, because a
 *    block is neither a route nor a setting;
 *  * **restoration** — asserted by the harness after both axes, and by the
 *    block probe after each. Off is non-destructive: posts, categories and tags
 *    stay where they are.
 */
describe('blog off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const channel = { 'x-sales-channel': 'default' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'blog', {
      routes: [
        { url: '/api/v1/admin/blog/posts', cookies: admin },
        { method: 'POST', url: '/api/v1/admin/blog/posts', cookies: admin, payload: {} },
        { url: '/api/v1/admin/blog/categories', cookies: admin },
        { url: '/api/v1/blog/by-channel', headers: channel },
        { url: '/api/v1/blog/by-slug?slug=default', headers: channel },
        { url: '/api/v1/blog/tag-by-code?code=news', headers: channel },
        // Feature 163 — the card list behind `blog.LatestPosts`.
        { url: '/api/v1/blog/posts?limit=3', headers: channel },
        // Feature 171 — the storefront middleware's routing read, and the former-prefix list.
        { url: '/api/v1/blog/routing', headers: channel },
        { url: '/api/v1/admin/blog/addresses', cookies: admin },
      ],
      adminPresence: { cookies: admin },
      settingWrite: { code: BLOG_SETTING_CODES.POSTS_PER_PAGE, value: 10, cookies: admin },
    });
  });

  async function descriptorNames(): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/cms/page-builder/config', cookies: admin });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { components: Array<{ name: string }> } }).data.components.map((c) => c.name);
  }

  async function storefrontPresence(): Promise<boolean | undefined> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/storefront/module-presence', headers: channel });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { modules: Array<{ id: string; present: boolean }> }).modules.find((m) => m.id === 'blog')
      ?.present;
  }

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'withdraws blog.LatestPosts from the palette and the storefront while off (%s), and restores it',
    async (axis) => {
      expect(await descriptorNames()).toContain('blog.LatestPosts');
      expect(await storefrontPresence()).toBe(true);
      await withModuleOff('blog', axis, async () => {
        expect(await descriptorNames()).not.toContain('blog.LatestPosts');
        expect(await storefrontPresence()).toBe(false);
      });
      expect(await descriptorNames()).toContain('blog.LatestPosts');
      expect(await storefrontPresence()).toBe(true);
    },
  );
});
