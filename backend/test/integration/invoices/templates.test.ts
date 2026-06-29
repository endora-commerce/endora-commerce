import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InvoiceTemplateService } from '../../../src/modules/invoices/services/invoice-template-service.js';
import { ADMIN_COOKIE } from './helpers.js';

const CH = '99999999-0000-4000-8000-000000000001';

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  salesChannelId: string | null;
  active: boolean;
  isSystem: boolean;
  version: number;
}

describe('invoices — templates (US6)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('seeds and lists the system generic template', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/invoice-templates', cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: TemplateRow[] };
    expect(body.data.some((t) => t.isSystem && t.code === 'generic')).toBe(true);
  });

  it('exposes the page-builder component descriptor', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoice-templates/page-builder/config',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { components: Array<{ name: string }> } };
    expect(body.data.components.some((c) => c.name === 'InvoiceLineItems')).toBe(true);
  });

  it('creates a per-channel template, saves content with optimistic version, and previews', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/invoice-templates',
      cookies: ADMIN_COOKIE,
      payload: { code: 'channel-x', name: 'Channel X', salesChannelId: CH },
    });
    expect(created.statusCode).toBe(201);
    const tpl = (created.json() as { data: TemplateRow }).data;
    expect(tpl.salesChannelId).toBe(CH);

    const save = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/invoice-templates/${tpl.id}/content/pl-PL`,
      cookies: ADMIN_COOKIE,
      payload: {
        version: tpl.version,
        data: { content: [{ type: 'InvoiceHeader', props: {} }, { type: 'InvoiceTotals', props: {} }] },
      },
    });
    expect(save.statusCode).toBe(200);
    expect((save.json() as { data: TemplateRow }).data.version).toBe(tpl.version + 1);

    // stale version → 409
    const stale = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/invoice-templates/${tpl.id}/content/pl-PL`,
      cookies: ADMIN_COOKIE,
      payload: { version: tpl.version, data: { content: [] } },
    });
    expect(stale.statusCode).toBe(409);

    const preview = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoice-templates/${tpl.id}/preview`,
      cookies: ADMIN_COOKIE,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('application/pdf');
    expect(preview.rawPayload.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('resolves per-channel template over the global generic; unknown channel falls back', async () => {
    const svc = new InvoiceTemplateService(h.em);
    const channelTree = (await svc.resolveTree(CH, 'pl-PL')) as { content: Array<{ type: string }> };
    // The channel template was saved with header + totals only.
    expect(channelTree.content.map((c) => c.type)).toEqual(['InvoiceHeader', 'InvoiceTotals']);

    const otherTree = (await svc.resolveTree('00000000-0000-4000-8000-0000000000ff', 'pl-PL')) as {
      content: Array<{ type: string }>;
    };
    // Falls back to the generic (global) template — full section set.
    expect(otherTree.content.length).toBeGreaterThanOrEqual(5);
  });
});
