/**
 * The Admin UI's base address — one owner, one reader (issue #185).
 *
 * `ADMIN_BASE_URL` was `mfa`'s environment input, because `mfa` was the only
 * thing that composed a link into the admin. Its ledger entry said that the day
 * a second module needed the admin's address the input would move here rather
 * than be declared again, and CRM's event reminder, Tasks' digest and reminder,
 * and the RFQ operator notifications are that second module: each mails an
 * administrator and none could say where their admin is. So the platform
 * declares the input (`env/index.ts`) and this is the one accessor every
 * module reads it through, on the `./kernel` barrel beside
 * `configuredPublicApiBaseUrl`.
 *
 * **Absent or malformed is `null`, and a consumer omits the link.** The admin's
 * address is optional — an instance with no admin, or one whose operator never
 * answered, still runs — and a link built on a guess (`http://localhost:3002`)
 * or on a scheme-less value (`admin.example.com`) opens nothing from an e-mail
 * client. A mail with no link still says what to open; a mail with a broken one
 * sends the reader somewhere that is not their installation. A malformed value
 * is not a refusal to boot: the composition root logs
 * {@link adminBaseUrlProblem} once, and everything else carries on.
 *
 * **What is well formed:** an absolute `http:` or `https:` URL with no query
 * and no fragment, because every consumer appends a path to it. A base path is
 * kept (`https://shop.example.com/admin`) — an admin built for one is addressed
 * with it — and trailing slashes are stripped, so `${base}/tasks/mine` is the
 * whole of a consumer's join.
 */

const VARIABLE = 'ADMIN_BASE_URL';

function wellFormed(trimmed: string): boolean {
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.hostname === '') return false;
  return url.search === '' && url.hash === '' && !trimmed.includes('?') && !trimmed.includes('#');
}

/**
 * The configured Admin UI base address without trailing slashes, or `null` when
 * it is unset, blank or not an absolute http(s) URL.
 *
 * The parameter exists for tests; production callers pass nothing and the
 * variable is read here, which is the read `check:env-inputs` reconciles the
 * platform's declaration against.
 */
export function configuredAdminBaseUrl(
  raw: string | undefined = process.env['ADMIN_BASE_URL'],
): string | null {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '' || !wellFormed(trimmed)) return null;
  return trimmed.replace(/\/+$/, '');
}

/**
 * The sentence the composition root logs when `ADMIN_BASE_URL` is set but
 * ignored as malformed, or `null` when there is nothing to say. Host-internal:
 * not on the `./kernel` barrel.
 */
export function adminBaseUrlProblem(
  raw: string | undefined = process.env['ADMIN_BASE_URL'],
): string | null {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '' || configuredAdminBaseUrl(trimmed) !== null) return null;
  return (
    `${VARIABLE}=${JSON.stringify(trimmed)} is not an absolute http(s) URL without a query or ` +
    'fragment, so it is ignored: links into the admin panel are left out of every e-mail and ' +
    `two-step sign-in falls back to its development address. Set ${VARIABLE} to the address ` +
    'the admin panel is served at, for example https://admin.example.com.'
  );
}
