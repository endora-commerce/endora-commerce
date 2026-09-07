import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InvoiceTemplateService } from '../../../../packages/modules/invoices/src/backend/services/invoice-template-service.js';
import { ADMIN_COOKIE } from './helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

// Feature 078, D-95: `{channel}` is rendered from the `sales_channels`

// row, so this file's channel has to be one. The per-file code keeps this

// file's numbers distinct in the shared test database, which is what the

// fabricated id used to be for.

let CH: string;

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
    CH = await ensureSalesChannelId(h.em(), 'inv-templates');
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
    expect(body.data.components.some((c) => c.name === 'invoices.InvoiceLineItems')).toBe(true);
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
        data: { content: [{ type: 'invoices.InvoiceHeader', props: {} }, { type: 'invoices.InvoiceTotals', props: {} }] },
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

    const draftPreview = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoice-templates/${tpl.id}/preview`,
      cookies: ADMIN_COOKIE,
      payload: {
        data: {
          content: [
            { type: 'invoices.InvoiceHeader', props: { showSaleDate: false } },
            { type: 'invoices.InvoiceNotes', props: { text: 'Draft {{var invoice.number}}' } },
          ],
        },
      },
    });
    expect(draftPreview.statusCode).toBe(200);
    expect(draftPreview.headers['content-type']).toContain('application/pdf');
    expect(draftPreview.rawPayload.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('resolves per-channel template over the global generic; unknown channel falls back', async () => {
    const svc = new InvoiceTemplateService(h.em);
    const channelTree = (await svc.resolveTree(CH, 'pl-PL')) as { content: Array<{ type: string }> };
    // The channel template was saved with header + totals only.
    expect(channelTree.content.map((c) => c.type)).toEqual(['invoices.InvoiceHeader', 'invoices.InvoiceTotals']);

    const otherTree = (await svc.resolveTree('00000000-0000-4000-8000-0000000000ff', 'pl-PL')) as {
      content: Array<{ type: string }>;
    };
    // Falls back to the generic (global) template — full section set.
    expect(otherTree.content.length).toBeGreaterThanOrEqual(5);
  });
});
