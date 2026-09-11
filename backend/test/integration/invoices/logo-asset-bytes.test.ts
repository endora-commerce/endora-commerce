import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
/**
 * The invoice logo, from the Assets Library into the PDF — and the first test
 * this platform has had for the wiring (D-223's survey).
 *
 * `loadAssetImage` is how an operator's logo asset becomes the bytes pdfmake
 * embeds. It was an **optional** `invoicesBridge` member and
 * `backend/test/helpers/test-server.ts` did not supply it at all: the omission
 * compiled, `InvoicePdfRenderer` took its "no logo bytes" branch in every test
 * in this suite, and the closure `composition.ts` supplies ran nowhere. The
 * module's own `embed-logo-images.test.ts` covers the *mapping* over a stubbed
 * loader; what had no coverage was whether a composition supplies one.
 *
 * **T118c retired the bridge**, so this now drives what the module resolved for
 * itself — `assetReadPort.findById` for the kind and `openAssetBytes` for the
 * bytes — over an asset uploaded through the real pipeline. The mapping's own
 * half is `packages/modules/invoices/src/backend/services/cross-module-context.test.ts`
 * and the storage half is `assets_library`' `asset-read-port.test.ts`. The other half — an `invoices.InvoiceLogo` node becoming an inline
 * `data:` URI — stays co-located in the module
 * (`pdf-components/embed-logo-images.test.ts`), where it belongs and where it
 * already was; `embedInvoiceLogoImages` is not on the package's `./backend`
 * surface and widening that surface to assert it here would be the wrong repair.
 *
 * A 1×1 PNG, the same fixture `embed-logo-images.test.ts` uses: pdfmake embeds
 * PNG and JPEG and nothing else, so the format is part of the case rather than
 * decoration.
 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('invoices — the logo asset reaches the PDF (D-223)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function uploadLogo(): Promise<string> {
    const detail = await h.assetsLibrary.service.upload({
      filename: 'logo.png',
      declaredMime: 'image/png',
      stream: Readable.from([TINY_PNG]),
      declaredSize: TINY_PNG.length,
      folderId: null,
      label: 'Invoice logo',
      visibility: 'public',
    });
    return detail.id;
  }

  it('composes loadAssetImage and streams the stored bytes back', async () => {
    const assetId = await uploadLogo();
    const loaded = await h.invoices.loadAssetImage(assetId);

    expect(loaded).not.toBeNull();
    expect(loaded?.mimeType).toBe('image/png');
    // `Uint8Array` since T118c — `assetReadPort.openAssetBytes` answers the
    // shape `@endora-commerce/contracts` can name, and `Buffer.equals` is not
    // on it. The regression this case opened with (`toBeDefined()`) is `tsc`'s
    // now: the option is required and the member is not optional anywhere.
    expect(loaded && Buffer.from(loaded.bytes).equals(TINY_PNG)).toBe(true);
  });

  it('answers null for an asset that is not an image', async () => {
    const detail = await h.assetsLibrary.service.upload({
      filename: 'terms.txt',
      declaredMime: 'text/plain',
      stream: Readable.from([Buffer.from('not an image', 'utf8')]),
      declaredSize: 12,
      folderId: null,
      label: null,
      visibility: 'public',
    });

    await expect(h.invoices.loadAssetImage(detail.id)).resolves.toBeNull();
  });
});
