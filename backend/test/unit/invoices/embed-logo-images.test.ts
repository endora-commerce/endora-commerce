import { describe, expect, it, vi } from 'vitest';
import {
  embedInvoiceLogoImages,
  extractAssetIdFromUrl,
  toImageDataUri,
} from '../../../src/modules/invoices/pdf-components/embed-logo-images.js';
import { logoSection } from '../../../src/modules/invoices/pdf-components/sections.js';
import { InvoicePdfRenderer } from '../../../src/modules/invoices/services/invoice-pdf-renderer.js';
import { sampleInvoiceDetail } from '../../../src/modules/invoices/pdf-components/sample.js';

/** Minimal 1×1 PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5X2ZkAAAAASUVORK5CYII=',
  'base64',
);

describe('embedInvoiceLogoImages', () => {
  it('extracts asset id from absolute API URLs', () => {
    expect(
      extractAssetIdFromUrl('http://localhost:3001/assets/file/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    ).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('builds a jpeg/png data URI and rejects svg', () => {
    expect(toImageDataUri(PNG_1X1, 'image/png')).toMatch(/^data:image\/png;base64,/);
    expect(toImageDataUri(PNG_1X1, 'image/svg+xml')).toBeNull();
  });

  it('replaces library logo src with a data URI via loadAssetImage', async () => {
    const assetId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const loadAssetImage = vi.fn(async () => ({ bytes: PNG_1X1, mimeType: 'image/png' }));
    const tree = {
      content: [
        {
          type: 'InvoiceLogo',
          props: {
            imageSource: 'library',
            assetId,
            src: `http://localhost:3001/assets/file/${assetId}`,
            width: 140,
            maxHeight: 80,
          },
        },
      ],
    };
    const next = (await embedInvoiceLogoImages(tree, loadAssetImage)) as {
      content: Array<{ props: { src: string } }>;
    };
    expect(loadAssetImage).toHaveBeenCalledWith(assetId);
    expect(next.content[0]!.props.src).toMatch(/^data:image\/png;base64,/);
  });

  it('clears asset URLs when no loader is provided (no self-HTTP)', async () => {
    const tree = {
      content: [
        {
          type: 'InvoiceLogo',
          props: {
            src: 'http://localhost:3001/assets/file/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          },
        },
      ],
    };
    const next = (await embedInvoiceLogoImages(tree)) as {
      content: Array<{ props: { src: string } }>;
    };
    expect(next.content[0]!.props.src).toBe('');
  });
});

describe('logoSection + InvoicePdfRenderer with embedded logo', () => {
  it('accepts data URI images', () => {
    const dataUri = toImageDataUri(PNG_1X1, 'image/png')!;
    const content = logoSection({ src: dataUri, width: 100, maxHeight: 40 });
    expect(content).toMatchObject({ image: dataUri });
  });

  it('renders a PDF when the template logo is an inlined data URI', async () => {
    const dataUri = toImageDataUri(PNG_1X1, 'image/png')!;
    const tree = {
      content: [
        { type: 'InvoiceLogo', props: { src: dataUri, width: 80, maxHeight: 40 } },
        { type: 'InvoiceHeader', props: {} },
      ],
    };
    const buf = await new InvoicePdfRenderer().render(sampleInvoiceDetail(), 'en', tree);
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('renders a PDF when logo bytes come from loadAssetImage', async () => {
    const assetId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const renderer = new InvoicePdfRenderer({
      loadAssetImage: async () => ({ bytes: PNG_1X1, mimeType: 'image/png' }),
    });
    const tree = {
      content: [
        {
          type: 'InvoiceLogo',
          props: {
            imageSource: 'library',
            assetId,
            src: `http://localhost:3001/assets/file/${assetId}`,
          },
        },
        { type: 'InvoiceHeader', props: {} },
      ],
    };
    const buf = await renderer.render(sampleInvoiceDetail(), 'en', tree);
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
