import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import { SEEDED_HOOKS } from '../../../../packages/modules/cms/src/backend/services/seed-hooks.js';

describe('admin CMS Hooks contract (T067)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let plOnlyChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const defaultChannel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = defaultChannel.id;
    const plOnly = em.create(SalesChannel, {
      code: `cms-hooks-pl-${Date.now()}`,
      name: { 'pl-PL': 'CMS hooks PL' },
      languages: ['pl-PL'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      isPublic: true,
      status: 'active',
    });
    await em.persistAndFlush(plOnly);
    plOnlyChannelId = plOnly.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createBlock(code: string) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Block ${code}`,
        code,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data;
  }

  it('lists seeded Hooks and protects system Hooks from deletion', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/hooks',
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const hooks = (list.json() as { data: Array<{ id: string; code: string; isSystem: boolean }> })
      .data;
    for (const seed of SEEDED_HOOKS) {
      expect(hooks.some((hook) => hook.code === seed.code && hook.isSystem)).toBe(true);
    }

    const homepageTop = hooks.find((hook) => hook.code === 'homepage.top');
    expect(homepageTop).toBeDefined();
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/hooks/${homepageTop?.id}`,
      cookies: adminCookie,
    });

    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({
      error: { code: ERROR_CODES.CMS_HOOK_SYSTEM_PROTECTED },
    });
  });

  it('creates, patches, attaches, reorders, detaches, and deletes a non-system Hook', async () => {
    const code = `quote.cta.${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/hooks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Quote CTA',
        code,
        active: true,
        description: 'Quote call to action',
        salesChannelIds: [defaultChannelId],
      }),
    });
    expect(created.statusCode).toBe(201);
    const hook = (
      created.json() as { data: { id: string; code: string; isSystem: boolean; version: number } }
    ).data;
    expect(hook).toMatchObject({ code, isSystem: false });

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/hooks/${hook.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Quote CTA renamed',
        description: null,
        salesChannelIds: [defaultChannelId, plOnlyChannelId],
        version: hook.version,
      }),
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      data: {
        name: 'Quote CTA renamed',
        description: null,
        salesChannelIds: expect.arrayContaining([defaultChannelId, plOnlyChannelId]),
      },
    });

    const firstBlock = await createBlock(`hook-first-${Date.now()}`);
    const secondBlock = await createBlock(`hook-second-${Date.now()}`);

    const attachSecond = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ blockId: secondBlock.id, position: 10 }),
    });
    expect(attachSecond.statusCode).toBe(201);

    const attachFirst = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ blockId: firstBlock.id, position: 0 }),
    });
    expect(attachFirst.statusCode).toBe(201);

    const ordered = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      cookies: adminCookie,
    });
    expect(ordered.statusCode).toBe(200);
    expect((ordered.json() as { data: Array<{ blockId: string }> }).data.map((x) => x.blockId)).toEqual([
      firstBlock.id,
      secondBlock.id,
    ]);

    const reorder = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments/${firstBlock.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ position: 20 }),
    });
    expect(reorder.statusCode).toBe(200);

    const reordered = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      cookies: adminCookie,
    });
    expect(reordered.statusCode).toBe(200);
    expect(
      (reordered.json() as { data: Array<{ blockId: string }> }).data.map((x) => x.blockId),
    ).toEqual([secondBlock.id, firstBlock.id]);

    const detach = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments/${secondBlock.id}`,
      cookies: adminCookie,
    });
    expect(detach.statusCode).toBe(204);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/hooks/${hook.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  /**
   * Constitution XIII — every admin write to a Hook, and to the blocks attached
   * to it, runs as a Command, so each one leaves exactly one audit entry naming
   * the acting admin, written in the write's own transaction. An attachment has
   * no id of its own: its entries are the Hook's, and name the block.
   */
  describe('audit trail (Constitution XIII)', () => {
    async function auditRows(action: string, hookId: string): Promise<AuditLogEntry[]> {
      return h.em().find(AuditLogEntry, { action, objectType: 'cms_hook', objectId: hookId });
    }

    async function createdHook(prefix: string): Promise<{ id: string; version: number; code: string }> {
      const code = `${prefix}.${Date.now()}`;
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/cms/hooks',
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({
          name: `Hook ${code}`,
          code,
          active: true,
          description: null,
          salesChannelIds: [defaultChannelId],
        }),
      });
      expect(created.statusCode).toBe(201);
      const hook = (created.json() as { data: { id: string; version: number } }).data;
      return { ...hook, code };
    }

    function attach(hookId: string, blockId: string, position: number) {
      return h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/cms/hooks/${hookId}/attachments`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ blockId, position }),
      });
    }

    it('records one entry for a create, attributed to the acting admin', async () => {
      const hook = await createdHook('audit.create');

      const rows = await auditRows('cms_hook.create', hook.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(rows[0]!.stateBefore ?? null).toBeNull();
      expect(rows[0]!.stateAfter).toMatchObject({
        name: `Hook ${hook.code}`,
        code: hook.code,
        active: true,
        isSystem: false,
        salesChannelIds: [defaultChannelId],
        version: 1,
      });
    });

    it('records one entry for an update, with the state on both sides', async () => {
      const hook = await createdHook('audit.update');

      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/cms/hooks/${hook.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({
          name: 'Renamed for the audit',
          salesChannelIds: [defaultChannelId, plOnlyChannelId],
          version: hook.version,
        }),
      });
      expect(patch.statusCode).toBe(200);

      const rows = await auditRows('cms_hook.update', hook.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(rows[0]!.stateBefore).toMatchObject({
        name: `Hook ${hook.code}`,
        salesChannelIds: [defaultChannelId],
      });
      expect(rows[0]!.stateAfter).toMatchObject({
        name: 'Renamed for the audit',
        salesChannelIds: expect.arrayContaining([defaultChannelId, plOnlyChannelId]),
      });
    });

    it('records one entry each for attaching, reordering and detaching a block', async () => {
      const hook = await createdHook('audit.attachments');
      const block = await createBlock(`audit-attached-${Date.now()}`);

      expect((await attach(hook.id, block.id, 10)).statusCode).toBe(201);

      const reorder = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/cms/hooks/${hook.id}/attachments/${block.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ position: 30 }),
      });
      expect(reorder.statusCode).toBe(200);

      const detach = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/cms/hooks/${hook.id}/attachments/${block.id}`,
        cookies: adminCookie,
      });
      expect(detach.statusCode).toBe(204);

      const attached = await auditRows('cms_hook.attach_block', hook.id);
      expect(attached).toHaveLength(1);
      expect(attached[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(attached[0]!.stateBefore ?? null).toBeNull();
      expect(attached[0]!.stateAfter).toEqual({ blockId: block.id, position: 10 });

      const reordered = await auditRows('cms_hook.reorder_block', hook.id);
      expect(reordered).toHaveLength(1);
      expect(reordered[0]!.stateBefore).toEqual({ blockId: block.id, position: 10 });
      expect(reordered[0]!.stateAfter).toEqual({ blockId: block.id, position: 30 });

      const detached = await auditRows('cms_hook.detach_block', hook.id);
      expect(detached).toHaveLength(1);
      expect(detached[0]!.stateBefore).toEqual({ blockId: block.id, position: 30 });
      expect(detached[0]!.stateAfter ?? null).toBeNull();
    });

    it('records one entry for a delete, keeping what the hook was', async () => {
      const hook = await createdHook('audit.delete');

      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/cms/hooks/${hook.id}`,
        cookies: adminCookie,
      });
      expect(del.statusCode).toBe(204);

      const rows = await auditRows('cms_hook.delete', hook.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorAdminUserId).toEqual(expect.any(String));
      expect(rows[0]!.stateBefore).toMatchObject({ code: hook.code, isSystem: false });
      expect(rows[0]!.stateAfter ?? null).toBeNull();
    });

    it('records nothing for a write that was refused', async () => {
      const hook = await createdHook('audit.refused');

      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/cms/hooks/${hook.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ name: 'Stale write', version: hook.version + 5 }),
      });
      expect(patch.statusCode).toBe(409);
      expect(await auditRows('cms_hook.update', hook.id)).toHaveLength(0);

      const list = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/cms/hooks',
        cookies: adminCookie,
      });
      const system = (list.json() as { data: Array<{ id: string; isSystem: boolean }> }).data.find(
        (candidate) => candidate.isSystem,
      );
      expect(system).toBeDefined();
      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/cms/hooks/${system!.id}`,
        cookies: adminCookie,
      });
      expect(del.statusCode).toBe(409);
      expect(await auditRows('cms_hook.delete', system!.id)).toHaveLength(0);
    });

    it('records nothing for reordering a block that was not attached', async () => {
      const hook = await createdHook('audit.noop-reorder');
      const block = await createBlock(`audit-never-reordered-${Date.now()}`);

      const reorder = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/cms/hooks/${hook.id}/attachments/${block.id}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ position: 5 }),
      });
      // What the route answers here is deliberately not asserted: this case holds
      // the audit trail only, and the status is the route's own, unchanged.
      expect(reorder.statusCode).toBeLessThan(500);

      expect(await auditRows('cms_hook.reorder_block', hook.id)).toHaveLength(0);
    });

    it('records nothing for detaching a block that was not attached, and still answers 204', async () => {
      const hook = await createdHook('audit.noop-detach');
      const block = await createBlock(`audit-never-attached-${Date.now()}`);

      const detach = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/cms/hooks/${hook.id}/attachments/${block.id}`,
        cookies: adminCookie,
      });
      expect(detach.statusCode).toBe(204);

      expect(await auditRows('cms_hook.detach_block', hook.id)).toHaveLength(0);
    });
  });
});
