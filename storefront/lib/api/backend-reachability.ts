/**
 * Can this storefront open a connection to its backend at all?
 *
 * ## Why the question is asked here and not in the render
 *
 * A storefront whose backend is unreachable answered a raw `500` with an empty
 * document: `getI18nConfig()` is the one root-layout read that does not degrade
 * (its two neighbours, `getModulePresence` and `getPublicSalesChannel`, both
 * catch and say so in their own doc blocks), so `fetch failed` propagated out of
 * `getServerContext()` and Next turned it into its default error page — on every
 * route, not only on `/`.
 *
 * The owner's answer is a designed page at **`503 Service Unavailable`** with a
 * `Retry-After`, because a friendly page at `200` is indexed as the shop's
 * content and a `500` tells an uptime monitor "broken" where the truth is
 * "temporarily not there".
 *
 * **A Next 15 App Router page render cannot answer `503`.** Measured against
 * `next@15.5.15`: `app-render.js` sets `res.statusCode = 500` unconditionally for
 * a thrown error, and the only other statuses a render can reach are the three
 * `http-access-fallback.js` allows (`ALLOWED_CODES = {401, 403, 404}`) plus the
 * redirect pair. `next/server` exports no status API. The one seam in front of
 * the render that *can* set an arbitrary status is middleware, and a
 * `NextResponse.rewrite(target, { status })` was measured to answer that status
 * carrying the fully server-rendered document at `target`. So the question has
 * to be asked before the render, which is what this module is for.
 *
 * ## The discrimination, and why it is structural rather than a heuristic
 *
 * "The backend is unreachable" and "the application has a bug" must not be
 * conflated, or the second hides behind the first. This module never inspects an
 * error the application raised, and nothing anywhere catches one on its behalf:
 * a `TypeError` in a component, a failed Zod parse and a null dereference all
 * keep throwing, and keep answering `500`, exactly as they do today.
 *
 * What is asked instead is a question **only the network can answer** — can a
 * connection to `BACKEND_BASE_URL` be established — and an application defect
 * cannot make that question fail. The classification is therefore a property of
 * the transport, taken from the error's own `code` chain at the moment the
 * transport reports it, and never a string match on a message.
 *
 * ## What this cannot see, stated rather than discovered
 *
 * - **A backend that accepts connections and fails every request.** A `500` from
 *   the application is `reachable` here; the render proceeds and, if it throws,
 *   answers `500`. Only the gateway trio (`502`, `503`, `504`) is read as the
 *   origin saying the backend is not behind it.
 * - **A slow backend.** A response that never arrives inside {@link PROBE_TIMEOUT_MS}
 *   is `reachable` — deliberately fail-open. A short budget applied to a merely
 *   slow backend would take the whole shop to `503`, which is a worse outage than
 *   the one being repaired. A *connect* timeout is unambiguous and is read as
 *   unreachable; a headers or body timeout is not.
 * - **The window between the probe and the render.** A backend that dies inside
 *   it renders and answers `500`. That is today's behaviour, not a regression.
 * - **A backend reachable from the middleware runtime and not from the render.**
 *   Both run in the same process against the same variable, so this needs a
 *   split DNS or a per-runtime proxy to happen at all.
 *
 * ## Not a second source of truth
 *
 * The probe asks **the same endpoint whose failure produces the `500`** —
 * `getI18nConfig()`'s — rather than a health endpoint with a definition of
 * "healthy" of its own. There is one question and one classifier here; the gate
 * is the only caller that acts on it.
 */

/** What the probe concluded about the transport. */
export type ReachabilityVerdict = 'reachable' | 'unreachable';

/**
 * The read whose failure is the one being pre-empted.
 *
 * `getI18nConfig()` calls this path, and it is the first root-layout read that
 * throws rather than degrading, so a probe of it predicts precisely the render
 * this gate exists to replace. A route that moved answers `404`, which is
 * `reachable` — the fail-open direction.
 */
export const REACHABILITY_PROBE_PATH = '/api/v1/i18n/config';

/**
 * How long the probe is given.
 *
 * Generous on purpose: this budget is only ever spent by the one request per
 * TTL window that refreshes the verdict, and exceeding it is read as
 * `reachable`, so a tight budget would buy nothing and could cost a false
 * shop-wide `503`.
 */
export const PROBE_TIMEOUT_MS = 2_000;

/** How long a `reachable` verdict is reused before the next request re-asks. */
export const REACHABLE_TTL_MS = 5_000;

/**
 * How long an `unreachable` verdict is reused.
 *
 * Shorter than its opposite so a backend that comes back is served again
 * promptly, and long enough that a shop under load does not turn one outage into
 * a second one against the recovering backend.
 */
export const UNREACHABLE_TTL_MS = 1_000;

/**
 * Transport-level failures that mean "nothing is listening, or nothing is
 * routable".
 *
 * `UND_ERR_CONNECT_TIMEOUT` is undici's *connect* timeout and belongs here;
 * `UND_ERR_HEADERS_TIMEOUT` and `UND_ERR_BODY_TIMEOUT` are a backend that
 * answered too slowly and deliberately do not.
 */
const UNREACHABLE_CAUSE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Statuses that mean the thing in front of the backend says the backend is not
 * there. A `500` is the application failing and is not one of them.
 */
const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * Every `code` reachable from a thrown value, following `cause` and
 * `AggregateError.errors`.
 *
 * Node reports a refused connection as `TypeError: fetch failed` whose `cause`
 * carries the code, and reports a host with several addresses as an
 * `AggregateError` whose `errors` each carry one — so a walker that reads only
 * `cause` sees nothing for the second shape. Cycle-safe, because `cause` chains
 * are not guaranteed to be acyclic.
 */
export function errorCodes(error: unknown): readonly string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof record.code === 'string') codes.push(record.code);
    if (record.cause !== undefined) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...(record.errors as unknown[]));
  }
  return codes;
}

/**
 * Did this thrown value mean the backend could not be reached?
 *
 * Pure, and the only definition of the word in this storefront.
 */
export function isUnreachableFailure(error: unknown): boolean {
  return errorCodes(error).some((code) => UNREACHABLE_CAUSE_CODES.has(code));
}

/** Did this answered status mean the backend is not behind its origin? */
export function isUnreachableStatus(status: number): boolean {
  return UNREACHABLE_STATUSES.has(status);
}

/** The verdict a completed probe attempt carries, as a pure decision. */
export function verdictFor(
  outcome: { readonly status: number } | { readonly error: unknown },
): ReachabilityVerdict {
  if ('status' in outcome) {
    return isUnreachableStatus(outcome.status) ? 'unreachable' : 'reachable';
  }
  return isUnreachableFailure(outcome.error) ? 'unreachable' : 'reachable';
}

/** How long a verdict of this kind is reused. */
export function ttlFor(verdict: ReachabilityVerdict): number {
  return verdict === 'reachable' ? REACHABLE_TTL_MS : UNREACHABLE_TTL_MS;
}

interface CachedVerdict {
  readonly verdict: ReachabilityVerdict;
  readonly at: number;
}

let cached: CachedVerdict | null = null;
let inFlight: Promise<ReachabilityVerdict> | null = null;

/** Drops the memoised verdict. For tests; nothing in the request path calls it. */
export function resetReachabilityCache(): void {
  cached = null;
  inFlight = null;
}

/** `true` while a cached verdict is still inside its own kind's window. */
export function isFresh(entry: CachedVerdict | null, now: number): boolean {
  return entry !== null && now - entry.at < ttlFor(entry.verdict);
}

async function probe(baseUrl: string): Promise<ReachabilityVerdict> {
  try {
    const response = await fetch(`${baseUrl}${REACHABILITY_PROBE_PATH}`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return verdictFor({ status: response.status });
  } catch (error) {
    return verdictFor({ error });
  }
}

/**
 * The verdict for this request.
 *
 * Memoised for one window per kind and **coalesced** — a burst arriving on a
 * stale entry shares one probe rather than opening one connection each, which
 * is what keeps a recovering backend from being met by the whole shop at once.
 *
 * The base URL is read per call rather than at module scope: middleware was
 * measured to see the *runtime* environment (a value set at `next start` and not
 * the one present at `next build`), and reading it here is what keeps that true
 * for a container configured at start-up.
 */
export async function backendReachability(now: number = Date.now()): Promise<ReachabilityVerdict> {
  if (isFresh(cached, now)) return cached!.verdict;
  if (inFlight !== null) return await inFlight;

  const baseUrl = process.env['BACKEND_BASE_URL'] ?? 'http://localhost:3001';
  inFlight = probe(baseUrl)
    .then((verdict) => {
      cached = { verdict, at: Date.now() };
      return verdict;
    })
    .finally(() => {
      inFlight = null;
    });
  return await inFlight;
}
