---
'@endora-commerce/platform': minor
'@endora-commerce/test-kit': minor
'@endora-commerce/contracts': patch
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-search': minor
---

The liveness and readiness probe is the platform's, and `@endora-commerce/mod-health-checks` is gone.

`GET /api/v1/_health` is now registered by `@endora-commerce/platform` itself: `composeApp`
puts `healthRoutePlugin({ orm, redis })` at the head of the module plugins it returns, and
`composeTestServer` does the same, so an instance serves the probe because it is an Endora
instance rather than because a module the scaffolder happened to select is installed. It was
not: `endora new instance` writes the closure over the modules declaring
`activation.nonDeactivatable`, `health_checks` declared no activation block at all, and no
manifest named it as a dependency — so a scaffolded instance answered 404 on the route
`deploy/compose.prod.yml` healthchecks, its API container never became healthy, and its
storefront, which waits on `service_healthy`, never started. Moving the route also closes the
withdrawal: `assertDeactivatable` returns early for a module with no activation block, so
`module:uninstall health_checks` was accepted and an operator could take the liveness endpoint
off a running instance with one command. Owner ruling D-229.

**What a consumer has to do.** Nothing, if the instance composes through `composeApp` or
`composeTestServer` — the route arrives with the platform. Remove
`@endora-commerce/mod-health-checks` from the instance manifest; it no longer resolves. The
route, its path, its payload and its status codes are unchanged.

`@endora-commerce/platform/composition` gains `healthRoutePlugin`, `registerHealthRoutes`,
`platformHealthProbes`, `healthResponseSchema`, `HealthDeps`, `HealthProbeSources` and
`HealthResponse`. No new subpath: `./http` is untouched, because no module names any of this.

`MEILISEARCH_URL` and `npm_package_version` are declared by the platform now, with the
sentences the dissolved manifest carried. `@endora-commerce/mod-search` therefore stops
declaring `MEILISEARCH_URL` — one variable may not carry two descriptions, and a module may not
describe a platform input — while continuing to read it and to declare
`MEILISEARCH_API_KEY`. **An operator-visible consequence:** the surviving declaration is
`optional`, where `search`'s was `required`. Both readers have always defaulted to
`http://localhost:7700`, so the requirement was aspirational, but a prompt built from these
declarations will no longer insist on the value.
