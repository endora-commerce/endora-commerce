import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * Issue #213 — the off-state obligation for `/admin-roles`.
 *
 * Constitution XVII item 5 says a module that is off contributes **no
 * permission**. It contributed them anyway, for all 65 modules, because
 * `PermissionCatalogueService` filtered on `registryCache.enabledIds()` — the
 * platform axis alone — and then memoised the answer behind an `invalidate()`
 * that two composition roots had to remember to call.
 *
 * The reason it survived is the reason this file exists: **the off-state
 * harness had never looked at this surface at all**. That is the shape issue
 * #141 already caught once, where four off-state tests passed against a module
 * that was switched on. So the sweep lives in `expectModuleAbsent` — every
 * module's off-state test gets it, none of them has to ask — and this file
 * covers the catalogue's own behaviour on top of it: the axis, the absence of a
 * memo, and the line between "may not be granted" and "is not a permission".
 *
 * `blog` is the subject because its codes come from the **core**
 * `PERMISSION_CATALOGUE` rather than from its manifest. A fix that filtered
 * manifest permissions only would look correct on any module-declared code and
 * leave the reported case exactly as it was.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
const ADMIN = { b2b_session: 'stub-admin-session' };
const BLOG_CODES = ['blog.read', 'blog.write'];

async function grantableCodes(h: BackendServerHandle): Promise<string[]> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/admin/permissions',
    cookies: ADMIN,
  });
  expect(res.statusCode, 'the role editor must be able to read its own catalogue').toBe(200);
  return (res.json() as { data: Array<{ code: string }> }).data.map((row) => row.code);
}

describe('permission catalogue — module off state [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  /**
   * The full checklist-item-6 sweep — API rejection, admin absence,
   * non-editable configuration, storefront absence, and restoration — with the
   * catalogue now among the surfaces it walks. Both axes, independently.
   */
  it('is absent on every surface while off, catalogue included, and fully restored', async () => {
    await expectModuleAbsent(h, 'blog', {
      routes: [
        { url: '/api/v1/admin/blog/posts', cookies: ADMIN },
        { url: '/api/v1/blog/by-channel' },
      ],
      adminPresence: { cookies: ADMIN },
      settingWrite: { code: 'blog.url_prefix', value: 'journal', cookies: ADMIN },
    });
  });

  /**
   * The case the defect was actually about: the platform still offers the
   * module, the operator has switched it off. It is called out separately
   * because it is the one combination the old accessor could not express — an
   * operator deactivation left the id in `enabledIds()`, so the catalogue never
   * saw it.
   */
  it('drops the codes of a module the operator deactivated while the platform offers it', async () => {
    expect(await grantableCodes(h)).toEqual(expect.arrayContaining(BLOG_CODES));

    await withModuleOff('blog', 'deactivated', async () => {
      // The precondition the assertion below is worth nothing without.
      const presence = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/module-presence',
        cookies: ADMIN,
      });
      expect(
        (
          presence.json() as { modules: Array<{ id: string; platformState: string }> }
        ).modules.find((m) => m.id === 'blog')?.platformState,
      ).toBe('installed');

      const codes = await grantableCodes(h);
      for (const code of BLOG_CODES) expect(codes).not.toContain(code);
      // Not "the catalogue went empty": an unrelated module's codes stay.
      expect(codes).toContain('catalog:read');
    });

    expect(await grantableCodes(h)).toEqual(expect.arrayContaining(BLOG_CODES));
  });

  /**
   * No memo, so nothing to invalidate and no listener whose registration order
   * could defer the drop past a synchronous read (issue #45). The flip and the
   * read happen in the same tick, with no `invalidate()` call and no pub/sub
   * round trip between them — a memoised catalogue fails this by construction,
   * whatever invalidates it.
   */
  it('reflects a flip on the very next read, in the same tick', async () => {
    const before = h.permissionCatalogueService.listAssignable().map((e) => e.code);
    expect(before).toContain('blog.read');

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['blog'] });
    const during = h.permissionCatalogueService.listAssignable().map((e) => e.code);
    expect(during).not.toContain('blog.read');

    registryCache.__setEnabledForTesting(ALL_IDS);
    const after = h.permissionCatalogueService.listAssignable().map((e) => e.code);
    expect(after).toContain('blog.read');
  });

  /**
   * Constitution XVII item 5's other half. A platform-unavailable module is
   * absent here too — `/admin-roles` renders a flat list of codes with no row
   * to carry a reason and no action an operator could take from it, so absent
   * is the whole answer. `/platform/modules` is where the two off states are
   * told apart, and it tells them apart.
   */
  it('drops the codes of a platform-unavailable module the same way', async () => {
    await withModuleOff('blog', 'platform-unavailable', async () => {
      const codes = await grantableCodes(h);
      for (const code of BLOG_CODES) expect(codes).not.toContain(code);
    });
  });

  /**
   * `integrations:manage` gates both the API-keys and the webhooks admin
   * surfaces. A shared code is only "contributed by a module that is off" when
   * **every** owner is off; taking it away because one of them is would leave
   * `webhooks/routes.ts` enforcing a gate nobody could be granted.
   */
  it('keeps a shared code grantable while its other owner is on', async () => {
    await withModuleOff('api_keys', 'deactivated', async () => {
      expect(await grantableCodes(h)).toContain('integrations:manage');
    });
    await withModuleOff('webhooks', 'deactivated', async () => {
      expect(await grantableCodes(h)).toContain('integrations:manage');
    });

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['api_keys', 'webhooks'] });
    try {
      expect(await grantableCodes(h)).not.toContain('integrations:manage');
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }
  });

  /**
   * Off is non-destructive and reversible, and a role that already holds a
   * switched-off module's code is where that is easiest to break. The grantable
   * set narrows; the **vocabulary** role upsert validates against does not, so
   * an operator renaming an unrelated role does not get
   * `400 Unknown permission(s): blog.read` and does not silently lose the grant.
   */
  it('still accepts a role that holds an absent module’s code', async () => {
    const created = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/w213_editor',
      cookies: ADMIN,
      payload: {
        code: 'w213_editor',
        name: 'Editor (issue 213)',
        permissions: ['blog.read', 'catalog:read'],
      },
    });
    expect(created.statusCode, created.body).toBe(200);

    await withModuleOff('blog', 'deactivated', async () => {
      const renamed = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/admin-roles/w213_editor',
        cookies: ADMIN,
        payload: {
          code: 'w213_editor',
          name: 'Editor (renamed while blog is off)',
          permissions: ['blog.read', 'catalog:read'],
        },
      });
      expect(
        renamed.statusCode,
        'saving a role that keeps a switched-off module’s code must not be a 400',
      ).toBe(200);
      expect((renamed.json() as { data: { permissions: string[] } }).data.permissions).toContain(
        'blog.read',
      );
    });

    // …and an unknown code is still refused, so the case above is a widening of
    // the vocabulary rather than the removal of the check.
    const bogus = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/w213_editor',
      cookies: ADMIN,
      payload: {
        code: 'w213_editor',
        name: 'Editor (issue 213)',
        permissions: ['blog.read', 'not_a_module:not_a_code'],
      },
    });
    expect(bogus.statusCode).toBe(400);
  });
});
