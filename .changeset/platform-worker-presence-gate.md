---
'@endora-commerce/platform': minor
---

`defineModuleWorker` now stops a queue consumer whose module is switched off, on **both**
presence axes and in **every** process (Constitution XVII).

Before this, `pauseWorkersFor` was the only thing that could stop a worker, and it had two
call sites — both on the platform-availability axis, inside the lifecycle orchestrator's
`disable`. A business operator's deactivation refreshed the presence cache, took the module's
routes to 503 and left the BullMQ worker consuming. `pauseWorkersFor` is also process-local:
it iterates a registry the calling process filled, so it never reached a `BACKEND_ROLE=worker`
process, and never reached anything at all from the `module:*` CLI, which composes no modules.

Two gates, both reading the `ModuleRegistryCache` that every composed process already keeps
fresh from `b2b:module:state-changed`:

- **the fetch gate** — every presence install reconciles every registered worker to
  `effectiveState.isPresent`, pausing the absent and resuming the present. Level-triggered and
  idempotent, so a missed notification is retried by the degraded-mode refresh rather than
  lost.
- **the work gate** — `defineModuleWorker` wraps the worker's processor, so a job already
  fetched when presence flipped does not run.

**A refused job is left waiting**, never failed and never dropped: the work gate uses BullMQ's
`Worker.rateLimit` + `RateLimitError`, which returns the job to the wait list with no attempt
consumed and no `failed` event, and it drains when the module comes back.

New API on `ModuleRegistryCache`:

```ts
const stop = registryCache.onPresenceInstalled(() => reconcileMyThing());
```

Called on every presence install — the pub/sub refresh, the degraded-mode refresh, the cold
load. Use it where `presenceVersion()` is not enough because the thing you own is stateful
rather than memoised. Listeners must be idempotent; their throws are contained and logged.

Also exported from `kernel/lifecycle/plugin-helpers`: `reconcileModuleWorkers()` and the test
seam `resetModuleWorkersForTesting()`.

**One behavioural requirement on callers.** `defineModuleWorker` now **throws** when the value
it is given carries no BullMQ processor, instead of registering a worker it cannot gate. A
hand-written stub passed as `as unknown as Worker` must supply `processFn`, `isPaused()` and
`on()` alongside `pause()` / `resume()`; a real `Worker` already does.
