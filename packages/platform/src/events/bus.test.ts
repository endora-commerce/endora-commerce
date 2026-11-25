import { describe, expect, it } from 'vitest';
import { EventBus, type EventBase } from './bus.js';

/**
 * Issue #1926 (`specs/186-aggregate-ports/` research R-16.1) — `afterScope`
 * defers work to the moment the enclosing `run` scope has succeeded, which on
 * the Command path is the moment the transaction has committed. The deferred
 * work runs, awaited, **before** the scope's buffered events dispatch, so a
 * subscriber never observes what the deferred work was there to replace (D-93).
 */

interface Ping extends EventBase {
  readonly n: number;
}

function harness() {
  const bus = new EventBus<{ ping: Ping }>();
  const log: string[] = [];
  bus.on('ping', (payload) => {
    log.push(`event:${payload.n}`);
  });
  const ping = (n: number): Ping => ({ eventId: `e${n}`, occurredAt: new Date(0).toISOString(), n });
  return { bus, log, ping };
}

describe('EventBus.afterScope', () => {
  it('inside a scope, runs after the scope function resolves and before the buffered events', async () => {
    const { bus, log, ping } = harness();
    await bus.run(async () => {
      bus.emit('ping', ping(1));
      await bus.afterScope(async () => {
        log.push('deferred:1');
      });
      await bus.afterScope(() => {
        log.push('deferred:2');
      });
      log.push('scope body done');
    });
    expect(log).toEqual(['scope body done', 'deferred:1', 'deferred:2', 'event:1']);
  });

  it('awaits each deferred function before the next and before any event', async () => {
    const { bus, log, ping } = harness();
    await bus.run(async () => {
      bus.emit('ping', ping(1));
      await bus.afterScope(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push('slow');
      });
      await bus.afterScope(() => {
        log.push('fast');
      });
    });
    expect(log).toEqual(['slow', 'fast', 'event:1']);
  });

  it('discards the deferred functions, like the events, when the scope throws', async () => {
    const { bus, log, ping } = harness();
    await expect(
      bus.run(async () => {
        bus.emit('ping', ping(1));
        await bus.afterScope(() => {
          log.push('deferred');
        });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(log).toEqual([]);
  });

  it('outside any scope, runs immediately and is awaited', async () => {
    const { bus, log } = harness();
    await bus.afterScope(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.push('deferred');
    });
    expect(log).toEqual(['deferred']);
  });

  it('inside a scope, resolves at once without running the function', async () => {
    const { bus, log } = harness();
    await bus.run(async () => {
      await bus.afterScope(() => {
        log.push('deferred');
      });
      log.push('after the call');
    });
    expect(log).toEqual(['after the call', 'deferred']);
  });

  it('belongs to the innermost scope: a nested scope runs its own on its own success', async () => {
    const { bus, log, ping } = harness();
    await bus.run(async () => {
      await bus.afterScope(() => {
        log.push('outer deferred');
      });
      await bus.run(async () => {
        bus.emit('ping', ping(2));
        await bus.afterScope(() => {
          log.push('inner deferred');
        });
      });
      log.push('outer body done');
    });
    expect(log).toEqual(['inner deferred', 'event:2', 'outer body done', 'outer deferred']);
  });

  it('a deferred function that throws fails the scope, and the buffered events are not dispatched', async () => {
    const { bus, log, ping } = harness();
    await expect(
      bus.run(async () => {
        bus.emit('ping', ping(1));
        await bus.afterScope(() => {
          throw new Error('drop failed');
        });
      }),
    ).rejects.toThrow('drop failed');
    expect(log).toEqual([]);
  });
});

describe('EventBus.run (unchanged behaviour)', () => {
  it('buffers events until the scope resolves and drops them on a throw', async () => {
    const { bus, log, ping } = harness();
    await bus.run(async () => {
      bus.emit('ping', ping(1));
      expect(log).toEqual([]);
    });
    expect(log).toEqual(['event:1']);
    await expect(
      bus.run(async () => {
        bus.emit('ping', ping(2));
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(log).toEqual(['event:1']);
  });

  it('dispatches immediately outside a scope', () => {
    const { bus, log, ping } = harness();
    bus.emit('ping', ping(3));
    expect(log).toEqual(['event:3']);
  });
});
