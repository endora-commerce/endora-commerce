/**
 * The caches that keep a per-process layer in front of Redis, by the namespace
 * key the operator-facing "clear cache" surface uses.
 *
 * Six of the eight clearable namespaces are Redis-only, so SCAN+DEL over the
 * key space is a complete clear for them. Two are not: `settings` and
 * `sales_channels` each hold a per-process LRU, and dropping only the Redis
 * keys leaves every warm process serving the value it had already resolved —
 * which the next read then re-pins into Redis. The operator gets a green
 * confirmation and an unchanged system.
 *
 * The clear therefore has to reach the object that owns both layers, and this
 * is how it finds it. A registry rather than an injected dependency because
 * the two caches live in the kernel while the clear surface is a route of the
 * `settings` module: a module may not reach into another module for an
 * instance, and threading two handles through every composition root to reach
 * one maintenance button is a lot of wiring for a rare action.
 *
 * Nothing here is required: a process that registered no layer — the
 * `cache:clear` CLI, a unit test — clears the Redis keys and is correct,
 * because it has no in-memory layer to be stale.
 *
 * **The second reader is the platform's own module-state notification**
 * (D-174). A per-process cache derived from what an install rewrites —
 * `module_actions` rows, another module's translation bundles — cannot see
 * those inputs move: `registryCache.presenceVersion()` is a content hash of the
 * two presence axes and of nothing else, so a consumer polling it is
 * structurally blind to them. What does announce them is
 * `b2b:module:state-changed`, and a module may not name that channel — it is a
 * transport detail of `kernel/lifecycle/registry-cache.ts`, carrying a payload
 * the consumer does not even read. So the kernel's own subscriber calls
 * {@link InProcessCacheRegistry.invalidateForModuleStateChange} and a module
 * registers a layer that opts in. Same argument as the paragraph above, one
 * seam further: a module may not reach into the platform for an instance, and
 * the registry is where it says what it owns instead.
 *
 * The opt-in is deliberate and is not a convenience. `settings` and
 * `sales_channels` clear a **Redis** key space with SCAN+DEL, and running that
 * in every API and worker process on every operator flip is a storm nobody
 * asked for — and a cold settings cache platform-wide, for a write those caches
 * already invalidate at their own seam.
 */
export interface InProcessCacheLayer {
  /**
   * Drop every entry in this namespace across **both** layers, shared layer
   * first and with the key prefix marked for the whole operation. Returns the
   * number of shared keys deleted, which is what the operator is shown.
   */
  invalidateAll(): Promise<number>;
}

interface RegisteredLayer {
  readonly layer: InProcessCacheLayer;
  readonly invalidateOnModuleStateChange: boolean;
}

export class InProcessCacheRegistry {
  private readonly layers = new Map<string, RegisteredLayer>();

  /**
   * Register this process's layer for `namespace`. Returns the unregister
   * function; a second composition root in the same process (the test harness
   * builds one per file) replaces the entry, so the registry always names the
   * live cache rather than a discarded one.
   *
   * `invalidateOnModuleStateChange` declares that this layer's content is
   * derived from what an install, an uninstall or an operator's activation flip
   * rewrites, so the platform's module-state notification must drop it in every
   * process. Default `false`: see the header for why a blanket drop would be
   * wrong for a layer that owns Redis keys.
   */
  register(
    namespace: string,
    layer: InProcessCacheLayer,
    opts?: { readonly invalidateOnModuleStateChange?: boolean },
  ): () => void {
    const entry: RegisteredLayer = {
      layer,
      invalidateOnModuleStateChange: opts?.invalidateOnModuleStateChange === true,
    };
    this.layers.set(namespace, entry);
    return () => {
      if (this.layers.get(namespace) === entry) this.layers.delete(namespace);
    };
  }

  has(namespace: string): boolean {
    return this.layers.has(namespace);
  }

  /**
   * Clear the namespace through its owning cache, or `undefined` when nothing
   * registered one — the caller then falls back to clearing the shared layer
   * by key pattern.
   */
  async clear(namespace: string): Promise<number | undefined> {
    const entry = this.layers.get(namespace);
    if (!entry) return undefined;
    return entry.layer.invalidateAll();
  }

  /**
   * Drop every layer that declared itself derived from module state. Called by
   * the kernel's `b2b:module:state-changed` subscriber, in every process that
   * armed it.
   *
   * Every layer is **started synchronously**, before the first `await`: the
   * notification's whole value over the presence-version pull is that the drop
   * lands on receipt rather than a PostgreSQL round-trip later, and awaiting
   * layer by layer would give that away for the second one onwards.
   *
   * A layer that throws is reported and skipped rather than propagated. The
   * caller is a pub/sub handler with nowhere to throw to, and one bad consumer
   * must not stop the refresh every gating seam depends on.
   */
  async invalidateForModuleStateChange(): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const [namespace, entry] of this.layers) {
      if (!entry.invalidateOnModuleStateChange) continue;
      try {
        pending.push(
          Promise.resolve(entry.layer.invalidateAll()).catch((err: unknown) => {
            warnLayerFailed(namespace, err);
          }),
        );
      } catch (err: unknown) {
        // A layer whose `invalidateAll` threw synchronously never produced a
        // promise to attach the handler above to.
        warnLayerFailed(namespace, err);
      }
    }
    await Promise.all(pending);
  }
}

function warnLayerFailed(namespace: string, err: unknown): void {
  console.warn(
    `[in-process-cache] "${namespace}" failed to invalidate on a module-state change: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
}

/** Process singleton, read by the settings module's cache-maintenance service. */
export const inProcessCaches = new InProcessCacheRegistry();
