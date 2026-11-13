---
'@endora-commerce/test-kit': minor
---

**`@endora-commerce/test-kit/module`** (issue #1072): `composeModuleForTest({ module: { id, version?, registerModule }, values? })` composes one module the way a composition root does, with no server and no database. It creates a root container, registers the supplied values (and the handle's `eventBus`), and runs the module's `registerModule` against a fresh context and registration sink. It returns `{ container, context, registrations, eventBus, registryCache, dispose }`. `registryCache.setEnabled(ids)` sets the presence that the module's subscriptions and ports are gated on. `dispose()` unsubscribes the module and leaves nothing enabled. Module packages' own unit tests use it instead of the host-internal `@endora-commerce/platform/composition` subpath. The platform primitives it is built from are not re-exported.
