import type { WebhookEventDescriptor, WebhookEventRegistryPort } from '@endora-commerce/contracts';

/**
 * The event types other modules offer for outbound delivery
 * (`specs/143-crm-sales-opportunities/research.md` R-27).
 *
 * This module bridges two event types of its own accord. Every other type
 * arrives here, pushed by the module that emits it from a contribution-only
 * boot hook, so that `webhooks` names no contributor's event and an event is
 * offered only while something can emit it.
 *
 * **A pushed type is bridged through this module's own gated subscription.**
 * `bridge` is handed in by the composition and is `ctx.subscribe` with the
 * delivery handler: the kernel wraps it in this module's effective state, so a
 * contributed type stops with `webhooks` at the same seam the built-in types
 * stop at, and nothing here consults the database. It is called the first time
 * a type is seen, and never for a type this module bridges already — which is
 * what keeps one event from being delivered twice.
 *
 * A push is accepted at any time, including after the boot phase: subscribing
 * is one call on the bus and needs no window. Registered ungated, because a
 * contributor's boot hook resolves it whether or not `webhooks` is switched on.
 */
export class WebhookEventRegistry implements WebhookEventRegistryPort {
  /** By event type, in registration order. The first contributor of a type is its owner. */
  private readonly descriptors = new Map<string, WebhookEventDescriptor>();

  constructor(
    private readonly options: {
      /** Whether a module is effectively present — asked per read, so a flip needs no restart. */
      isPresent: (moduleId: string) => boolean;
      /** Subscribe this module's delivery handler to one more event type. */
      bridge: (eventType: string) => void;
      /** The types the module bridges of its own accord; a contribution naming one is not bridged again. */
      alreadyBridged: readonly string[];
    },
  ) {}

  register(descriptor: WebhookEventDescriptor): void {
    if (this.descriptors.has(descriptor.eventType)) return;
    this.descriptors.set(descriptor.eventType, {
      ownerModuleId: descriptor.ownerModuleId,
      eventType: descriptor.eventType,
    });
    if (!this.options.alreadyBridged.includes(descriptor.eventType)) {
      this.options.bridge(descriptor.eventType);
    }
  }

  owners(): readonly string[] {
    return [...new Set([...this.descriptors.values()].map((descriptor) => descriptor.ownerModuleId))];
  }

  list(): readonly WebhookEventDescriptor[] {
    return [...this.descriptors.values()].filter((descriptor) =>
      this.options.isPresent(descriptor.ownerModuleId),
    );
  }
}
