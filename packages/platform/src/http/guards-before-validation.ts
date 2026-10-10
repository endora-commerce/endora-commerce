import type { RouteOptions } from 'fastify';

/**
 * A route's guards run before its schema does.
 *
 * ## The defect this closes
 *
 * Every route surface gates itself the same way — `{ preHandler:
 * requireAdmin('catalog:write'), schema: { body } }` — and Fastify runs a
 * route's phases in one fixed order: `onRequest`, `preParsing`, the body
 * parser, `preValidation`, schema validation, `preHandler`, the handler. A
 * guard written as a `preHandler` is therefore the **last** thing to run before
 * the handler, so a caller with no session at all was answered by the
 * validator: `400 VALIDATION_FAILED`, with the field names and constraints of
 * an admin route's request shape in `details`, where the answer owed was `401`.
 * An administrator lacking the permission got the same `400` in place of `403`.
 *
 * ## The mechanism
 *
 * The `onRoute` listener below, installed by `buildServer` before any module
 * mounts, moves the `preHandler` chain **a route declares in its own options**
 * to that route's `preValidation`. Nothing else is rewritten, and the call site
 * does not change: `preHandler: requireAdmin('x')` is still what a route
 * writes, what the static readers parse, and what a module built against an
 * earlier platform already says.
 *
 * It is deliberately structural rather than a property of the guard. Most
 * composed modules hand their route surface a forwarding closure —
 * `(permission) => async (req, reply) => cradle().requireAdmin(permission)(req,
 * reply)` — because the container is not resolvable while routes are being
 * declared. A mark on the function `auth` returns would stop at that closure,
 * and the routes left behind would be exactly the ones nobody could tell apart
 * by reading them. Moving what the route declared covers every module —
 * packaged, overlay or third-party — with no edit to any of them, and fails
 * closed for the next one written.
 *
 * ## What a route-level `preHandler` may rely on
 *
 * `preValidation` runs after the body parser and before the schema. So a guard
 * sees the session, the headers, `request.params` and `request.query` as the
 * router produced them, and `request.body` **parsed but not validated** — any
 * JSON value at all, and no coercion or default the schema would apply.
 * A guard that reads the request must therefore tolerate any shape and refuse
 * or abstain on one it does not recognise, which the guards in this tree
 * already did: a session guard reads nothing, and the two that read a param or
 * a body field compare it against a literal.
 *
 * It is not `onRequest`, although that would also spare the parse: the body is
 * `undefined` there, and a guard that asks for a second permission *when the
 * body names an order* would silently ask for nothing.
 *
 * Work that needs the **validated** request belongs in the handler, in an API
 * interceptor (`ctx.interceptors`, which runs after validation), or in a
 * `preHandler` added with `addHook` on the module's own plugin scope — none of
 * which this listener touches.
 *
 * ## What stays ahead of a guard
 *
 * Everything `onRequest` does — the session resolver, the tenant scope, the
 * sales-channel resolver, a module's presence gate, the rate limiter — and the
 * body parser. So a request whose body cannot be parsed at all (malformed
 * JSON, an unsupported media type, a body over the limit) is still answered
 * `400`/`415`/`413` before any guard; that answer says nothing about the
 * route.
 */

function asList<T>(value: T | readonly T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T];
}

/**
 * The `onRoute` listener. Install it **before** any listener that appends a
 * platform-owned `preHandler` (the API interceptor dispatch does), so that what
 * it finds on the route is only what the route itself declared.
 *
 * It assigns new arrays to the per-route options object Fastify hands it and
 * mutates nothing it was given, so an options object or a guard list shared by
 * several routes is left as its author wrote it.
 */
export function makeGuardsBeforeValidationOnRoute(): (route: RouteOptions) => void {
  return (route: RouteOptions): void => {
    const guards = asList(route.preHandler);
    if (guards.length === 0) return;
    // The two hooks share one signature — `(request, reply)` for an async
    // function, `(request, reply, done)` for a callback — so a function written
    // for one is a valid instance of the other.
    route.preValidation = [
      ...asList(route.preValidation),
      ...(guards as unknown[]),
    ] as NonNullable<RouteOptions['preValidation']>;
    delete route.preHandler;
  };
}
