---
'@endora-commerce/platform': minor
---

`InProcessCacheRegistry` now carries the platform's cross-process cache
invalidation, so a module can drop a snapshot on a module-state change without
naming the Redis channel that announces it (D-174).

Two additions to `@endora-commerce/platform/kernel`, both on the already
published `InProcessCacheRegistry`:

- `register(namespace, layer, opts?)` takes a third argument,
  `{ invalidateOnModuleStateChange?: boolean }`, default `false`. Existing
  two-argument calls are unaffected and keep the old behaviour exactly.
- `invalidateForModuleStateChange(): Promise<void>` drops every layer that
  opted in. Every layer is started synchronously before the first `await`, and a
  layer that throws is reported and skipped rather than propagated.

`ModuleRegistryCache.watch` calls it on each `b2b:module:state-changed` message,
before the PostgreSQL refresh — so the drop lands on receipt.

Why a consumer would want it: `registryCache.presenceVersion()` is a content
hash of the two presence axes and of nothing else, so a cache derived from what
an install *rewrites* — a module's command-palette rows, another module's
translation bundles — is structurally blind to those inputs. The notification is
the only cross-process announcement of them, and it is not something a module
should be subscribing to itself: the channel is a transport detail and the
payload is one the consumer does not read.

```ts
import { inProcessCaches } from '@endora-commerce/platform/kernel';

const unregister = inProcessCaches.register(
  'my_module',
  { invalidateAll: async () => { cache.clear(); return 0; } },
  { invalidateOnModuleStateChange: true },
);
```

Opt in only where the layer's content really is derived from module state. A
layer that owns a Redis key space clears it with SCAN+DEL, and running that in
every API and worker process on every operator flip is a storm — which is why
the flag exists instead of the notification dropping everything registered.
