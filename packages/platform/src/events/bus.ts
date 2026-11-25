/**
 * In-process typed event bus (R-17). Every module emits named events here; other
 * modules and the webhook bridge subscribe. Durable delivery (retries, external URLs)
 * is handled by the webhook-delivery worker — this bus is in-process only.
 *
 * Emissions are buffered inside a per-request scope (if an ambient scope exists) so
 * an aborted transaction does not leak half-domain events. Outside of a scope the
 * handlers fire synchronously.
 *
 * A scope also holds work deferred through {@link EventBus.afterScope} (issue
 * #1926): it runs once the scope's function has resolved — on the Command path,
 * once the transaction has committed — and before the buffered events dispatch.
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface EventBase {
  eventId: string;
  occurredAt: string;
}

type Handler<P> = (payload: P) => void | Promise<void>;

interface Scope {
  pending: Array<{ eventName: string; payload: unknown }>;
  deferred: Array<() => void | Promise<void>>;
}

const scopeStorage = new AsyncLocalStorage<Scope>();

export class EventBus<Events extends Record<string, EventBase> = Record<string, EventBase>> {
  private readonly handlers = new Map<string, Array<Handler<unknown>>>();

  on<K extends keyof Events & string>(eventName: K, handler: Handler<Events[K]>): () => void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as Handler<unknown>);
    this.handlers.set(eventName, list);
    return () => {
      const current = this.handlers.get(eventName);
      if (!current) return;
      const idx = current.indexOf(handler as Handler<unknown>);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  emit<K extends keyof Events & string>(eventName: K, payload: Events[K]): void {
    const scope = scopeStorage.getStore();
    if (scope) {
      scope.pending.push({ eventName, payload });
      return;
    }
    void this.dispatch(eventName, payload);
  }

  /**
   * Defer `fn` until the enclosing {@link run} scope has succeeded (issue #1926,
   * `specs/186-aggregate-ports/` research R-16.1).
   *
   * Inside a scope, `fn` is queued on the innermost one and the returned promise
   * resolves at once. When the scope's function resolves, the queued functions
   * run in the order they were deferred, each awaited, and only then do the
   * scope's buffered events dispatch — so a subscriber never observes what the
   * deferred work exists to replace (D-93: an access-cache drop precedes the
   * event). When the scope's function throws, the queue is discarded with the
   * events. The Command Bus wraps its transaction in a scope, so for a Command —
   * its child Commands included — "the scope succeeded" means "committed".
   *
   * Outside any scope there is nothing to wait for, and `fn` runs and is awaited
   * immediately.
   *
   * Unlike an event handler, a deferred function is part of the write that
   * deferred it and is not isolated: if it throws, the scope rejects with its
   * error and the buffered events are not dispatched. A function deferred here
   * should therefore not fail for a reason the write cannot answer for — the
   * access-cache drop degrades to `null` rather than throwing.
   */
  afterScope(fn: () => void | Promise<void>): Promise<void> {
    const scope = scopeStorage.getStore();
    if (scope) {
      scope.deferred.push(fn);
      return Promise.resolve();
    }
    return Promise.resolve().then(fn);
  }

  /**
   * Run fn inside a scope that buffers emitted events. If fn succeeds, the work
   * deferred through {@link afterScope} runs, then the buffered events are
   * dispatched. If fn throws, both are dropped.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const scope: Scope = { pending: [], deferred: [] };
    return scopeStorage.run(scope, async () => {
      const result = await fn();
      for (const deferred of scope.deferred) {
        await deferred();
      }
      for (const entry of scope.pending) {
        await this.dispatch(entry.eventName, entry.payload);
      }
      return result;
    });
  }

  private async dispatch(eventName: string, payload: unknown): Promise<void> {
    const list = this.handlers.get(eventName);
    if (!list || list.length === 0) return;
    for (const handler of list) {
      try {
        await handler(payload);
      } catch (err) {
        // Handlers are isolated; one failure MUST NOT break the others or the emitter.
        // Logging is delegated to the Fastify request logger where available.
        console.warn(JSON.stringify({ level: 'warn', msg: 'event handler threw', eventName, error: String(err) }));
      }
    }
  }
}

/** Singleton used by the backend. Tests construct their own instance. */
export const eventBus = new EventBus();
