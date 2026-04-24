/**
 * In-process typed event bus (R-17). Every module emits named events here; other
 * modules and the webhook bridge subscribe. Durable delivery (retries, external URLs)
 * is handled by the webhook-delivery worker — this bus is in-process only.
 *
 * Emissions are buffered inside a per-request scope (if an ambient scope exists) so
 * an aborted transaction does not leak half-domain events. Outside of a scope the
 * handlers fire synchronously.
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface EventBase {
  eventId: string;
  occurredAt: string;
}

type Handler<P> = (payload: P) => void | Promise<void>;

interface Scope {
  pending: Array<{ eventName: string; payload: unknown }>;
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
   * Run fn inside a scope that buffers emitted events. If fn succeeds, buffered events
   * are dispatched. If fn throws, they are dropped.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const scope: Scope = { pending: [] };
    return scopeStorage.run(scope, async () => {
      const result = await fn();
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
