/**
 * The two addresses this storefront cannot invent.
 *
 * ## What this replaced, and why a default was the wrong answer
 *
 * Until this module existed, twenty-four sites read one of two environment
 * variables and answered an unset one with `http://localhost:3001`. Under
 * **D-195** the reference storefront is what every client instance is copied
 * from, so those defaults were not a developer convenience living in a
 * developer's tree — they were compiled into every shop.
 *
 * The public half is the one that cannot be repaired later. Next inlines a
 * `NEXT_PUBLIC_*` value into the **browser** bundle at build time: measured on
 * this tree, `NEXT_PUBLIC_API_BASE_URL` appears as a string literal in eleven
 * client chunks. So a storefront built without it shipped a bundle telling every
 * visitor's browser to call `http://localhost:3001` — the visitor's own machine
 * — and `next build` reported success. No later `next start`, no container
 * environment and no operator can change that value; the bundle is already
 * written.
 *
 * The owner's decision (2026-09-06) is that the defaults go. What replaces them
 * is a refusal at the earliest moment the answer is decidable, which is a
 * different moment for each variable:
 *
 * | variable | read | refused by |
 * | --- | --- | --- |
 * | `NEXT_PUBLIC_API_BASE_URL` | inlined at **build** time | `next.config.js`, before the build starts |
 * | `BACKEND_BASE_URL` | at **run** time, by the serving process | `instrumentation.ts`, before the first request |
 *
 * Both gates and every call site below express the rule through this one module,
 * so there is one predicate and one sentence rather than two of each waiting to
 * disagree.
 *
 * **This file is `.mjs`, and that is the reason it is.** `next.config.js` is
 * loaded by Node, which cannot import TypeScript, and `next.config.ts` is not
 * the way out: Next's TS-config loader resolves `typescript` from the instance,
 * which a scaffolded client storefront does not have — measured, as a red A5 on
 * the `endora new storefront` acceptance criterion. JSDoc annotations give this
 * module full types for its twenty-four TypeScript consumers, so nothing is
 * given up; `tsconfig.json` already sets `allowJs`.
 *
 * ## Why the accessors still refuse, when the gates have already run
 *
 * The gates are where an operator *meets* the refusal; the accessors are what
 * make it impossible to get an answer without one. A test that imports a fetcher
 * runs neither gate, and a future entry point that Next loads by some path
 * nobody predicted runs neither either. An accessor that returned
 * `string | undefined` would push the decision back out to twenty-four call
 * sites, which is the shape this module removes.
 *
 * ## What this deliberately does not do
 *
 * It does not check that anything is *reachable* at the address. That is
 * `lib/api/backend-reachability.ts`' question, it is answered per request, and
 * the two must not be conflated: an unreachable backend is a `503` with a
 * designed page and a promise to come back, while an unconfigured one is an
 * operator error that no amount of retrying fixes. Keeping them apart is why
 * this refuses before the server accepts its first connection.
 */

/**
 * The browser's view of the backend. Inlined into the bundle at build time.
 * @type {'NEXT_PUBLIC_API_BASE_URL'}
 */
export const PUBLIC_API_BASE_URL_VAR = 'NEXT_PUBLIC_API_BASE_URL';

/**
 * The serving process's view of the backend. Read at run time.
 * @type {'BACKEND_BASE_URL'}
 */
export const BACKEND_BASE_URL_VAR = 'BACKEND_BASE_URL';

/**
 * What is wrong with a value, or `null` when nothing is.
 *
 * Two problems and not one, because the remedies read differently: `missing`
 * says *set it*, `not-an-absolute-http-url` says *you set it to this*. The
 * second is not hypothetical — `.gitlab-ci.yml`'s `build:storefront` passes
 * `--build-arg NEXT_PUBLIC_API_BASE_URL="https://${API_DOMAIN}"`, which with
 * `API_DOMAIN` unset is the non-empty, unusable `https://`.
 */
/** @typedef {'missing' | 'not-an-absolute-http-url'} EnvironmentProblem */

/**
 * The rule, written once.
 *
 * A blank value is `missing` rather than a bad URL: a `BACKEND_BASE_URL=` line
 * and an absent one are the same state for whoever has to fix it, and telling
 * them their URL is malformed sends them to look at a value that is not there.
 *
 * `http` and `https` only. A relative path cannot be joined to by the browser
 * fetchers that read it, and a `ftp:`/`file:` origin is not something this
 * storefront can call.
 *
 * @param {string | undefined} value
 * @returns {EnvironmentProblem | null}
 */
export function absoluteHttpUrlProblem(value) {
  if (value === undefined || value.trim().length === 0) return 'missing';
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return 'not-an-absolute-http-url';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'not-an-absolute-http-url';
  }
  if (parsed.host.length === 0) return 'not-an-absolute-http-url';
  return null;
}

/**
 * When each variable is read, which is what decides an operator's remedy.
 * @type {Readonly<Record<string, string>>}
 */
const WHEN_READ = {
  [PUBLIC_API_BASE_URL_VAR]:
    'It is the origin the browser calls the backend at, and Next inlines it into the ' +
    'browser bundle at build time — so it cannot be supplied later by a container, a ' +
    'process environment or an operator. It has to be right when `next build` runs.',
  [BACKEND_BASE_URL_VAR]:
    'It is the origin this storefront calls the backend at from its own server, read at ' +
    'run time by the process that serves the storefront — so set it on that process, not ' +
    'on the build.',
};

/**
 * The refusal, written once, in the estate's grammar: what was refused, and what
 * to do instead.
 *
 * The local remedy is named explicitly because it is the one case where the
 * answer really is `http://localhost:3001` and a developer should not have to
 * rediscover it — `storefront/.env.example` carries it, `README.md` § *Local
 * development* says to copy it, and Next loads `storefront/.env` before it loads
 * `next.config.js`.
 *
 * @param {string} name
 * @param {EnvironmentProblem} problem
 * @param {string | undefined} value
 * @returns {string}
 */
export function environmentRefusal(name, problem, value) {
  const what =
    problem === 'missing'
      ? `${name} is not set.`
      : `${name} is not an absolute http(s) URL: ${JSON.stringify(value)}.`;
  const why = WHEN_READ[name] ?? 'It is an address this storefront cannot invent.';
  return [
    `[storefront] ${what}`,
    '',
    why,
    '',
    `Set ${name} to the backend's origin, e.g. ${name}=https://api.example.com.`,
    'For local development, copy the file that already carries the right value:',
    '',
    '    cp storefront/.env.example storefront/.env',
    '',
    'This storefront no longer defaults the address. A default here is baked into every',
    'instance copied from this tree (D-195), which is how a shop can ship a bundle',
    "pointing every visitor at their own machine while the build reports success.",
  ].join('\n');
}

/**
 * The value, or a throw carrying {@link environmentRefusal}.
 *
 * @param {string} name
 * @param {string | undefined} value
 * @returns {string}
 */
export function requireAbsoluteHttpUrl(name, value) {
  const problem = absoluteHttpUrlProblem(value);
  if (problem !== null) throw new Error(environmentRefusal(name, problem, value));
  return /** @type {string} */ (value);
}

/**
 * The browser's backend origin.
 *
 * The `process.env['NEXT_PUBLIC_API_BASE_URL']` member expression has to appear
 * **literally** here: that is the text Next's define pass replaces, and a value
 * reached through a variable or a computed key is not replaced at all. Measured
 * on this tree — bracket notation is substituted exactly as dotted notation is.
 *
 * @returns {string}
 */
export function publicApiBaseUrl() {
  return requireAbsoluteHttpUrl(
    PUBLIC_API_BASE_URL_VAR,
    process.env['NEXT_PUBLIC_API_BASE_URL'],
  );
}

/**
 * The serving process's backend origin.
 *
 * Read per call rather than memoised at module scope, which is
 * `backend-reachability.ts`' measured reason: middleware sees the **runtime**
 * environment, so a container configured at start-up is served by a read that
 * happens then rather than at import.
 *
 * @returns {string}
 */
export function backendBaseUrl() {
  return requireAbsoluteHttpUrl(BACKEND_BASE_URL_VAR, process.env['BACKEND_BASE_URL']);
}
