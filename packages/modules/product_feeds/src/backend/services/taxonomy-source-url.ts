/**
 * Egress URL guard — feature 067 / FR-091, research §R23.
 *
 * Pure and I/O-free: a URL string and an IP address string go in, a verdict
 * comes out. DNS resolution belongs to the caller (`taxonomy-source-fetcher.ts`
 * injects it), which is what lets every rule below be exercised without a
 * network, a resolver or a fixture host.
 *
 * These are **safety limits, not operator policy** (FR-091): they are constants
 * and there is deliberately no setting that widens them. An admin screen that
 * could relax an SSRF guard is an SSRF guard with an off switch.
 */

export type TaxonomySourceUrlRefusal =
  | 'malformed'
  | 'scheme'
  | 'credentials'
  | 'fragment'
  | 'host';

export type TaxonomySourceUrlVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: TaxonomySourceUrlRefusal; detail: string };

/**
 * Scheme / userinfo / fragment / host shape. Applied at settings-write time by
 * `feedTaxonomySourceUrlSchema` **and** again here immediately before every
 * request — including after every redirect — because settings can also be
 * written by a seed, a migration or an overlay, so the request-time check is
 * the one that actually holds.
 */
export function validateTaxonomySourceUrl(raw: string): TaxonomySourceUrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed', detail: 'The address could not be parsed.' };
  }

  // `https` only, before and after every redirect. Permitting `http` for
  // "internal" hosts would make the address check argue with itself: an
  // internal mirror behind TLS or a reverse proxy is the supported shape.
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme', detail: `Scheme "${url.protocol}" is not https.` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials', detail: 'The address carries credentials.' };
  }
  if (url.hash !== '') {
    return { ok: false, reason: 'fragment', detail: 'The address carries a fragment.' };
  }
  if (url.hostname.trim() === '') {
    return { ok: false, reason: 'host', detail: 'The address carries no host.' };
  }
  return { ok: true, url };
}

export type AddressClass =
  | 'public'
  | 'loopback'
  | 'link_local'
  | 'private'
  | 'cgnat'
  | 'unspecified'
  | 'unknown';

/** Strips an IPv6 zone id and the brackets a URL hostname may carry. */
function normaliseAddress(address: string): string {
  return address.trim().replace(/^\[/, '').replace(/\]$/, '').split('%')[0] ?? '';
}

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * The ranges that make SSRF worth attempting: the cloud metadata endpoint
 * (`169.254.169.254`), loopback, the RFC 1918 estate and carrier-grade NAT.
 *
 * IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is unwrapped first — it is the standard
 * way a naive check is walked around.
 */
export function classifyAddress(rawAddress: string): AddressClass {
  const address = normaliseAddress(rawAddress);
  if (address === '') return 'unknown';

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return classifyAddress(mapped[1]);

  // The same mapping in its **hex** form. `new URL()` normalises
  // `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, so a guard that knows
  // only the dotted form above accepts the metadata endpoint the moment the
  // address arrives through a URL rather than from a resolver.
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (mappedHex?.[1] && mappedHex[2]) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return classifyAddress(
      `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`,
    );
  }

  const octets = ipv4Octets(address);
  if (octets) {
    const [a = 0, b = 0] = octets;
    if (a === 0) return 'unspecified';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link_local';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
    return 'public';
  }

  if (!address.includes(':')) return 'unknown';
  const lower = address.toLowerCase();
  if (lower === '::' ) return 'unspecified';
  if (lower === '::1') return 'loopback';
  // fe80::/10 — the first hextet is fe80–febf.
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return 'link_local';
  // fc00::/7 — unique local addresses.
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return 'private';
  return 'public';
}

export function isForbiddenAddress(address: string): boolean {
  const verdict = classifyAddress(address);
  return verdict !== 'public';
}
