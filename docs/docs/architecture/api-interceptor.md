---
title: API Interceptor (Cross-Module Endpoint Extension)
---

# API Interceptor

The API Interceptor mechanism (feature `060`) lets a module attach behavior to an
HTTP endpoint **owned by another module** — gating a request before the handler
runs, or reshaping a successful response — without editing the target module or
any shared registry file (Constitution Principle I: cross-module interaction goes
through documented interfaces only). Reach for it when you need to *extend* an
endpoint in place; reach for the [overlay pattern](./overlay-pattern.md) when a
deployment must *replace* a whole unit (service, route, module); reach for the
in-process `EventBus` when you only need to *react after the fact* and the
request/response itself must not change.

## What an interceptor may do — and what it is guaranteed

- **Position in the lifecycle** — a `pre` interceptor runs after the route's own
  `preHandler` guards (`requireAdmin` / `requireCustomer` / API-key checks) and
  after Zod validation, immediately before the handler. A `post` interceptor
  runs at `preSerialization`, only for successful responses (`statusCode < 400`).
- **Ambient context** — interceptors execute inside the same ambient
  `TenantContext` (Principle XI) and see the resolved sales channel
  (Principle XII) as the endpoint itself; services called from an interceptor
  are scoped identically to services called from the handler.
- **Deterministic ordering** — within one endpoint and phase, interceptors run
  in ascending `order` (default `0`), ties broken lexicographically by
  `(module, id)`. The order is identical across restarts and independent of
  composition wiring order.
- **Lifecycle gating** — before each execution the dispatcher consults the
  module enabled-set; an interceptor whose owning module is disabled is skipped
  silently and resumes when the module is re-enabled.
- **Fail-closed boot validation** — every target is checked against the live
  route table in `onReady`, before any traffic. An unknown target (typo, route
  not mounted in this deployment), a `post` interceptor on a streaming endpoint,
  or a duplicate `(module, id)` **refuses startup** with an error naming the
  module, the interceptor id, and the target. Registering after `app.ready()`
  throws — the dispatch index is sealed.
- **Attribution** — every execution and failure is logged through a child logger
  pre-bound with `{interceptorModule, interceptorId, phase, interceptorTarget}`,
  so operators can always tell endpoint behavior from interceptor behavior.

Endpoints with no registered interceptors pay one `Map` lookup — nothing else.

## Anatomy of a registration

The registry handle arrives through the module's plugin factory options (core
modules) or through `OverlayModuleContext.apiInterceptors` (overlay modules) —
never by importing another module's internals. Registration happens during
composition, in the contributing module's own code:

```ts
apiInterceptors.register({
  module: 'loyalty',                 // owning module id — lifecycle-gates execution
  id: 'enrich-order-detail',         // unique within the module, kebab-case
  target: 'GET /api/v1/orders/:id',  // endpoint identity; string or string[]
  phase: 'post',                     // 'pre' | 'post'
  order: 100,                        // ascending; default 0
  handler,                           // phase-specific signature
});
```

The **endpoint identity** is the string `"<METHOD> /path/pattern"` with params
in `:param` form — e.g. `POST /api/v1/orders`,
`GET /api/v1/admin/orders/:id`. It is the same key the OpenAPI auto-registration
dedupes on, so it exists for every endpoint with zero retrofit, and it is as
stable as the API itself: changing a URL is a versioned breaking change
(Principle II).

## The two phases

**Pre** — observes the *validated* request data (`body`, `query`, `params`,
post-Zod) plus a read-only request view (`actor`, `salesChannel`, headers,
attribution logger). It may adjust the request body by mutating `ctx.body` or
by returning `{ body }`, and it may **veto** the request by throwing
`HttpError(status, code, message, details?)` with a registered `ErrorCode` from
`@b2b/contracts` — the handler then never runs.

**Post** — receives the un-serialized response `payload` (and the
`statusCode`, always `< 400`). Return a replacement payload, or `undefined` to
leave it unchanged. Post interceptors **never run on error responses**, and the
reshaped payload must stay conformant to the endpoint's published response
contract.

## Veto vs. unexpected failure

- **Veto** (pre only) is a normal business outcome: the thrown `HttpError`
  renders through the standard error envelope exactly like an endpoint-raised
  business error, with the chosen status and code, and is logged at `info` —
  not as a failure. Veto messages pass through the error-envelope i18n bridge
  like any module error: the human-readable `message` may be localized to the
  caller's preferred language, while `code` and `details` are preserved
  verbatim.
- **Unexpected failure** (any non-`HttpError` throw, either phase) is
  fail-closed: it is logged at `error` with full attribution and rethrown,
  yielding the standard `500 INTERNAL` envelope. The mechanism never skips a
  crashed interceptor and continues.

## Guardrails & non-goals

- **Auth is untouchable** — interceptors run only *after* the route's auth/authz
  guards. They can narrow access further (veto), never widen it.
- **Error responses are never mutated** — post interceptors do not run for
  `statusCode >= 400`, including envelopes produced by the error handler.
- **Post interceptors MUST be persistence-side-effect-free** — the endpoint's
  own write may already be committed when a post interceptor runs, so a
  post-phase crash cannot roll it back. Anything transactional belongs in a pre
  interceptor, a Command, or an EventBus subscriber.
- **Pre interceptors must not flush persistent state themselves** — a veto
  guarantees "nothing persisted" only if the interceptor itself wrote nothing.
- **No handler replacement or suppression** — an interceptor cannot swap out or
  short-circuit an endpoint's implementation. Whole-unit replacement is the
  [overlay pattern](./overlay-pattern.md)'s job.
- **Chained adjustments are last-writer-wins** — later interceptors see earlier
  interceptors' body/payload adjustments, in execution order.
- **Latency is the author's responsibility** — interceptor time is request time;
  the platform's request timeout applies to the whole chain.
- **HTTP boundary only** — internal service-to-service calls, background jobs,
  and EventBus events are *not* intercepted. Only requests crossing the HTTP
  surface run interceptors.
- **Streaming/binary endpoints reject the post phase** — routes annotated with
  `config: { streamingResponse: true }` (PDF/asset downloads, CSV exports)
  bypass serialization; a post interceptor targeting one fails boot validation.

## Worked example

A `compliance` module gates order placement on another module's endpoint
(pre + veto), and a `loyalty` module enriches the order detail (post):

```ts
// compliance/plugin.ts — pre-gate with veto
apiInterceptors.register({
  module: 'compliance',
  id: 'sanctions-gate',
  target: 'POST /api/v1/orders',
  phase: 'pre',
  handler: async ({ request, body }) => {
    const verdict = await screening.check(request.raw.actor);
    if (!verdict.ok) {
      throw new HttpError(422, ERROR_CODES.COMPLIANCE_SCREENING_FAILED, 'Order blocked by screening');
    }
    (body as PlaceOrderRequest).metadata = {
      ...(body as PlaceOrderRequest).metadata,
      screeningId: verdict.id,
    };
  },
});

// loyalty/plugin.ts — post-enrichment
apiInterceptors.register({
  module: 'loyalty',
  id: 'enrich-order-detail',
  target: 'GET /api/v1/orders/:id',
  phase: 'post',
  order: 100,
  handler: async ({ payload }) => ({
    ...(payload as object),
    loyaltyPoints: await points.forOrder(payload),
  }),
});
```

A failing screening returns the standard envelope with the `compliance` code
and **no order row exists**; a `404` from the order-detail route carries no
`loyaltyPoints` (post never runs on errors); disabling the `loyalty` module
restores the original response shape.

## Diagnostics

```
GET /api/v1/admin/api-interceptors      (permission: platform.modules.read)
```

returns every registration — target, phase, order, module, id — sorted in
execution order (target, then `pre` before `post`, then order/tie-break), with
`moduleEnabled` resolved live from the enabled-set at request time. The list
*is* the execution plan. Read-only: registrations are shipped module code, not
runtime data, so there is no write surface.

## Not the webhooks module

Do not confuse this mechanism with the `webhooks` module: webhooks deliver
platform events *outbound* to external HTTP consumers after the fact; API
interceptors act *inbound*, inside the platform's own request/response cycle.

See the feature spec, plan, and quickstart under `specs/060-api-interceptor/`
for the full contract.
