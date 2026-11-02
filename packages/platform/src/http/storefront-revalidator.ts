/**
 * Triggers on-demand revalidation of the storefront's tagged fetch caches
 * (feature 049; promoted to shared HTTP infrastructure in feature 066). It has
 * no module-specific content — it POSTs cache tags to the storefront's
 * revalidate endpoint — and four modules need it, so it lives here rather than
 * inside one of them (Principle I).
 *
 * Best-effort: a failed call is logged and swallowed so a config/custom-event
 * write never fails because the storefront is unreachable. Disabled (no-op)
 * when the base URL or secret is not configured.
 *
 * A call is bounded by a timeout (`timeoutMs`, default {@link DEFAULT_TIMEOUT_MS}), and
 * a non-2xx answer is a failure like a transport error (feature 163, security review M2;
 * R19C T271): a `401` from a `REVALIDATE_SECRET` the two sides do not share used to pass
 * in silence, leaving every tagged entry stale. The log names the status and the tags,
 * never the secret.
 *
 * Issue #112 — every content write revalidates, so a storefront that refuses them all
 * would put one warning per write into the log. A warning identical to one logged in
 * the last {@link WARNING_WINDOW_MS} — same storefront, same status, or a transport
 * failure again — is held and counted, and the next one logged after the window says
 * how many were held (`suppressed`). The record is shared by every instance, because
 * two compositions build a revalidator per call; a success clears it for that
 * storefront, so the next failure after a recovery is logged at once. Without a logger
 * of its own, the revalidator reports to the platform logger rather than to nothing.
 */
import { platformLogger } from '../kernel/logging.js';

/** How long one revalidation call may take before it is abandoned, unless `timeoutMs` says otherwise. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** How long a warning holds back its identical repeats. */
const WARNING_WINDOW_MS = 60_000;

/** Per storefront and outcome: when it was last logged, and how many repeats were held since. */
const recentWarnings = new Map<string, { loggedAt: number; suppressed: number }>();

/** Forget every held warning. Tests only: the record is process-wide by design. */
export function resetRevalidationWarnings(): void {
  recentWarnings.clear();
}

export interface StorefrontRevalidatorOptions {
  baseUrl: string | undefined;
  secret: string | undefined;
  fetchFn?: typeof fetch;
  logger?: { warn: (obj: unknown, msg: string) => void };
  /** How long to wait for the storefront's answer; a caller may await the call. Default {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** The clock the warning window is measured on. Default `Date.now`. */
  now?: () => number;
}

export class StorefrontRevalidator {
  private logger: StorefrontRevalidatorOptions['logger'];

  constructor(private readonly options: StorefrontRevalidatorOptions) {
    this.logger = options.logger;
  }

  /** Attach a logger once the Fastify app (and its `log`) exists. */
  setLogger(logger: NonNullable<StorefrontRevalidatorOptions['logger']>): void {
    this.logger = logger;
  }

  get enabled(): boolean {
    return !!this.options.baseUrl && !!this.options.secret;
  }

  async revalidate(tags: string[]): Promise<void> {
    if (!this.enabled || tags.length === 0) return;
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    try {
      const response = await fetchFn(`${this.options.baseUrl}/api/revalidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-revalidate-secret': this.options.secret as string,
        },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (response.ok) {
        this.recovered();
        return;
      }
      this.warn(
        String(response.status),
        { status: response.status, tags },
        response.status === 401
          ? '[storefront-revalidate] refused: REVALIDATE_SECRET differs between the backend and the storefront'
          : '[storefront-revalidate] refused',
      );
    } catch (err) {
      this.warn('transport', { err, tags }, '[storefront-revalidate] failed');
    }
  }

  private warn(outcome: string, obj: Record<string, unknown>, msg: string): void {
    const key = `${this.options.baseUrl ?? ''} ${outcome}`;
    const now = (this.options.now ?? Date.now)();
    const last = recentWarnings.get(key);
    if (last !== undefined && now - last.loggedAt < WARNING_WINDOW_MS) {
      last.suppressed += 1;
      return;
    }
    recentWarnings.set(key, { loggedAt: now, suppressed: 0 });
    const suppressed = last?.suppressed ?? 0;
    (this.logger ?? platformLogger()).warn(suppressed > 0 ? { ...obj, suppressed } : obj, msg);
  }

  private recovered(): void {
    const prefix = `${this.options.baseUrl ?? ''} `;
    for (const key of recentWarnings.keys()) {
      if (key.startsWith(prefix)) recentWarnings.delete(key);
    }
  }
}
