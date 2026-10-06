import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * What an Opportunity attachment may **not** be: a document a browser renders
 * and runs (`specs/143-crm-sales-opportunities/research.md` N-R1).
 *
 * The media library serves a private file from the API's own origin, under the
 * type it was stored with. An HTML page, an SVG or an XML document with a
 * stylesheet opened from there is script running with the reader's session —
 * and the CRM upload is open to anybody holding `crm:write`. So both what the
 * request declares and what the file is called decide, and either is enough to
 * refuse: a name a browser or an operating system would act on is refused
 * whatever type was declared for it, and the other way round.
 */
const ACTIVE_EXTENSIONS = new Set([
  'html',
  'htm',
  'xhtml',
  'xht',
  'shtml',
  'mht',
  'mhtml',
  'hta',
  'svg',
  'svgz',
  'xml',
  'xsl',
  'xslt',
  'js',
  'mjs',
  'cjs',
]);

const ACTIVE_MIME_TYPES = new Set(['text/html', 'text/xml', 'application/xml', 'text/xsl']);

function extensionOf(filename: string): string {
  // What follows the last dot, with the trailing dots and spaces a file system
  // drops taken off first: `offer.html.` is `offer.html` once it is saved.
  const name = filename.trim().replace(/[.\s]+$/u, '');
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** `Text/HTML; charset=utf-8` → `text/html`. */
function essenceOf(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

export function isActiveContent(file: { filename: string; mimeType: string }): boolean {
  if (ACTIVE_EXTENSIONS.has(extensionOf(file.filename))) return true;
  const mime = essenceOf(file.mimeType);
  return (
    ACTIVE_MIME_TYPES.has(mime) ||
    mime.endsWith('+xml') ||
    mime.includes('javascript') ||
    mime.includes('ecmascript')
  );
}

/**
 * 415 with the media library's own code for "this type is not accepted": the
 * same refusal a caller of this upload already meets when the library's policy
 * says no, so a screen handles one code for both.
 */
export function refuseActiveContent(file: { filename: string; mimeType: string }): void {
  if (!isActiveContent(file)) return;
  throw new HttpError(
    415,
    ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED,
    'A file a browser would render and run (HTML, SVG, XML, JavaScript) cannot be an attachment.',
  );
}

/**
 * The link as a **download**. The library's own file route answers
 * `Content-Disposition: attachment` when asked with `download=1`, and `inline`
 * otherwise; an attachment is never something to render on the API's origin.
 * A link that is not that route's — a store's own signed address, whose
 * signature covers its query — is handed on untouched.
 */
export function asDownloadLink(url: string, assetId: string): string {
  const [beforeFragment = ''] = url.split('#');
  const [path = '', query] = beforeFragment.split('?');
  if (!path.endsWith(`/assets/file/${assetId}`)) return url;
  if (query !== undefined && new URLSearchParams(query).has('download')) return url;
  return `${beforeFragment}${query === undefined ? '?' : '&'}download=1`;
}
