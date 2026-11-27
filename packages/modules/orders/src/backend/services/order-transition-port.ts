import type {
  OrderCommandPort,
  OrderReadPort,
  OrderStatusActor,
  OrderTransitionOutcome,
  OrderTransitionPort,
} from '@endora-commerce/contracts';

/**
 * The lifecycle write `orders` published in feature 085 (Phase B) —
 * **deprecated since 0.113.0** (`specs/186-aggregate-ports/` US4, T060): both
 * methods delegate, `applyStatus` to `orderCommandPort.applyStatus` and
 * `isTerminal` to `orderReadPort.isTerminal`, so a caller that has not moved
 * yet writes the same Command, records the same entry and reads the same
 * outcome as one that has.
 *
 * The input `actor` is not taken any more (an actor is never input,
 * Principle XIII; research R-17.7, R-18.2): the entry records the ambient
 * actor, as every Command does, and `actor.source` travels as the caller's
 * `source` code — which the events' actor is derived from again on the other
 * side. Removed in 0.114.0 (US12).
 */
export class OrderTransitionPortService implements OrderTransitionPort {
  constructor(
    /** Resolved per call (`lazyPort`): both registrations are singletons and a gate may not be frozen inside one. */
    private readonly commands: () => Pick<OrderCommandPort, 'applyStatus'>,
    private readonly reads: () => Pick<OrderReadPort, 'isTerminal'>,
  ) {}

  async applyStatus(input: {
    orderId: string;
    to: string;
    actor: OrderStatusActor;
    reason?: string | null;
  }): Promise<OrderTransitionOutcome> {
    const source = input.actor.source;
    return this.commands().applyStatus(
      input.orderId,
      { to: input.to, reason: input.reason ?? null },
      source !== undefined ? { source } : {},
    );
  }

  async isTerminal(orderId: string): Promise<boolean | null> {
    return this.reads().isTerminal(orderId);
  }
}
