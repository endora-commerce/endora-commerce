/**
 * Pre-resolve InvoiceLogo images to data URIs before pdfmake runs.
 *
 * pdfmake fetches `image: <http url>` over the network. When the admin embeds a
 * library asset, `resolveData` bakes an absolute API URL
 * (`http://localhost:3001/assets/file/<id>`). Fetching that URL from inside the
 * same Node process that is still serving the preview request deadlocks or
 * 403s (private assets), which surfaces as INTERNAL on Preview PDF.
 *
 * Loading bytes via the Assets Library storage adapter (or a short external
 * fetch for true remote URLs) and inlining `data:image/…;base64,…` avoids the
 * self-HTTP path. Unsupported formats (SVG, WebP, …) are omitted so the PDF
 * still renders.
 */

/**
 * `Uint8Array` rather than `Buffer` since `specs/110-instance-repository/`
 * T118c: the bytes arrive from `assetReadPort.openAssetBytes`, and
 * `@endora-commerce/contracts` cannot name the `Buffer` global (it is compiled
 * by `@endora-commerce/admin-kit` with `types: ["vite/client"]`). A `Buffer`
 * still satisfies it, which is why the external-fetch path below and this
 * file's own tests are unchanged.
 */
export type LoadedAssetImage = { bytes: Uint8Array; mimeType: string };

export type LoadAssetImage = (assetId: string) => Promise<LoadedAssetImage | null>;

const ASSET_FILE_RE = /\/assets\/file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** pdfmake reliably embeds JPEG/PNG; other types are skipped. */
const PDFMAKE_IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);

function normalizeMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  return m === 'image/jpg' ? 'image/jpeg' : m;
}

export function toImageDataUri(bytes: Uint8Array, mimeType: string): string | null {
  const mime = normalizeMime(mimeType);
  if (!PDFMAKE_IMAGE_MIME.has(mime)) return null;
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

export function extractAssetIdFromUrl(url: string): string | null {
  const m = ASSET_FILE_RE.exec(url);
  return m?.[1] ?? null;
}

async function fetchExternalImage(url: string, timeoutMs = 3_000): Promise<LoadedAssetImage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const mime = normalizeMime(res.headers.get('content-type') ?? 'image/png');
    if (!PDFMAKE_IMAGE_MIME.has(mime)) return null;
    const arr = new Uint8Array(await res.arrayBuffer());
    return { bytes: Buffer.from(arr), mimeType: mime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLogoSrc(
  props: Record<string, unknown>,
  loadAssetImage: LoadAssetImage | undefined,
): Promise<string> {
  const existing = typeof props['src'] === 'string' ? props['src'].trim() : '';
  if (/^data:image\/(png|jpe?g);base64,/i.test(existing)) return existing;

  const assetIdRaw = typeof props['assetId'] === 'string' ? props['assetId'].trim() : '';
  const fromSrc = existing ? extractAssetIdFromUrl(existing) : null;
  const assetId = assetIdRaw || fromSrc || '';

  if (assetId && loadAssetImage) {
    const loaded = await loadAssetImage(assetId);
    if (loaded) {
      const dataUri = toImageDataUri(loaded.bytes, loaded.mimeType);
      if (dataUri) return dataUri;
    }
    return '';
  }

  // Remote URL that is not our assets endpoint — safe to fetch (CDN / public HTTP).
  if (/^https?:\/\//i.test(existing) && !extractAssetIdFromUrl(existing)) {
    const loaded = await fetchExternalImage(existing);
    if (loaded) {
      const dataUri = toImageDataUri(loaded.bytes, loaded.mimeType);
      if (dataUri) return dataUri;
    }
    return '';
  }

  // Library URL without a loader (unit tests) — clear so pdfmake does not self-fetch.
  if (extractAssetIdFromUrl(existing)) return '';

  return existing;
}

interface PuckNode {
  type?: string;
  props?: Record<string, unknown>;
}

/**
 * Returns a shallow-cloned tree with InvoiceLogo `src` replaced by data URIs
 * (or cleared when the image cannot be embedded).
 */
export async function embedInvoiceLogoImages(
  tree: unknown,
  loadAssetImage?: LoadAssetImage,
): Promise<unknown> {
  if (!tree || typeof tree !== 'object') return tree;
  const root = tree as { content?: PuckNode[] };
  if (!Array.isArray(root.content)) return tree;

  const content = await Promise.all(
    root.content.map(async (node) => {
      if (node?.type !== 'invoices.InvoiceLogo' || !node.props) return node;
      const src = await resolveLogoSrc(node.props, loadAssetImage);
      return { ...node, props: { ...node.props, src } };
    }),
  );

  return { ...root, content };
}
