import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_BUILT_IN_EVENT_TYPES,
  deliverableWebhookEventTypes,
  type WebhookEventRegistryPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { BRIDGED_EVENT_TYPES, registerModule } from './index.js';

/**
 * What the form offers. `WebhooksPage.tsx` renders one checkbox per element of
 * this function's answer over `GET /api/v1/admin/webhooks/event-types` and
 * keeps no list of its own — `admin/test/modules/webhooks/` holds that half.
 */
const offeredEventTypes = deliverableWebhookEventTypes;

/**
 * What the subscription form offers is what the bridge delivers.
 *
 * The form used to carry a list of its own — thirteen names, of which the
 * backend bridged two — so an operator could subscribe to an event that would
 * never arrive. Both sides now read one constant from the contracts package,
 * and this file is what holds them together: it composes the module against a
 * recording context and compares the event types it **subscribed its bridge
 * to** with the event types the form **offers** for the same contributions.
 * The same function also decides which names a write accepts
 * (`WebhookService`), so "offered", "accepted" and "bridged" are one set.
 */

interface Registration {
  build: (cradle: unknown) => unknown;
}

/** `ctx.asFunction(...).singleton().disposer(...)` — the registration is kept, the options are not. */
function registration(build: (cradle: unknown) => unknown): Registration & Record<string, unknown> {
  const self: Registration & Record<string, unknown> = { build };
  self['singleton'] = () => self;
  self['disposer'] = () => self;
  return self;
}

function compose(): { subscribed: string[]; registry: WebhookEventRegistryPort } {
  const subscribed: string[] = [];
  const registered = new Map<string, Registration>();
  const ctx = {
    asFunction: registration,
    di: {
      providePort: (name: string, value: Registration) => registered.set(name, value),
      register: (entries: Record<string, Registration>) => {
        for (const [name, value] of Object.entries(entries)) registered.set(name, value);
      },
    },
    subscribe: (eventType: string) => {
      subscribed.push(eventType);
    },
    routes: () => undefined,
    cradle: () => ({}),
  } as unknown as ModuleContext;

  registerModule(ctx);
  const registry = registered.get('webhookEventRegistry')?.build({}) as WebhookEventRegistryPort;
  return { subscribed, registry };
}

describe('webhooks — the bridged set equals the offered set', () => {
  it('bridges exactly the built-in event types when nothing is contributed, and the form offers exactly those', () => {
    const { subscribed } = compose();
    expect(subscribed).toEqual([...WEBHOOK_BUILT_IN_EVENT_TYPES]);
    expect(offeredEventTypes([])).toEqual(subscribed);
  });

  it('bridges from the contracts constant — the module keeps no list of its own', () => {
    expect(BRIDGED_EVENT_TYPES).toBe(WEBHOOK_BUILT_IN_EVENT_TYPES);
  });

  it('bridges a contributed type once, and the form offers it once — the two sets stay equal', () => {
    const { subscribed, registry } = compose();
    registry.register({ ownerModuleId: 'acme_loyalty', eventType: 'acme_loyalty.points_granted.v1' });
    registry.register({ ownerModuleId: 'acme_loyalty', eventType: 'acme_loyalty.points_granted.v1' });
    // A contributor naming a built-in type adds nothing to either side.
    registry.register({ ownerModuleId: 'orders', eventType: 'order.created.v1' });

    const contributed = ['acme_loyalty.points_granted.v1', 'order.created.v1'];
    expect(subscribed).toEqual([...WEBHOOK_BUILT_IN_EVENT_TYPES, 'acme_loyalty.points_granted.v1']);
    expect(offeredEventTypes(contributed)).toEqual(subscribed);
  });

  it('offers nothing the bridge was never subscribed to — the eleven names the form used to carry are gone', () => {
    const { subscribed } = compose();
    for (const eventType of [
      'product.created.v1',
      'product.updated.v1',
      'product.archived.v1',
      'rfq.created.v1',
      'rfq.quoted.v1',
      'rfq.accepted.v1',
      'rfq.expired.v1',
      'order.cancelled.v1',
      'payment.settled.v1',
      'credit_limit.adjusted.v1',
      'credit_limit.reservation_released.v1',
    ]) {
      expect(subscribed).not.toContain(eventType);
      expect(offeredEventTypes([])).not.toContain(eventType);
    }
  });
});
