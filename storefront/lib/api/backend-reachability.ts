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
 * cannot make that question fail. The probe is one `fetch` in middleware and
 * runs no application code at all, which is what lets its *rejection* be read as
 * an answer rather than classified as one: see {@link SLOW_BUT_ALIVE_CODES}.
 *
 * So the two questions never share a code path, and `isUnreachableFailure` is
 * not a classifier for arbitrary errors — its domain is a probe rejection and
 * nothing else. Handing it a `TypeError` from a component would be a category
 * error, and there is no caller that can.
 *
 * ## What this cannot see, stated rather than discovered
 *
 * - **A backend that accepts connections and fails every request.** A `500` from
 *   the application is `reachable` here; the render proceeds and, if it throws,
 *   answers `500`. Only the gateway trio (`502`, `503`, `504`) is read as the
 *   origin saying the backend is not behind it.
 * - **A slow backend.** A response that never arrives inside {@link PROBE_TIMEOUT_MS}
 *   is `reachable` — deliberately fail-open, and the *only* rejection that is. A
 *   short budget applied to a merely slow backend would take the whole shop to
 *   `503`, which is a worse outage than the one being repaired. A *connect*
 *   timeout is unambiguous and is read as unreachable; a headers or body timeout
 *   is not.
 * - **Whether an unreachable backend will ever come back.** A misconfigured
 *   `BACKEND_BASE_URL` and a restarting container are the same answer here, and
 *   `Retry-After` promises the second. The alternative is telling a buyer their
 *   shop is permanently gone, which is not a storefront's call to make.
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
 * The failures that mean the backend answered, only slowly.
 *
 * **This is a deny-list, and it used to be an allow-list of transport codes.**
 * The allow-list named the eight `ECONNREFUSED`-family codes and read every
 * other rejection as reachable, which is the fail-*open* direction and it was
 * measured failing: `http://127.0.0.1:1` rejects with `TypeError: fetch failed`
 * caused by a bare `Error: bad port` — undici refuses the WHATWG blocked-port
 * list before it opens a socket, so there is no `code` anywhere in the chain —
 * and the whole storefront answered `500` while claiming to have asked whether
 * its backend was reachable. Found by the storefront-scaffold criterion's own
 * discrimination probe, which boots against exactly that address.
 *
 * The inversion is sound rather than convenient: this probe runs no application
 * code — it is one `fetch` in middleware, before the render — so a rejection of
 * it can only ever mean *"no answer from the backend's address"*. That is the
 * question this module claims to ask, and an allow-list answers it for the
 * failures somebody enumerated instead. It also fails in the useful direction:
 * the render is about to fail for the same reason, so the choice is between
 * `503` with a page and `500` with none.
 *
 * The one discrimination worth keeping is the opposite one, and it stays: a
 * backend that is **alive and slow** must not take the shop to `503`. So
 * undici's *headers* and *body* timeouts, and this module's own abort, read as
 * reachable. `UND_ERR_CONNECT_TIMEOUT` is not among them — a connect timeout is
 * a backend that is not there.
 */
const SLOW_BUT_ALIVE_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** `AbortSignal.timeout` rejects with one of these by `name`, carrying no code. */
const SLOW_BUT_ALIVE_NAMES: ReadonlySet<string> = new Set(['TimeoutError', 'AbortError']);

/**
 * Statuses that mean the thing in front of the backend says the backend is not
 * there. A `500` is the application failing and is not one of them.
 */
const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * Every `code` **and `name`** reachable from a thrown value, following `cause`
 * and `AggregateError.errors`.
 *
 * Both, because the two states this has to tell apart are not both spelled as a
 * code: undici's slow-answer failures carry `UND_ERR_HEADERS_TIMEOUT`, while an
 * `AbortSignal.timeout` rejects with a `DOMException` whose only signal is
 * `name: 'TimeoutError'`.
 *
 * Node reports a refused connection as `TypeError: fetch failed` whose `cause`
 * carries the code, and reports a host with several addresses as an
 * `AggregateError` whose `errors` each carry one — so a walker that reads only
 * `cause` sees nothing for the second shape. Cycle-safe, because `cause` chains
 * are not guaranteed to be acyclic.
 */
export function errorSignals(error: unknown): readonly string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const record = current as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
    if (typeof record.code === 'string') codes.push(record.code);
    if (typeof record.name === 'string') codes.push(record.name);
    if (record.cause !== undefined) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...(record.errors as unknown[]));
  }
  return codes;
}

/**
 * Did this probe rejection mean the backend could not be reached?
 *
 * Pure, and the only definition of the word in this storefront. Every rejection
 * counts except the ones {@link SLOW_BUT_ALIVE_CODES} names — see its doc block
 * for why the test is a deny-list and what measured the allow-list wrong.
 */
export function isUnreachableFailure(error: unknown): boolean {
  const signals = errorSignals(error);
  if (signals.some((signal) => SLOW_BUT_ALIVE_CODES.has(signal))) return false;
  if (signals.some((signal) => SLOW_BUT_ALIVE_NAMES.has(signal))) return false;
  return true;
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
