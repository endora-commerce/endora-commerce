import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { FEED_DELIVERY_LIMITS, type FeedDeliveryProtocol } from '@b2b/contracts';
import {
  refuseForbiddenAddresses,
  validateDeliveryTargetUrl,
} from '../delivery-target-url.js';
import {
  FeedDeliveryError,
  type FeedDeliveryAdapter,
  type FeedDeliverySendInput,
  type FeedDeliveryTarget,
} from '../delivery-adapter.interface.js';

/**
 * HTTP delivery — feature 070, the one implementation behind three of the five
 * names the operator request used.
 *
 * `HTTP Server`, `API` and `GraphQL` are the same two fields with the same help
 * text in the reference screenshots. They are one code path here, and the label
 * an operator picked is presentation stored on the configuration row.
 *
 * The artefact is `POST`ed **as-is** (spec resolved question 2): the file's own
 * bytes as the body, the serializer's media type as `Content-Type`, which an
 * operator-set header may override. A JSON envelope would mean base64-inflating
 * a file this module refuses to hold in memory anywhere else.
 *
 * ## The guard, in the order it applies
 *
 *  1. **Shape** — `https`, no userinfo, no fragment (SR-4). Checked at write
 *     time too, but a configuration can also be written by a seed or an overlay,
 *     so the send-time check is the one that actually holds.
 *  2. **Address** — the host is resolved and *every* returned address must be
 *     public (SR-2). A split-horizon name answering with one public and one
 *     private address is the interesting case.
 *  3. **Redirects** — `redirect: 'manual'`, at most one hop, re-validated
 *     through 1 and 2, and **the headers are re-attached only when the origin is
 *     unchanged** (SR-3). A partner who moves their endpoint keeps working; a
 *     redirect to somebody else's host gets the file but not the token.
 *
 * Redirecting a `POST` with a body is also where the honest limitation is: the
 * body stream has already been consumed by the first request, so a redirect that
 * needs the artefact resent is refused rather than silently delivering nothing.
 * The operator is told to point the configuration at the final address.
 *
 * The residual DNS-rebind risk recorded in `taxonomy-source-fetcher.ts` applies
 * here identically and for the same reason (Node re-resolves inside `fetch`);
 * it is bounded by the target being operator-configured and audited, never
 * user-supplied (SR-1).
 */

export type HostLookup = (host: string) => Promise<string[]>;

export interface HttpDeliveryAdapterOptions {
  /** Injected so no test in this repository opens a socket. */
  fetchFn?: typeof fetch;
  /** Injected for the same reason. */
  lookupFn?: HostLookup;
  transferTimeoutMs?: number;
}

async function defaultLookup(host: string): Promise<string[]> {
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

export class HttpDeliveryAdapter implements FeedDeliveryAdapter {
  readonly protocol: FeedDeliveryProtocol = 'http';

  private readonly fetchFn: typeof fetch;
  private readonly lookupFn: HostLookup;
  private readonly transferTimeoutMs: number;

  constructor(options: HttpDeliveryAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.lookupFn = options.lookupFn ?? defaultLookup;
    this.transferTimeoutMs = options.transferTimeoutMs ?? FEED_DELIVERY_LIMITS.TRANSFER_TIMEOUT_MS;
  }

  async send(input: FeedDeliverySendInput): Promise<void> {
    const url = await this.resolveTarget(input.target);
    await this.post({
      url,
      target: input.target,
      body: input.body,
      contentType: input.contentType,
      filename: input.filename,
      ...(input.signal ? { signal: input.signal } : {}),
      redirectsLeft: FEED_DELIVERY_LIMITS.MAX_REDIRECTS,
      bodyIsReplayable: false,
    });
  }

  /**
   * FR-106 / SR-5 — a fixed, non-operator-controlled body, so the endpoint
   * cannot be used to relay arbitrary content to an arbitrary host. The
   * operator's headers still ride along, because "does my token authenticate"
   * is most of what a connection test is for.
   */
  async check(target: FeedDeliveryTarget, signal?: AbortSignal): Promise<void> {
    const url = await this.resolveTarget(target);
    await this.post({
      url,
      target,
      body: Readable.from([Buffer.from(FEED_DELIVERY_LIMITS.TEST_PAYLOAD, 'utf8')]),
      contentType: 'text/plain; charset=utf-8',
      filename: FEED_DELIVERY_LIMITS.TEST_FILENAME,
      ...(signal ? { signal } : {}),
      redirectsLeft: FEED_DELIVERY_LIMITS.MAX_REDIRECTS,
      // A fixed short payload can be rebuilt, so a redirect is followable here.
      bodyIsReplayable: true,
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Steps 1 and 2 of the guard. Throws `target_refused`; returns the parsed URL. */
  private async resolveTarget(target: FeedDeliveryTarget): Promise<URL> {
    const shape = validateDeliveryTargetUrl(target.requestUrl ?? '');
    if (!shape.ok) {
      throw new FeedDeliveryError('target_refused', shape.detail);
    }
    let addresses: string[];
    try {
      addresses = await this.lookupFn(shape.url.hostname);
    } catch (err) {
      throw new FeedDeliveryError(
        'connection_failed',
        `The host "${shape.url.hostname}" could not be resolved.`,
        err,
      );
    }
    const verdict = refuseForbiddenAddresses(shape.url.hostname, addresses);
    if (!verdict.ok) throw new FeedDeliveryError('target_refused', verdict.detail);
    return shape.url;
  }

  private async post(input: {
    url: URL;
    target: FeedDeliveryTarget;
    body: Readable;
    contentType: string;
    filename: string;
    signal?: AbortSignal;
    redirectsLeft: number;
    bodyIsReplayable: boolean;
  }): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.transferTimeoutMs);
    const onOuterAbort = (): void => controller.abort();
    input.signal?.addEventListener('abort', onOuterAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchFn(input.url.toString(), {
        method: 'POST',
        headers: this.buildHeaders(input.target, input.contentType, input.filename),
        // `Readable` is accepted as a body by undici; `duplex: 'half'` is
        // required for any streamed request body and is not in the DOM types.
        body: Readable.toWeb(input.body) as unknown as BodyInit,
        duplex: 'half',
        redirect: 'manual',
        // No cookies, no ambient authentication — only the headers above.
        credentials: 'omit',
        signal: controller.signal,
      } as RequestInit);
    } catch (err) {
      throw new FeedDeliveryError(
        'connection_failed',
        controller.signal.aborted
          ? `The target did not answer within ${Math.round(this.transferTimeoutMs / 1000)} seconds.`
          : 'The target could not be reached.',
        err,
      );
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onOuterAbort);
    }

    if (response.status >= 300 && response.status < 400) {
      await this.followRedirect(response, input);
      return;
    }
    // The body is drained rather than read: a partner's 200 may carry a page,
    // and none of it is ours to keep.
    await response.body?.cancel().catch(() => undefined);

    if (response.status === 401 || response.status === 403) {
      throw new FeedDeliveryError(
        'authentication_failed',
        `The target answered HTTP ${response.status}. Check the authenticating header.`,
      );
    }
    if (!response.ok) {
      throw new FeedDeliveryError(
        'rejected_by_target',
        `The target answered HTTP ${response.status}.`,
      );
    }
  }

  private async followRedirect(
    response: Response,
    input: {
      url: URL;
      target: FeedDeliveryTarget;
      body: Readable;
      contentType: string;
      filename: string;
      signal?: AbortSignal;
      redirectsLeft: number;
      bodyIsReplayable: boolean;
    },
  ): Promise<void> {
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);

    if (input.redirectsLeft <= 0 || !location) {
      throw new FeedDeliveryError(
        'rejected_by_target',
        `The target answered HTTP ${response.status} and redirected instead of accepting the file.`,
      );
    }
    if (!input.bodyIsReplayable) {
      // The artefact stream is already consumed and re-reading storage mid-send
      // would make one delivery two reads of a file that may since have been
      // swept. Naming the fix beats a silent no-op.
      throw new FeedDeliveryError(
        'rejected_by_target',
        `The target redirected to "${safeLocation(location, input.url)}". Point the configuration at that address directly — a feed upload is not re-sent after a redirect.`,
      );
    }

    let next: URL;
    try {
      next = new URL(location, input.url);
    } catch {
      throw new FeedDeliveryError(
        'rejected_by_target',
        'The target redirected to an address that could not be parsed.',
      );
    }

    // SR-3 — the hop is re-validated, and the credential headers travel only if
    // the origin is unchanged.
    const sameOrigin = next.origin === input.url.origin;
    const hopTarget: FeedDeliveryTarget = sameOrigin
      ? { ...input.target, requestUrl: next.toString() }
      : { ...input.target, requestUrl: next.toString(), headers: {} };
    const validated = await this.resolveTarget(hopTarget);

    await this.post({
      ...input,
      url: validated,
      target: hopTarget,
      body: Readable.from([Buffer.from(FEED_DELIVERY_LIMITS.TEST_PAYLOAD, 'utf8')]),
      redirectsLeft: input.redirectsLeft - 1,
    });
  }

  /**
   * The operator's headers, with the defaults underneath them: an operator who
   * sets `Content-Type` means it, and a partner who wants
   * `application/x-ndjson` should not have to argue with the serializer.
   */
  private buildHeaders(
    target: FeedDeliveryTarget,
    contentType: string,
    filename: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename.replace(/["\\]/g, '')}"`,
      'user-agent': 'EndoraCommerce-ProductFeeds/1.0 (+feed-delivery)',
    };
    for (const [name, value] of Object.entries(target.headers)) {
      headers[name.trim().toLowerCase()] = value;
    }
    return headers;
  }
}

/** A redirect target rendered for an operator, without its query string. */
function safeLocation(location: string, base: URL): string {
  try {
    const url = new URL(location, base);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(unparseable)';
  }
}
