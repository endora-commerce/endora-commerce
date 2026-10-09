---
'@endora-commerce/platform': patch
---

A route's guards now run before the request is validated. A caller with no session was answered
`400 VALIDATION_FAILED` — with the route's field names and constraints in `details` — wherever a
guarded route also declared a schema the request failed, because Fastify validates before
`preHandler` and `preHandler` is where every route declares `requireAdmin(...)`,
`requireCustomer` or an API-key gate. An administrator without the permission got the same `400`
in place of `403`. Measured on the composed application: 184 of 720 `/api/v1/admin/**` routes, 2
further routes gated by `requireAdmin`, 38 routes gated by `requireCustomer` and 1 gated by
`requireApiKey`. All of them now answer `401`/`403` first.

`buildServer` installs an `onRoute` listener that moves the `preHandler` chain a route declares in
its own options to that route's `preValidation`. **No call site changes**: `preHandler:
requireAdmin('x')` is still what a route writes, including through a forwarding closure such as
`(permission) => async (req, reply) => cradle().requireAdmin(permission)(req, reply)`, and a
module built against an earlier platform is covered without being rebuilt. `requireAdmin`,
`requireAdminAny`, `requireCustomer`, `requireApiKey` and `requireBoundApiKey` are unchanged, and
so are the `401`/`403` bodies and the `400 VALIDATION_FAILED` body an authorised caller receives.

**Behaviour change for a module author — the one thing to check.** A function you pass as a
route's `preHandler` now runs after the body is parsed and **before** it is validated: it sees
`request.body` as any JSON value, and `request.params` / `request.query` without the coercions or
defaults the route's schema applies. A guard that reads the request has to tolerate any shape. If
a route-level `preHandler` of yours depends on the validated request, move that work into the
handler, into an API interceptor (`ctx.interceptors`, which still runs after validation), or into
a `preHandler` added with `addHook` on your plugin scope — the listener moves none of those. No
guard in the platform's own modules needed a change.

Not covered: a request the body parser refuses (malformed JSON, an unsupported media type, a body
over the limit) is still answered before any guard, and so is a route that checks the session
inside its handler instead of declaring a guard.
