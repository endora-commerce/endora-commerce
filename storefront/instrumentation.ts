import { BACKEND_BASE_URL_VAR, absoluteHttpUrlProblem, environmentRefusal } from './lib/env.mjs';

/**
 * The serving process refuses to start without knowing where its backend is.
 *
 * ## Why here
 *
 * `BACKEND_BASE_URL` is the *server's* view of the backend and is read at run
 * time — `deploy/compose.prod.yml` sets it on the container, `next build` is not
 * given it at all, and `backend-reachability.ts` reads it per call precisely so
 * that a container configured at start-up is honoured. So its refusal cannot
 * live in `next.config.ts` beside `NEXT_PUBLIC_API_BASE_URL`'s: a standalone
 * build never evaluates that file again (`next/dist/server/config.js` returns a
 * serialised config), and demanding the value at build time would break an image
 * that is correctly configured at `docker run`.
 *
 * `register()` is the earliest point in the serving process — Next calls it once
 * at server start, before the first request reaches middleware or a render. So a
 * misconfigured container crash-loops visibly instead of answering `500` to
 * every visitor, which is the difference between an operator seeing the problem
 * and a buyer seeing it.
 *
 * ## The discrimination this preserves
 *
 * `middleware.ts` answers `503` with a designed page when the backend is
 * *unreachable*. **Unreachable and unconfigured are different failures**, and
 * only the first is temporary: a `503` with a `Retry-After` promises a backend
 * that is coming back, which is a lie about an address nobody ever set. Refusing
 * at start-up keeps the two apart structurally — a storefront with no
 * `BACKEND_BASE_URL` never reaches the point of having a status line to answer
 * with, so the `503` path can only ever mean what it says.
 *
 * ## Why `process.exit` and not a throw
 *
 * A throw out of `register()` is reported through Next's own instrumentation
 * frames, and the sentence an operator has to act on should not arrive inside a
 * stack trace. Exit 1 is also what a container orchestrator reads as "this did
 * not start".
 *
 * The `NEXT_RUNTIME` guard is Next's own idiom: `register()` is compiled for
 * every runtime that is instrumented, and `process.exit` does not exist in the
 * edge one. The node server hosts the edge middleware, so asking once in the
 * node runtime covers both.
 */
export function register(): void {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const value = process.env[BACKEND_BASE_URL_VAR];
  const problem = absoluteHttpUrlProblem(value);
  if (problem === null) return;
  process.stderr.write(`${environmentRefusal(BACKEND_BASE_URL_VAR, problem, value)}\n`);
  process.exit(1);
}
