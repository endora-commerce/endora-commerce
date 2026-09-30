// Trusted-proxy configuration for the HTTP server (issue #220).
//
// Behind a reverse proxy the TCP peer is the proxy, so `request.ip` is the
// proxy's address for every request unless Fastify is told which hop to trust.
// That address is what the per-IP rate limiter buckets on and what the MFA,
// impersonation and prompt-action audit rows record, so an unconfigured
// deployment behind nginx has one shared rate-limit bucket for the whole
// internet and a security audit trail that names its own proxy.
//
// Trusting the header unconditionally is the other failure, not the fix: with
// `trustProxy: true` Fastify believes any `X-Forwarded-For` a client sends, and
// a client can send whatever it likes. So this module parses the *narrow*
// forms — a hop count, or the addresses the deployment's own proxies use — and
// has no spelling at all for "trust everything". The unsafe answer is not hard
// to write here; it is unwritable.
//
// This file reads no environment variable. `src/http` is a platform root
// (D-52/D-53): the composition root reads the variables and injects the parsed
// value, exactly as it does for the rate-limit ceiling.

import { isIP } from 'node:net';

/**
 * What `buildServer` passes to Fastify's `trustProxy`. A hop count, or a list
 * of trusted proxy addresses/CIDRs/named ranges. Deliberately not `boolean`:
 * `true` means "believe every client's X-Forwarded-For".
 */
export type TrustedProxy = number | string[];

/** Raw values, as the composition root read them from the environment. */
export interface TrustedProxyEnv {
  /** `TRUSTED_PROXY_HOPS` — how many proxies sit in front of the backend. */
  hops?: string | undefined;
  /** `TRUSTED_PROXY_ADDRESSES` — comma-separated proxy addresses/CIDRs. */
  addresses?: string | undefined;
}

/** A configuration value the parser refuses. The composition root fails the boot on it. */
export class TrustedProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrustedProxyConfigError';
  }
}

/**
 * Sanity ceiling on the hop count. Real deployments have one or two proxies
 * (host nginx, optionally a CDN in front of it); a larger number is a typo, and
 * a large enough one is `true` written in a way that looks careful.
 */
const MAX_HOPS = 10;

/** Address ranges `@fastify/proxy-addr` knows by name. */
const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

const HOPS_VAR = 'TRUSTED_PROXY_HOPS';
const ADDRESSES_VAR = 'TRUSTED_PROXY_ADDRESSES';

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

function parseHops(raw: string): number {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new TrustedProxyConfigError(
      `${HOPS_VAR}="${raw}" is not a whole number. Set it to the number of proxies in front of ` +
        `the backend (a single host nginx is 1), or use ${ADDRESSES_VAR} instead.`,
    );
  }
  const hops = Number(trimmed);
  if (hops < 1 || hops > MAX_HOPS) {
    throw new TrustedProxyConfigError(
      `${HOPS_VAR}=${trimmed} is out of range — it must be between 1 and ${MAX_HOPS}. ` +
        `0 does not mean "trust nothing" (leave ${HOPS_VAR} unset for that); it makes the ` +
        `socket's own peer the client.`,
    );
  }
  return hops;
}

function assertUsableAddress(entry: string): void {
  if (NAMED_RANGES.has(entry)) return;

  const slash = entry.indexOf('/');
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const family = isIP(address);
  if (family === 0) {
    throw new TrustedProxyConfigError(
      `${ADDRESSES_VAR} entry "${entry}" is not an IP address, a CIDR range or one of ` +
        `${[...NAMED_RANGES].join(', ')}. Host names are not resolved — the match is made ` +
        `against the connecting address, so a name would silently match nothing.`,
    );
  }
  if (slash === -1) return;

  const prefix = entry.slice(slash + 1);
  const maxPrefix = family === 4 ? 32 : 128;
  if (!/^[0-9]+$/.test(prefix) || Number(prefix) > maxPrefix) {
    throw new TrustedProxyConfigError(
      `${ADDRESSES_VAR} entry "${entry}" has an invalid prefix length — expected 1..${maxPrefix}.`,
    );
  }
  if (Number(prefix) === 0) {
    throw new TrustedProxyConfigError(
      `${ADDRESSES_VAR} entry "${entry}" trusts every address, which is the same as believing ` +
        `any client's X-Forwarded-For header. List the deployment's own proxy addresses, or ` +
        `set ${HOPS_VAR} to the number of proxies in front of the backend.`,
    );
  }
}

function parseAddresses(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) {
    throw new TrustedProxyConfigError(`${ADDRESSES_VAR}="${raw}" lists no address.`);
  }
  for (const entry of entries) assertUsableAddress(entry);
  return entries;
}

/** Fastify's `trustProxy` function form: `hop` 0 is the socket's own peer. */
export type TrustProxyFunction = (address: string, hop: number) => boolean;

/**
 * What `buildServer` hands Fastify for a {@link TrustedProxy}.
 *
 * Fastify 5.12.1 (GHSA-3m5p-2c4r-xxw2) removed the numeric `trustProxy`: a
 * number now fails closed at runtime, so `TRUSTED_PROXY_HOPS=1` would silently
 * go back to reporting the proxy as the client. A hop count is therefore
 * translated into the function form, and the function is exactly what Fastify
 * compiled a number into before 5.12.1 — `@fastify/proxy-addr` walks the chain
 * from the socket peer (hop 0) through `X-Forwarded-For` right to left, and
 * trusts hop `i` while `i < hops`. The address list is passed through
 * unchanged; Fastify compiles it itself.
 *
 * Like the numeric form it replaces, a hop count does not look at the
 * connecting address, so it is only as safe as the network that guarantees the
 * backend is reachable through its proxies alone. `TRUSTED_PROXY_ADDRESSES`
 * is the form that does not depend on that.
 */
export function toFastifyTrustProxy(trusted: TrustedProxy): TrustProxyFunction | string[] {
  if (Array.isArray(trusted)) return trusted;
  const hops = trusted;
  return (_address, hop) => hop < hops;
}

/**
 * Turns the two environment variables into the value `buildServer` takes.
 * Returns `undefined` when neither is set — the server then trusts no proxy,
 * which is what it has always done.
 *
 * Throws `TrustedProxyConfigError` on anything it cannot make sense of, rather
 * than falling back to the default: an operator who mistyped the variable would
 * otherwise get the broken behaviour they were trying to fix, silently.
 */
export function parseTrustedProxy(env: TrustedProxyEnv): TrustedProxy | undefined {
  const hopsSet = !blank(env.hops);
  const addressesSet = !blank(env.addresses);

  if (hopsSet && addressesSet) {
    throw new TrustedProxyConfigError(
      `${HOPS_VAR} and ${ADDRESSES_VAR} are both set. They are two ways of saying the same ` +
        `thing and Fastify takes one — set exactly one of them.`,
    );
  }
  if (hopsSet) return parseHops(env.hops as string);
  if (addressesSet) return parseAddresses(env.addresses as string);
  return undefined;
}
