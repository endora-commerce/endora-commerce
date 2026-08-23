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
 */
export interface InProcessCacheLayer {
  /**
   * Drop every entry in this namespace across **both** layers, shared layer
   * first and with the key prefix marked for the whole operation. Returns the
   * number of shared keys deleted, which is what the operator is shown.
   */
  invalidateAll(): Promise<number>;
}

export class InProcessCacheRegistry {
  private readonly layers = new Map<string, InProcessCacheLayer>();

  /**
   * Register this process's layer for `namespace`. Returns the unregister
   * function; a second composition root in the same process (the test harness
   * builds one per file) replaces the entry, so the registry always names the
   * live cache rather than a discarded one.
   */
  register(namespace: string, layer: InProcessCacheLayer): () => void {
    this.layers.set(namespace, layer);
    return () => {
      if (this.layers.get(namespace) === layer) this.layers.delete(namespace);
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
    const layer = this.layers.get(namespace);
    if (!layer) return undefined;
    return layer.invalidateAll();
  }
}

/** Process singleton, read by the settings module's cache-maintenance service. */
export const inProcessCaches = new InProcessCacheRegistry();
