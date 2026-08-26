import { isForbiddenAddress } from '../taxonomy-source-url.js';

/**
 * Egress guard for an HTTP delivery target — feature 070 / SR-2, SR-4.
 *
 * This feature deliberately does what FR-091 forbids elsewhere: it sends
 * credentials to an operator-nominated host. The address rules therefore have to
 * be stated here rather than inherited, and they are the same rules the taxonomy
 * fetcher applies — `classifyAddress` / `isForbiddenAddress` are imported from
 * `taxonomy-source-url.ts` rather than copied, because two SSRF guards in one
 * module is one guard that will be fixed and one that will not. (Principle I
 * governs imports *between* modules; within one, sharing the rule is the point.)
 *
 * Pure and I/O-free, exactly like the file it borrows from: a URL string goes
 * in, a verdict comes out. DNS resolution belongs to the caller, which is what
 * lets every rule below be exercised without a network or a fixture host.
 *
 * What differs from the taxonomy guard, and why:
 *
 *  - **A path and a query are allowed.** A partner's ingest endpoint is
 *    `https://partner.example/v2/feeds?shop=42`; the taxonomy guard's targets
 *    are bare files.
 *  - **Userinfo is still refused.** A password in the URL would be stored in a
 *    plain column and echoed in every attempt record, which is precisely what
 *    FR-107 and FR-108 exist to prevent — the operator's password belongs in the
 *    credential.
 */

export type DeliveryTargetRefusal =
  | 'malformed'
  | 'scheme'
  | 'credentials'
  | 'fragment'
  | 'host'
  | 'address';

export type DeliveryTargetVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: DeliveryTargetRefusal; detail: string };

/**
 * Scheme / userinfo / fragment / host shape. Applied at write time so the
 * operator is refused while they are still editing the field, and again
 * immediately before every request — including after a redirect — because a
 * configuration can also be written by a seed, a migration or an overlay.
 */
export function validateDeliveryTargetUrl(raw: string): DeliveryTargetVerdict {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'malformed', detail: 'The address could not be parsed.' };
  }

  // SR-4 — `http://` is refused outright. FTP is plaintext by nature and that is
  // the operator's informed choice; an HTTP target that could be downgraded
  // silently is a different matter, because the credential headers ride on it.
  if (url.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'scheme',
      detail: `The address must start with https://, not "${url.protocol}//".`,
    };
  }
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason: 'credentials',
      detail:
        'The address carries a username or password. Put credentials in an authenticating header instead — they are stored encrypted there.',
    };
  }
  if (url.hash !== '') {
    return { ok: false, reason: 'fragment', detail: 'The address carries a fragment.' };
  }
  if (url.hostname.trim() === '') {
    return { ok: false, reason: 'host', detail: 'The address carries no host.' };
  }

  // A literal address in the URL is checked here too, so the obvious attempt —
  // `https://169.254.169.254/latest/meta-data/` — is refused at write time with
  // a sentence rather than at send time as a failed delivery.
  const literal = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (looksLikeIpAddress(literal) && isForbiddenAddress(literal)) {
    return {
      ok: false,
      reason: 'address',
      detail: `${literal} is not a public address, so this platform will not send a feed to it.`,
    };
  }

  return { ok: true, url };
}

/** True for an IPv4 dotted quad or anything containing a colon (IPv6). */
function looksLikeIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Verdict for a set of resolved addresses. **Every** address must be public, not
 * the first: a split-horizon name that answers with one public and one private
 * address is the interesting case.
 */
export function refuseForbiddenAddresses(
  hostname: string,
  addresses: string[],
): { ok: true } | { ok: false; detail: string } {
  if (addresses.length === 0) {
    return { ok: false, detail: `The host "${hostname}" resolved to no address.` };
  }
  const forbidden = addresses.find((address) => isForbiddenAddress(address));
  if (forbidden !== undefined) {
    return {
      ok: false,
      detail: `The host "${hostname}" resolves to ${forbidden}, which is not a public address.`,
    };
  }
  return { ok: true };
}
