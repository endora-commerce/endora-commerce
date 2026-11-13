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
 * **Absent is `null`, and a consumer omits the link.** The admin's address is
 * optional — an instance with no admin, or one whose operator never answered,
 * still runs — and a link built on a guess (`http://localhost:3002`) opens
 * nothing from an e-mail client. A mail with no link still says what to open;
 * a mail with a broken one sends the reader somewhere that is not their
 * installation.
 *
 * **Set but malformed refuses the boot, in every environment** (architect
 * ruling on #1078). A scheme-less value (`admin.example.com`) is an operator
 * who meant an address and wrote it wrong; booting on it would leave every
 * admin link silently missing. `composeApp()` calls
 * {@link assertAdminBaseUrlWellFormed} beside the public-origin refusal, before
 * anything is opened, so the operator reads the rule instead of an e-mail with
 * no link.
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
 * it is unset or blank. A malformed value is also `null` here, though a process
 * holding one never boots ({@link assertAdminBaseUrlWellFormed}).
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

const RULE =
  'an absolute http(s) URL with a host, and no query or fragment — for example ' +
  'https://admin.example.com or https://shop.example.com/admin';

/** Refusal to boot on an `ADMIN_BASE_URL` that is set but not well formed. */
export class AdminBaseUrlMalformedError extends Error {
  constructor(value: string) {
    super(
      `${VARIABLE}=${JSON.stringify(value)} is not ${RULE}. It is the address every link ` +
        'into the admin panel is built on, so a malformed value would leave those links ' +
        `broken or missing. Set ${VARIABLE} to the address the admin panel is served at, ` +
        'or unset it: without it, e-mails to administrators carry no link into the panel.',
    );
    this.name = 'AdminBaseUrlMalformedError';
  }
}

/**
 * Refuse a process whose `ADMIN_BASE_URL` is set but malformed. Unset or blank
 * passes: the input is optional. Host-internal — called at the top of
 * `composeApp()`, and not on the `./kernel` barrel.
 */
export function assertAdminBaseUrlWellFormed(
  raw: string | undefined = process.env['ADMIN_BASE_URL'],
): void {
  const trimmed = raw?.trim() ?? '';
  if (trimmed !== '' && configuredAdminBaseUrl(trimmed) === null) {
    throw new AdminBaseUrlMalformedError(trimmed);
  }
}
