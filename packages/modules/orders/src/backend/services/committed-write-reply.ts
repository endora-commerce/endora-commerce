import type { OrderCommittedWritePartial } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled, type PlatformLogger } from '@endora-commerce/platform/kernel';

/**
 * The reply to a request whose write has **already committed**
 * (`specs/142-order-transition-atomicity/`, FR-002).
 *
 * A status route applies the transition and then reads the order's lines, its
 * status label and its promotions back to build the response. Those reads are
 * the last thing that could still fail after the commit — measured: under pool
 * pressure they were what turned thirty committed cancellations into 500s —
 * and a failure there must not be reported as a failure of the change. An
 * error tells the caller the order did not move; it did.
 *
 * So when the full response cannot be produced, the caller is answered with
 * what was written — the order's id, number and two statuses, which need no
 * read — and `meta.partial` says the rest is missing. A client that needs the
 * whole order reads it again; none is told a committed change failed.
 *
 * The shape is published: `orderCommittedWritePartialResponseSchema` in
 * `@endora-commerce/contracts`.
 */
/** The order facts a reply can state without reading anything. */
export interface CommittedOrderFacts {
  readonly id: string;
  readonly businessId: string;
  readonly status: string;
  readonly paymentStatus: string;
}

export async function replyAfterCommittedWrite(
  order: CommittedOrderFacts,
  serialize: () => Promise<Record<string, unknown>>,
  log?: PlatformLogger,
): Promise<
  | { data: Record<string, unknown> }
  | { data: OrderCommittedWritePartial; meta: { partial: true } }
> {
  try {
    return { data: await serialize() };
  } catch (error) {
    // First, and unconditionally (module-composition item 7). The serialisers
    // behind this reach other modules' ports — the buyer's reply asks
    // `payment_methods` whether the order is still cancellable — and a module
    // switched off underneath one is a statement about the platform, never
    // something to fold into "the response could not be read". It surfaces as
    // the 503 it is; the change stays committed and its follow-ups recorded,
    // which is the same residue the transition itself accepts.
    rethrowIfModuleDisabled(error);
    log?.warn(
      { orderId: order.id, error: error instanceof Error ? error.message : String(error) },
      'orders: the change was committed but its response could not be read back; answering what was written',
    );
    return {
      data: {
        id: order.id,
        businessId: order.businessId,
        status: order.status,
        paymentStatus: order.paymentStatus as OrderCommittedWritePartial['paymentStatus'],
      },
      meta: { partial: true },
    };
  }
}
