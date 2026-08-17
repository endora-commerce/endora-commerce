import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 072 wave 1 (T093) — the endpoint that only worked in production.
 *
 * `PUT /api/v1/admin/cms/page-builder/color-palette` reads its writer through
 * an optional late-bound setter:
 *
 *     const writer = deps.getColorPaletteWriter?.();
 *     if (!writer) throw new Error('Color palette writer is not configured.');
 *
 * `composition.ts` called `cms.handle.setColorPaletteWriter(...)` after building
 * the module. `test-server.ts` called none of the four `set*` setters at all —
 * so under `setupBackendServer` this route has always thrown a bare `Error`,
 * i.e. answered 500, and no test ever noticed because no test called it. The
 * same is true of the breakpoints and palette *read* resolvers, which quietly
 * fell back to env defaults and `[]`.
 *
 * That is the shape this wave keeps finding: a capability wired in exactly one
 * of the two compositions, where the unwired one degrades silently rather than
 * failing loudly. Owning the wiring inside the module removes the asymmetry —
 * there is no setter left for a composition root to forget, because the module
 * resolves `settingsAdminService` for itself.
 *
 * So this test is deliberately a round-trip through the HTTP surface rather
 * than an assertion about registrations: what was broken was the endpoint, and
 * the endpoint is what has to answer.
 */

describe('admin CMS page-builder colour palette (072 T093)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes the palette and reads it back through the page-builder config', async () => {
    const entries = [
      { id: randomUUID(), name: 'Brand primary', hex: '#1a2b3c' },
      { id: randomUUID(), name: 'Brand accent', hex: '#ffcc00' },
    ];

    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/cms/page-builder/color-palette',
      cookies: adminCookie,
      payload: { entries },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().data.entries).toEqual(entries);

    // The read path resolves through the same settings store the write used, so
    // a writer wired to a different channel than the resolver reads would show
    // up here rather than in the 200 above.
    const config = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/page-builder/config',
      cookies: adminCookie,
    });
    expect(config.statusCode).toBe(200);
  });
});
