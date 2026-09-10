/**
 * The base every public asset URL this module produces is built on — D-223.
 *
 * **`assets_library` resolves the public API origin itself and every URL it
 * produces is absolute.** One question used to have five answers in this tree:
 * `absolutizePublicUrl` at two composition-root sites reading
 * `BACKEND_PUBLIC_URL` first, `configuredPublicApiBaseUrl` plus a hand-written
 * join at a third reading `PUBLIC_API_BASE_URL` first and silently skipping
 * signed URLs, nothing at all at a fourth, and a helper in each of the two
 * frontends. Every one of them existed to compensate for a setting documented
 * as *"leave blank to use the request host"* — correct only for a browser on
 * the API host, and wrong for an e-mail, a push payload, a partner's feed
 * reader and a storefront on another origin. The module that builds the URL is
 * the only party that knows which adapter produced it and whether it is signed,
 * so it is the one that decides.
 *
 * **The fallback lives in the adapter's construction and not in the setting's
 * default** (D-223, rejected alternative three): a setting default cannot read
 * the environment at manifest-declaration time, and an operator who set the
 * value explicitly must keep winning.
 */

/** A URL that already names its own origin — a scheme, or protocol-relative. */
function namesItsOwnOrigin(url: string): boolean {
  return url.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(url);
}

/** Drop the trailing slashes every caller here concatenates a path onto. */
function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Make one asset URL absolute against `apiOrigin`.
 *
 * Everything after the path travels untouched, which is the property the signed
 * local-FS form depends on: `?token=…&exp=…` is validated over the asset id and
 * the expiry, so a rebase that rewrote the query would produce a 403 rather
 * than an image. An empty origin returns the URL unchanged — there is nothing
 * to build on, and a wrong-but-plausible origin is worse than a relative URL.
 */
export function absolutizeAssetUrl(url: string, apiOrigin: string): string {
  if (url === '' || namesItsOwnOrigin(url)) return url;
  const origin = withoutTrailingSlash(apiOrigin.trim());
  if (origin === '') return url;
  return url.startsWith('/') ? `${origin}${url}` : `${origin}/${url}`;
}

/**
 * The public URL base an adapter serves from, in the one precedence order every
 * adapter in this module uses:
 *
 *  1. the operator's configured base, when it names its own origin — it wins,
 *     always, which is D-223's third rejected alternative stated as code;
 *  2. the operator's configured base, when it is a path — rebased onto the
 *     resolved API origin, so a configured value cannot make the result
 *     relative either;
 *  3. blank — the caller's own default, which for the cloud adapters is the
 *     bucket's absolute origin and for local-FS is the API origin itself.
 *
 * A blank `assets.s3.public_base_url` therefore keeps resolving to the bucket
 * rather than to this API: substituting the API origin there would point every
 * image at a host that does not serve the bytes. D-223's invariant is that the
 * URL is absolute, and the cloud adapters' own defaults already are.
 */
export function resolvePublicUrlBase(
  configured: string | undefined,
  apiOrigin: string,
): string {
  const trimmed = (configured ?? '').trim();
  if (trimmed === '') return withoutTrailingSlash(apiOrigin.trim());
  return withoutTrailingSlash(absolutizeAssetUrl(trimmed, apiOrigin));
}
