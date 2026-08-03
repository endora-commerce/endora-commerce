import { lookup } from 'node:dns/promises';
import { TAXONOMY_FETCH_LIMITS } from '@b2b/contracts';
import type {
  TaxonomyFetchFailure,
  TaxonomyFetchRequest,
  TaxonomyFetchResult,
  TaxonomySourceFetcherPort,
} from './taxonomy-source-fetcher.interface.js';
import { isForbiddenAddress, validateTaxonomySourceUrl } from './taxonomy-source-url.js';

/**
 * The module's only outbound HTTP — feature 067 / FR-090, FR-091,
 * research §R23.
 *
 * `globalThis.fetch` behind an injected `fetchFn`, on the `SgtmClient` /
 * `AssetByteFetcher` precedent: **no new dependency**, and no test in this
 * repository can reach the network by accident.
 *
 * The guard, in the order it applies:
 *
 *  1. **Shape** — `https`, no credentials, no fragment, a host. Checked here as
 *     well as at settings-write time, because a setting can also be written by
 *     a seed, a migration or an overlay.
 *  2. **Address** — the host is resolved and every returned address must be
 *     public. Loopback, link-local (the `169.254.169.254` metadata endpoint),
 *     RFC 1918 and CGNAT are refused. *Every* address, not the first: a
 *     split-horizon name that answers with one public and one private address
 *     is the interesting case.
 *  3. **Redirects** — `redirect: 'manual'`, at most three hops, **every hop
 *     re-validated through 1 and 2**. A permissive redirect is the standard way
 *     an allow-listed URL becomes an internal one.
 *  4. **Size** — enforced while reading the stream, never from
 *     `Content-Length`, which is attacker-controlled in this threat model. The
 *     reader is cancelled the moment the cap is passed, so a hostile server
 *     cannot make the process buffer whatever it likes.
 *  5. **Time** — an `AbortController` per request; the caller additionally
 *     passes a whole-check signal.
 *
 * Nothing authenticating is ever sent: no cookies, no `Authorization`, no
 * client certificate. Both providers' endpoints are anonymous, and a mirror
 * that needed credentials would be a `credential_ref` setting (feature 058),
 * out of scope for v1.
 *
 * **Honest residual risk, recorded rather than glossed** (research §R23): Node's
 * `fetch` re-resolves DNS itself, so the pre-flight address check is not a hard
 * pin and a DNS rebind between check and connect is theoretically possible.
 * Closing that needs a custom `undici` dispatcher — a new runtime dependency
 * this feature will not take. It is bounded on three sides: the URL is
 * operator-set and audited, never user-supplied; the body is never returned to
 * any caller, only parsed as taxonomy lines and discarded if it does not
 * conform; and the whole mechanism ships off.
 */

/** Politeness and bandwidth, not identity. */
const ACCEPT_HEADER = 'text/plain, text/csv;q=0.9, */*;q=0.1';
const USER_AGENT = 'EndoraCommerce-ProductFeeds/1.0 (+taxonomy-revision-check)';

export type HostLookup = (host: string) => Promise<string[]>;

export interface TaxonomySourceFetcherOptions {
  /** Injected so no test opens a socket. Defaults to the platform `fetch`. */
  fetchFn?: typeof fetch;
  /** Injected for the same reason. Defaults to `node:dns/promises`. */
  lookupFn?: HostLookup;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

async function defaultLookup(host: string): Promise<string[]> {
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

function transportFailure(detail: string, bytesRead: number | null = null): TaxonomyFetchFailure {
  return { ok: false, outcome: 'failed', reason: 'transport', detail, httpStatus: null, bytesRead };
}

export class TaxonomySourceFetcher implements TaxonomySourceFetcherPort {
  private readonly fetchFn: typeof fetch;
  private readonly lookupFn: HostLookup;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRedirects: number;

  constructor(options: TaxonomySourceFetcherOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.lookupFn = options.lookupFn ?? defaultLookup;
    this.requestTimeoutMs = options.requestTimeoutMs ?? TAXONOMY_FETCH_LIMITS.REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? TAXONOMY_FETCH_LIMITS.MAX_RESPONSE_BYTES;
    this.maxRedirects = options.maxRedirects ?? TAXONOMY_FETCH_LIMITS.MAX_REDIRECTS;
  }

  async fetchFile(request: TaxonomyFetchRequest): Promise<TaxonomyFetchResult> {
    let target = request.url;

    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      const allowed = await this.validateTarget(target);
      if (allowed !== null) return allowed;

      const attempt = await this.request(target, hop === 0 ? (request.etag ?? null) : null, request.signal);
      if ('failure' in attempt) return attempt.failure;

      const { response } = attempt;
      // `304` sits inside the 3xx range but is an answer, not a redirect.
      if (response.status !== 304 && response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        // Drain nothing: a redirect body is not ours to read.
        if (!location) {
          return {
            ok: false,
            outcome: 'failed',
            reason: 'http_status',
            detail: `HTTP ${response.status} with no Location header.`,
            httpStatus: response.status,
            bytesRead: null,
          };
        }
        try {
          target = new URL(location, target).toString();
        } catch {
          return transportFailure(`The redirect target "${location}" could not be parsed.`);
        }
        continue;
      }

      return this.readResponse(response);
    }

    return transportFailure(
      `The address redirected more than ${this.maxRedirects} times without answering.`,
    );
  }

  /** Returns a failure when the target must not be requested, otherwise null. */
  private async validateTarget(target: string): Promise<TaxonomyFetchFailure | null> {
    const shape = validateTaxonomySourceUrl(target);
    if (!shape.ok) return transportFailure(shape.detail);

    let addresses: string[];
    try {
      addresses = await this.lookupFn(shape.url.hostname);
    } catch (err) {
      return transportFailure(errorLine(err));
    }
    if (addresses.length === 0) {
      return transportFailure(`The host "${shape.url.hostname}" resolved to no address.`);
    }
    const forbidden = addresses.find((address) => isForbiddenAddress(address));
    if (forbidden !== undefined) {
      return transportFailure(
        `The host "${shape.url.hostname}" resolves to ${forbidden}, which is not a public address.`,
      );
    }
    return null;
  }

  private async request(
    target: string,
    etag: string | null,
    outerSignal: AbortSignal | undefined,
  ): Promise<{ response: Response } | { failure: TaxonomyFetchFailure }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const onOuterAbort = (): void => controller.abort();
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const headers: Record<string, string> = {
        accept: ACCEPT_HEADER,
        'user-agent': USER_AGENT,
      };
      if (etag) headers['if-none-match'] = etag;

      const response = await this.fetchFn(target, {
        method: 'GET',
        headers,
        redirect: 'manual',
        // No cookies, no ambient authentication, ever.
        credentials: 'omit',
        signal: controller.signal,
      });
      return { response };
    } catch (err) {
      return { failure: transportFailure(errorLine(err)) };
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
  }

  private async readResponse(response: Response): Promise<TaxonomyFetchResult> {
    if (response.status === 304) {
      return {
        ok: true,
        body: '',
        bytesRead: 0,
        etag: response.headers.get('etag'),
        httpStatus: 304,
        notModified: true,
      };
    }
    if (response.status === 404 || response.status === 410) {
      return {
        ok: false,
        outcome: 'failed',
        reason: 'not_found',
        detail: `The provider answered HTTP ${response.status}.`,
        httpStatus: response.status,
        bytesRead: null,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        outcome: 'failed',
        reason: 'http_status',
        detail: `The provider answered HTTP ${response.status}.`,
        httpStatus: response.status,
        bytesRead: null,
      };
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      await cancelBody(response);
      return {
        ok: false,
        outcome: 'rejected',
        reason: 'not_taxonomy',
        detail: `The address answered with "${contentType}", which is a web page rather than a category list.`,
        httpStatus: response.status,
        bytesRead: null,
      };
    }

    const read = await this.readCapped(response);
    if ('failure' in read) return read.failure;
    const { text, bytesRead } = read;

    if (bytesRead === 0 || text.trim() === '') {
      return {
        ok: false,
        outcome: 'rejected',
        reason: 'empty',
        detail: 'The address answered with an empty file.',
        httpStatus: response.status,
        bytesRead,
      };
    }
    if (text.trimStart().startsWith('<')) {
      return {
        ok: false,
        outcome: 'rejected',
        reason: 'not_taxonomy',
        detail: 'The address answered with markup rather than a category list.',
        httpStatus: response.status,
        bytesRead,
      };
    }

    // A truthful `Content-Length` that the body did not reach means the
    // connection dropped mid-file. Half a taxonomy parses perfectly well and
    // would install as a revision that silently lost thousands of nodes.
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > 0 && bytesRead < declared) {
      return {
        ok: false,
        outcome: 'rejected',
        reason: 'truncated',
        detail: `The download stopped at ${bytesRead} of ${declared} bytes.`,
        httpStatus: response.status,
        bytesRead,
      };
    }

    return {
      ok: true,
      body: text,
      bytesRead,
      etag: response.headers.get('etag'),
      httpStatus: response.status,
      notModified: false,
    };
  }

  /**
   * Reads the body with the cap enforced per chunk. The reader is cancelled as
   * soon as the cap is passed — the point of a streaming cap is that the
   * process never holds more than the cap, so `arrayBuffer()` would defeat it.
   */
  private async readCapped(
    response: Response,
  ): Promise<{ text: string; bytesRead: number } | { failure: TaxonomyFetchFailure }> {
    const body = response.body;
    if (!body) return { text: '', bytesRead: 0 };

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytesRead += value.byteLength;
        if (bytesRead > this.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          return {
            failure: {
              ok: false,
              outcome: 'rejected',
              reason: 'too_large',
              detail: `The file exceeded the ${this.maxResponseBytes}-byte download limit.`,
              httpStatus: response.status,
              bytesRead,
            },
          };
        }
        chunks.push(value);
      }
    } catch (err) {
      await reader.cancel().catch(() => undefined);
      return { failure: transportFailure(errorLine(err), bytesRead) };
    }

    return { text: Buffer.concat(chunks).toString('utf8'), bytesRead };
  }
}

/** One line, bounded, with no stack trace — this ends up on an admin screen. */
function errorLine(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return message.slice(0, 240);
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}
