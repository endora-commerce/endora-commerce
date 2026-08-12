/**
 * Bookkeeping for the invalidation window of a two-layer cache (Redis + a
 * per-process LRU), shared by `SettingsCache` and `SalesChannelsCache`.
 *
 * Both caches invalidate the same way, for the reasons MR !449 established:
 * drop the **shared** layer first, because it is the layer that outlives this
 * process and would otherwise be re-pulled into every other process's LRU, and
 * because it is the step that can fail. A half-done invalidation must degrade
 * to "slower but correct", never to "fast and wrong", which needs two marks:
 *
 *   - `draining` — a drop for this prefix is on the wire. Reads bypass both
 *     layers and writes do not repopulate them, because the notification that
 *     triggered the drop is dispatched fire-and-forget and a read routinely
 *     lands mid-invalidation.
 *   - `failed` — the shared drop threw, so Redis may still hold the
 *     pre-invalidation value. The prefix stays marked until a later drop
 *     succeeds; reads keep bypassing the cache (and keep retrying the drop)
 *     rather than being served a value the invalidation was supposed to remove.
 *
 * It is deliberately just the bookkeeping: the caller owns the drop, so the
 * retry stays where the key layout and the scan count are known.
 */
export class SharedDropMarks {
  /** Key prefixes whose shared drop is on the wire right now, by depth. */
  private readonly draining = new Map<string, number>();
  /** Key prefixes whose shared drop threw; the shared layer may be stale. */
  private readonly failed = new Set<string>();

  /** True when neither mark is set — the hot path's early exit. */
  get isClean(): boolean {
    return this.draining.size === 0 && this.failed.size === 0;
  }

  begin(prefix: string): void {
    this.draining.set(prefix, (this.draining.get(prefix) ?? 0) + 1);
  }

  finish(prefix: string): void {
    const depth = (this.draining.get(prefix) ?? 1) - 1;
    if (depth <= 0) this.draining.delete(prefix);
    else this.draining.set(prefix, depth);
  }

  markFailed(prefix: string): void {
    this.failed.add(prefix);
  }

  /** A successful drop also retires any narrower outstanding failure. */
  retireFailedUnder(prefix: string): void {
    for (const p of this.failed) {
      if (p.startsWith(prefix)) this.failed.delete(p);
    }
  }

  isDraining(key: string): boolean {
    for (const prefix of this.draining.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  /** The outstanding failed prefix covering `key`, so the caller can retry it. */
  failedPrefixFor(key: string): string | undefined {
    for (const prefix of this.failed) {
      if (key.startsWith(prefix)) return prefix;
    }
    return undefined;
  }
}
