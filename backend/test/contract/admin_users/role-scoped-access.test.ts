import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

const SETTINGS_VIEWER_ID = '00000000-0000-4000-8000-0000000000d1';
const CHANNEL_VIEWER_ID = '00000000-0000-4000-8000-0000000000d2';
const CONTENT_EDITOR_ID = '00000000-0000-4000-8000-0000000000d3';
const ASSETS_READER_ID = '00000000-0000-4000-8000-0000000000d4';

describe('role-scoped access (US2)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const settingsRole = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/settings_viewer',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'settings_viewer',
        name: 'Settings viewer',
        permissions: ['settings:read'],
      },
    });
    expect(settingsRole.statusCode).toBe(200);
    const settingsRoleId = (settingsRole.json() as { data: { id: string } }).data.id;

    const channelRole = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/channel_viewer',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'channel_viewer',
        name: 'Channel viewer',
        permissions: ['sales_channels:read'],
      },
    });
    expect(channelRole.statusCode).toBe(200);
    const channelRoleId = (channelRole.json() as { data: { id: string } }).data.id;

    const contentRole = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/content_editor',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'content_editor',
        name: 'Content editor',
        permissions: ['blog.read', 'blog.write', 'cms.read', 'cms.write'],
      },
    });
    expect(contentRole.statusCode).toBe(200);
    const contentRoleId = (contentRole.json() as { data: { id: string } }).data.id;

    const assetsRole = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/assets_reader',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'assets_reader',
        name: 'Assets reader',
        permissions: ['assets.read'],
      },
    });
    expect(assetsRole.statusCode).toBe(200);
    const assetsRoleId = (assetsRole.json() as { data: { id: string } }).data.id;

    const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);

    em.create(AdminUser, {
      id: SETTINGS_VIEWER_ID,
      email: 'settings-viewer@example.com',
      passwordHash,
      firstName: 'Settings',
      lastName: 'Viewer',
      adminRoleId: settingsRoleId,
      status: 'active',
    });
    em.create(AdminUser, {
      id: CHANNEL_VIEWER_ID,
      email: 'channel-viewer@example.com',
      passwordHash,
      firstName: 'Channel',
      lastName: 'Viewer',
      adminRoleId: channelRoleId,
      status: 'active',
    });
    em.create(AdminUser, {
      id: CONTENT_EDITOR_ID,
      email: 'content-editor@example.com',
      passwordHash,
      firstName: 'Content',
      lastName: 'Editor',
      adminRoleId: contentRoleId,
      status: 'active',
    });
    em.create(AdminUser, {
      id: ASSETS_READER_ID,
      email: 'assets-reader@example.com',
      passwordHash,
      firstName: 'Assets',
      lastName: 'Reader',
      adminRoleId: assetsRoleId,
      status: 'active',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('settings_viewer can read settings but not catalog', async () => {
    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/groups',
      cookies: { b2b_session: 'stub-settings-viewer-session' },
    });
    expect(read.statusCode).toBe(200);

    const catalog = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products',
      cookies: { b2b_session: 'stub-settings-viewer-session' },
    });
    expect(catalog.statusCode).toBe(403);
    expect((catalog.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('channel_viewer can list sales channels', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels',
      cookies: { b2b_session: 'stub-channel-viewer-session' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('content_editor can list CMS pages but not catalog products', async () => {
    const cms = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/pages',
      cookies: { b2b_session: 'stub-content-editor-session' },
    });
    expect(cms.statusCode).toBe(200);

    const catalog = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products',
      cookies: { b2b_session: 'stub-content-editor-session' },
    });
    expect(catalog.statusCode).toBe(403);
  });

  it('assets_reader can browse assets but not upload', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/assets',
      cookies: { b2b_session: 'stub-assets-reader-session' },
    });
    expect(list.statusCode).toBe(200);

    const upload = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets',
      cookies: { b2b_session: 'stub-assets-reader-session' },
      payload: {},
    });
    expect(upload.statusCode).toBe(403);
  });

  it('customers:read allows organization list without customers:manage', async () => {
    const em = h.em();
    const { AdminRole } = await import('../../helpers/package-entities.js');
    const role = await em.findOne(AdminRole, { code: 'settings_viewer' });
    expect(role).toBeTruthy();
    role!.permissions = ['customers:read'];
    await em.flush();

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations',
      cookies: { b2b_session: 'stub-settings-viewer-session' },
    });
    expect(list.statusCode).toBe(200);
  });
});
