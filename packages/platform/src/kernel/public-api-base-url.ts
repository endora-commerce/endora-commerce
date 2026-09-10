/**
 * The public origin of this backend — one reader, and one production refusal
 * (issue #218).
 *
 * Every payment-gateway callback URL (Tpay `notification`, PayU `notifyUrl`,
 * Autopay ITN/ISTN), every public product-feed URL and every newsletter
 * confirmation link is `<this origin>` plus an `/api/v1/...` path. Eight sites
 * used to read `PUBLIC_API_BASE_URL` directly and each invented
 * `http://localhost:3001` when it was unset, so a production deployment that
 * had never heard of the variable handed the gateway a callback nothing on the
 * internet can reach: no payment was ever confirmed, and nothing logged or
 * refused. A value whose absence produces a wrong-but-plausible URL is worse
 * than one that refuses — the argument `SESSION_COOKIE_SECRET` already wins in
 * `src/index.ts`.
 *
 * **Three spellings, one meaning.** `BACKEND_PUBLIC_URL` is what
 * `deploy/compose.prod.yml` has always derived from `API_DOMAIN`;
 * `API_PUBLIC_URL` is the second choice `tpay` / `payu` / `autopay` carry; and
 * `PUBLIC_API_BASE_URL` is the one the eight sites read. They named the same
 * thing and the templates set the wrong one, which is the whole defect. Reading
 * all three here is also what keeps the refusal from taking down a deployment
 * that is configured today: the shipped compose file supplies
 * `BACKEND_PUBLIC_URL`, so what this refuses is a production boot with *no*
 * public origin at all.
 *
 * Kept in the kernel rather than in a module because the refusal happens at the
 * top of `composeApp()`, before a module exists to own it, and because five
 * modules read the value.
 */

/**
 * The spellings of the public API origin, in precedence order.
 *
 * `PUBLIC_API_BASE_URL` leads because it is the name every call site, every
 * module README and the deployment checklist already document; the other two
 * are accepted so an already-configured deployment is not asked to rename a
 * variable to keep booting.
 */
const ORIGIN_VARIABLES = ['PUBLIC_API_BASE_URL', 'BACKEND_PUBLIC_URL', 'API_PUBLIC_URL'] as const;

const REFUSAL_MESSAGE =
  'PUBLIC_API_BASE_URL is not set and NODE_ENV=production. It is the origin every ' +
  'payment-gateway callback URL, public product-feed URL and newsletter confirmation link is ' +
  'built on, so defaulting it to http://localhost:3001 would hand the gateway a callback it ' +
  'cannot reach and no payment would ever be confirmed. Set PUBLIC_API_BASE_URL (or ' +
  'BACKEND_PUBLIC_URL) to the public https origin of this API — deploy/compose.prod.yml ' +
  'derives both from API_DOMAIN.';

/** Refusal to boot a production backend that has no public origin. */
export class PublicApiBaseUrlNotConfiguredError extends Error {
  constructor() {
    super(REFUSAL_MESSAGE);
    this.name = 'PublicApiBaseUrlNotConfiguredError';
  }
}

/**
 * The explicitly configured public origin, or `null`.
 *
 * Never invents one — the callers that use this rather than
 * {@link resolvePublicApiBaseUrl} are the ones that answer "is an origin
 * configured?" (the Autopay admin screen renders a relative ITN path and a
 * `publicApiBaseConfigured: false` flag) or that would rather emit nothing than
 * something unreachable (a product-feed image URL).
 *
 * Trailing slashes are stripped because every call site concatenates a path.
 */
export function configuredPublicApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const name of ORIGIN_VARIABLES) {
    const raw = env[name]?.trim();
    if (raw !== undefined && raw !== '') return raw.replace(/\/+$/, '');
  }
  return null;
}

/**
 * Refuse a production process that has no public origin.
 *
 * Called at the top of `composeApp()`, before the ORM, Redis or any module
 * exists, so both deployment entry points (`src/index.ts` and `src/worker.ts`)
 * inherit it from the one root they share and the operator sees the message
 * instead of a stack trace from whichever call site would have built the first
 * wrong URL.
 */
export function assertPublicApiBaseUrlConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] === 'production' && configuredPublicApiBaseUrl(env) === null) {
    throw new PublicApiBaseUrlNotConfiguredError();
  }
}

/**
 * The public origin a URL should be built on.
 *
 * Outside production it falls back to this process's own local origin, which is
 * what a developer running `pnpm run dev` means. In production it throws rather
 * than returning that fallback.
 */
export function resolvePublicApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = configuredPublicApiBaseUrl(env);
  if (configured !== null) return configured;
  assertPublicApiBaseUrlConfigured(env);
  return `http://localhost:${env['PORT'] ?? '3001'}`;
}

/**
 * Make an asset / API path absolute for a consumer that is not a browser on
 * this host — an e-mail client, a push payload, a partner's feed reader.
 * Relative `/assets/file/...` URLs only work in a browser on the API host.
 *
 * It arrived here from `modules/email/` (feature 080, T040b), where it was
 * filed under the module that first needed it and had **no consumer inside
 * that module at all**: the composition root was its only caller, for the PWA
 * asset bridge and the transactional-email asset URL. A deployment-origin
 * helper the host calls is the host's, and while it lived in a module the root
 * had a value import that stops having a spelling the day the module becomes a
 * package (D-160.6.1).
 *
 * Deliberately **not** on the `./kernel` barrel: no module reaches it, and a
 * published symbol with one host-internal consumer is public API nobody asked
 * for.
 *
 * **The default base is the two spellings this function has always read, in the
 * order it has always read them** — not {@link configuredPublicApiBaseUrl}.
 * The two disagree on precedence when both variables are set to different
 * origins, and that disagreement is one of the five answers **D-223** ended.
 *
 * **It has no consumer today, and that is the state the ruling left it in.**
 * `assets_library` resolves the public API origin itself and every URL it
 * produces is absolute, so the two composition-root call sites this function
 * existed for — the PWA asset bridge and the transactional-email asset URL —
 * are gone, and it came off the `./composition` barrel with them, which is what
 * holding that barrel to its consumers in both directions means. The
 * declaration stays: it is a correct, tested helper, and it returns to the
 * barrel the day an application needs one again. What it must not become is a
 * *sixth* answer to the question the ruling settled — a consumer rebasing a URL
 * a module already made absolute is a consumer that can disagree with it.
 */
export function absolutizePublicUrl(
  url: string | null | undefined,
  publicBase = process.env['BACKEND_PUBLIC_URL'] ?? process.env['PUBLIC_API_BASE_URL'] ?? '',
): string {
  if (!url) return '';
  if (/^(https?:|data:|mailto:)/i.test(url)) return url;
  const base = publicBase.replace(/\/+$/, '');
  if (!base) return url;
  if (url.startsWith('/')) return `${base}${url}`;
  return `${base}/${url}`;
}
