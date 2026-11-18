/**
 * Pages whose address carries a bearer credential (`specs/181-guest-complaints/` design review
 * F-2): the guest's tracking page, `/returns/track/<token>`, which reads a case's personal
 * data and writes to it, and the verification page, `/returns/guest/verify?token=…`.
 *
 * Neither address may reach a third party. The root layout renders no analytics script on
 * such a document, and a client-side navigation into one — where the scripts are already
 * loaded — reports the redacted path (`PageViewTracker`, `sendPageView`). FR-040's
 * `Referrer-Policy: no-referrer` alone does not stop a tag from reading `location`.
 *
 * Pure, so the server layout and the client tracker share one answer. A path may carry the
 * channel's language prefix: one leading segment is allowed before `/returns`.
 */
const TRACK = /^((?:\/[^/?#]+)?\/returns\/track)\/[^?#]*/;
const VERIFY = /^((?:\/[^/?#]+)?\/returns\/guest\/verify)(?=$|[/?#])/;

/** Whether `path` (path, optional query) is the tracking or the verification page. */
export function isSecretBearingPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return TRACK.test(path) || VERIFY.test(path);
}

/** `path` with the token replaced by `[token]` and the query dropped; any other path unchanged. */
export function redactSecretPath(path: string): string {
  const track = TRACK.exec(path);
  if (track) return `${track[1]}/[token]`;
  const verify = VERIFY.exec(path);
  if (verify) return verify[1]!;
  return path;
}
