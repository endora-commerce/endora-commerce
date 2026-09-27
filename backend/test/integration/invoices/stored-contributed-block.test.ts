import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvoiceDetail } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { sampleInvoiceDetail } from '../../../../packages/modules/invoices/src/backend/pdf-components/sample.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * A stored invoice template that places a block whose declaring module is
 * absent — `specs/134-paid-module-extraction/` T063, the no-migration half of
 * ruling E4 (`spec.md` §11.3.1).
 *
 * Every instance seeded before T063 holds a generic template with a
 * `ksef.InvoiceSection` node. The ruling writes no migration for it, on the
 * ground that feature 096's FR-019/FR-020 already cover a stored block nothing
 * declares, and that `treeToContent` already skips an unknown block without
 * falling back to the built-in layout. This file asserts that ground over the
 * real composition and database instead of reading it:
 *
 *  - the template's other blocks render and the KSeF node is skipped — no
 *    throw, no fallback, no KSeF text on the document;
 *  - its stored props survive a save-and-reload through the admin API
 *    unchanged, which is what the editor does with a node it cannot render;
 *  - the builder descriptor stops describing the block.
 *
 * **Absent by construction.** While `ksef` was composed in this repository the
 * file took it off on the platform axis, which is the axis a deployment that
 * does not offer the module is on. The module has since left (T069), so it is
 * absent here by construction and the same assertions run as they stand. Nothing here imports the module. The database is the run's own
 * clone (`test/global-setup.ts`), never the development database.
 */

const KSEF_NODE_PROPS = {
  id: 'inv-ksef',
  fontSize: 8,
  color: '#0f172a',
  showProcessedAt: true,
  hideWhenEmpty: true,
  labelNumber: 'KSeF number',
  labelProcessedAt: 'KSeF processed at',
  marginTop: 8,
  marginBottom: 0,
};

/** The generic template's block order as seeded before T063: eight own blocks and the KSeF node. */
const PRE_T063_TREE = {
  root: { props: {} },
  content: [
    { type: 'invoices.InvoiceLogo', props: { id: 'inv-logo', imageSource: 'url' } },
    { type: 'invoices.InvoiceHeader', props: { id: 'inv-header' } },
    { type: 'invoices.InvoiceSpacer', props: { id: 'inv-spacer', height: 8 } },
    { type: 'invoices.InvoiceParties', props: { id: 'inv-parties' } },
    { type: 'invoices.InvoiceLineItems', props: { id: 'inv-lines' } },
    { type: 'invoices.InvoiceVatSummary', props: { id: 'inv-vat' } },
    { type: 'invoices.InvoiceTotals', props: { id: 'inv-totals' } },
    { type: 'ksef.InvoiceSection', props: KSEF_NODE_PROPS },
    { type: 'invoices.InvoiceFooter', props: { id: 'inv-footer' } },
  ],
  zones: {},
};

interface TemplateRow {
  id: string;
  version: number;
  content: { languages?: Record<string, { content: Array<{ type: string; props: unknown }> }> };
}

interface RendererSurface {
  content(invoice: InvoiceDetail, locale: 'pl' | 'en', tree?: unknown): Promise<unknown[]>;
}

/**
 * The declaring module is absent by construction: it left this repository
 * (feature 134, T069), so no composition here registers it. Until then this
 * helper switched it off on the platform axis; the premise it relied on is now
 * the tree's own, and is asserted rather than assumed so that a composition
 * that registered the id again would fail here instead of passing vacuously.
 */
async function withKsefAbsent<T>(body: () => Promise<T>): Promise<T> {
  expect(registryCache.enabledIds().includes('ksef')).toBe(false);
  return body();
}

describe('invoices — a stored block whose declarant is absent (134 T063)', () => {
  let h: BackendServerHandle;

  let CH: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'stored-contributed-block');
    await setSellerSettings(h);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function readTemplate(id: string): Promise<TemplateRow> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoice-templates/${id}`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: TemplateRow }).data;
  }

  it('renders the other blocks, skips the node, and keeps its props through a save', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/invoice-templates',
      cookies: ADMIN_COOKIE,
      payload: { code: `pre-t063-${Date.now()}`, name: 'Seeded before T063' },
    });
    expect(created.statusCode).toBe(201);
    const { id, version } = (created.json() as { data: TemplateRow }).data;
    const stored = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/invoice-templates/${id}/content/pl-PL`,
      cookies: ADMIN_COOKIE,
      payload: { version, data: PRE_T063_TREE },
    });
    expect(stored.statusCode).toBe(200);

    await withKsefAbsent(async () => {
      // The document renders — through the route an operator uses — and does
      // not throw on the node.
      const preview = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/invoice-templates/${id}/preview`,
        cookies: ADMIN_COOKIE,
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.rawPayload.subarray(0, 5).toString('utf8')).toBe('%PDF-');

      // Eight blocks render and the ninth is skipped: not the built-in layout
      // (FR-016), which has no footer, and no KSeF section — no verification
      // caption. The number itself is printed once, by the header (T137).
      const renderer = h.container.resolve<RendererSurface>('invoicePdfRenderer');
      const content = await renderer.content(
        { ...sampleInvoiceDetail(), ksefReferenceNumber: '1234567890-20260722-ABC123-01' },
        'pl',
        PRE_T063_TREE,
      );
      expect(content).toHaveLength(8);
      const json = JSON.stringify(content);
      expect(json).not.toContain('Zweryfikuj');
      expect(json.split('Numer w KSeF: 1234567890-20260722-ABC123-01').length - 1).toBe(1);

      // Save-and-reload, as the editor does: the node and its props survive.
      const before = await readTemplate(id);
      const saved = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/invoice-templates/${id}/content/pl-PL`,
        cookies: ADMIN_COOKIE,
        payload: { version: before.version, data: before.content.languages!['pl-PL'] },
      });
      expect(saved.statusCode).toBe(200);
      const after = await readTemplate(id);
      const node = after.content.languages!['pl-PL']!.content.find(
        (n) => n.type === 'ksef.InvoiceSection',
      );
      expect(node?.props).toEqual(KSEF_NODE_PROPS);

      // And the builder descriptor no longer offers what nothing renders.
      const descriptor = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/invoice-templates/page-builder/config',
        cookies: ADMIN_COOKIE,
      });
      const names = (descriptor.json() as { data: { components: Array<{ name: string }> } }).data.components.map(
        (c) => c.name,
      );
      expect(names).toHaveLength(10);
      expect(names).not.toContain('ksef.InvoiceSection');
    });
  });

  it('prints a KSeF number an accounting vendor recorded, with the KSeF module absent (T137)', async () => {
    // `specs/119-infakt-integration/` FR-025: a vendor's KSeF success lands
    // through the same assignment seam as the native path, "so admin and PDF
    // show the KSeF number". Before T137 the only renderer of the number was the
    // KSeF module's own block, so an operator who delegates KSeF lost it.
    await withKsefAbsent(async () => {
      const { orderId } = await withSystemScope('seed', () =>
        seedInvoiceableOrder(h.em(), { salesChannelId: CH }),
      );
      const issued = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderId}/invoices`,
        payload: { kind: 'invoice' },
        cookies: ADMIN_COOKIE,
      });
      expect(issued.statusCode, issued.body).toBe(201);
      const invoiceId = (issued.json() as { data: { id: string } }).data.id;

      const number = `1234567890-20260726-VENDOR${Date.now() % 100000}-01`;
      await withSystemScope('vendor assignment', () =>
        h.container
          .resolve<{
            recordKsefAssignment(id: string, a: { ksefReferenceNumber: string; ksefProcessedAt: Date }): Promise<void>;
          }>('invoiceKsefAssignmentPort')
          .recordKsefAssignment(invoiceId, { ksefReferenceNumber: number, ksefProcessedAt: new Date() }),
      );

      const detail = await withSystemScope('read', () =>
        h.container
          .resolve<{ buildDetail(id: string): Promise<InvoiceDetail> }>('invoiceService')
          .buildDetail(invoiceId),
      );
      expect(detail.ksefReferenceNumber).toBe(number);

      const renderer = h.container.resolve<RendererSurface>('invoicePdfRenderer');
      for (const tree of [PRE_T063_TREE, undefined]) {
        const json = JSON.stringify(await renderer.content(detail, 'pl', tree));
        expect(json.split(`Numer w KSeF: ${number}`).length - 1).toBe(1);
      }
    });
  });
});
