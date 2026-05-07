import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { subscribeForModule } from '../../../src/modules/_lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';
import { EventBus } from '../../../src/events/bus.js';

/**
 * Integration test for FR-015 — disable mutes event subscribers (US3).
 *
 * `subscribeForModule(moduleId, bus, event, handler)` MUST wrap the
 * handler so it no-ops when the module is disabled.
 */

describe('subscribeForModule — handler is no-op when module disabled (integration)', () => {
  let bus: EventBus<{
    'fixture.event': { eventId: string; occurredAt: string; payload: number };
  }>;
  let invocations: number[] = [];
  let unsubscribe: () => void;

  beforeAll(() => {
    bus = new EventBus();
    unsubscribe = subscribeForModule(
      'fixture_events',
      bus,
      'fixture.event',
      (payload) => {
        invocations.push(payload.payload);
      },
    );
  });

  beforeEach(() => {
    invocations = [];
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting([]);
  });

  afterAll(() => {
    unsubscribe();
    registryCache.__setEnabledForTesting([]);
  });

  it('does NOT invoke the handler when the module is disabled', async () => {
    registryCache.__setEnabledForTesting([]);
    bus.emit('fixture.event', {
      eventId: 'e1',
      occurredAt: new Date().toISOString(),
      payload: 1,
    });
    // Allow microtasks to drain.
    await new Promise((resolve) => setImmediate(resolve));
    expect(invocations).toEqual([]);
  });

  it('invokes the handler when the module is enabled', async () => {
    registryCache.__setEnabledForTesting(['fixture_events']);
    bus.emit('fixture.event', {
      eventId: 'e2',
      occurredAt: new Date().toISOString(),
      payload: 42,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(invocations).toEqual([42]);
  });
});
