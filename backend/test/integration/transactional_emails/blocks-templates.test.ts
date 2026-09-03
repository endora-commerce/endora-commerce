import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/transactional-emails';

const tree = (text: string) => ({
  root: { props: {} },
  content: [{ type: 'transactional_emails.EmailText', props: { id: 't1', text, align: 'left' } }],
  zones: {},
});

describe('transactional emails — blocks/templates CRUD + audit (US3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('seeds the system default header/footer blocks (not deletable)', async () => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/blocks`, cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { data: { items: Array<{ code: string; isSystem: boolean }> } }).data.items;
    const header = items.find((b) => b.code === 'default_email_header');
    expect(header?.isSystem).toBe(true);
  });

  it('creates, edits content, embeds, and deletes a custom block', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: `${BASE}/blocks`,
      cookies: ADMIN_COOKIE,
      payload: { code: 'promo_banner', name: 'Promo banner', languages: ['en-US'] },
    });
    expect(created.statusCode).toBe(200);
    const block = (created.json() as { data: { id: string; version: number } }).data;

    const put = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/blocks/${block.id}/content/en-US`,
      cookies: ADMIN_COOKIE,
      payload: { content: tree('Promo!'), expectedVersion: block.version },
    });
    expect(put.statusCode).toBe(200);

    // Reject a non-email-safe component in a block.
    const unsafe = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/blocks/${block.id}/content/en-US`,
      cookies: ADMIN_COOKIE,
      payload: { content: { root: { props: {} }, content: [{ type: 'Evil', props: {} }] }, expectedVersion: block.version + 1 },
    });
    expect(unsafe.statusCode).toBe(400);

    const del = await h.app.inject({ method: 'DELETE', url: `${BASE}/blocks/${block.id}`, cookies: ADMIN_COOKIE });
    expect(del.statusCode).toBe(204);
  });

  it('creates and deletes a template', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: `${BASE}/templates`,
      cookies: ADMIN_COOKIE,
      payload: { code: 'newsletter_shell', name: 'Newsletter shell', languages: ['en-US'] },
    });
    expect(created.statusCode).toBe(200);
    const tpl = (created.json() as { data: { id: string } }).data;
    const del = await h.app.inject({ method: 'DELETE', url: `${BASE}/templates/${tpl.id}`, cookies: ADMIN_COOKIE });
    expect(del.statusCode).toBe(204);
  });

  it('records an audit entry when email content is saved (FR-032)', async () => {
    await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
      payload: { subject: 'Audited subject', content: tree('audited') },
    });
    const entries = await h.em().find(AuditLogEntry, {
      objectType: 'transactional_email',
      objectId: 'order_confirmation',
    });
    expect(entries.some((e) => e.action === 'transactional_email.content.saved')).toBe(true);
  });
});
