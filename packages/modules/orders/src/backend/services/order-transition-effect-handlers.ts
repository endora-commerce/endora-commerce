import type { OrderTransitionEffectKind } from '@endora-commerce/contracts';
import type { CreditLimitPort } from '@endora-commerce/mod-credit-limits/ports';
import { ownerOfEffect } from '../domain/transition-effects.js';
import type { OrderTransitionEffectReason } from '../entities/order-transition-effect.entity.js';

/**
 * The two follow-ups an order transition can owe, as functions
 * (`specs/142-order-transition-atomicity/`, D2, D3).
 *
 * Each one answers a **value**: `done`, with what the owner said, or `blocked`,
 * naming the module it is waiting for. A failure is a throw, and the caller —
 * `OrderTransitionEffectService` — records it as a failed attempt.
 *
 * **Presence is decided before the port is touched.** Both owners are
 * switchable and this module is not. A handler runs after the status has
 * committed — in the request that committed it, or in a background sweep with
 * no caller at all — so there is nobody a `ModuleDisabledError` could usefully
 * reach: `module-activation.md` says such an entry point decides presence
 * first and returns. That is also why no `catch` here interprets a refusal:
 * the question is asked, not caught.
 *
 * The release itself stays the owner's. Nothing in this file names an entity,
 * a table or a service of `inventory` or `credit_limits`; both are reached
 * through the ports they publish, unchanged, and both ports are already
 * idempotent — which is what makes running a handler twice safe.
 */

export type OrderTransitionEffectOutcome =
  | { readonly outcome: 'done'; readonly result: Record<string, unknown> }
  | { readonly outcome: 'blocked'; readonly moduleId: string };

export interface OrderTransitionEffectTarget {
  readonly orderId: string;
  readonly reason: OrderTransitionEffectReason;
}

export type OrderTransitionEffectHandler = (
  target: OrderTransitionEffectTarget,
) => Promise<OrderTransitionEffectOutcome>;

export type OrderTransitionEffectHandlers = Readonly<
  Record<OrderTransitionEffectKind, OrderTransitionEffectHandler>
>;

export interface OrderTransitionEffectHandlerDeps {
  /** The effective state of a module: platform availability and operator activation. */
  readonly isPresent: (moduleId: string) => boolean;
  /**
   * `credit_limits`' port, behind an accessor so that it is not even resolved
   * until presence has answered yes.
   */
  readonly creditLimit: () => Pick<CreditLimitPort, 'releaseByOrder'>;
  /**
   * Releases every allocation the order still holds, through `inventory`'s
   * port, and answers how many it released. Called only when `inventory` is
   * present.
   */
  readonly releaseStock: (orderId: string) => Promise<{ released: number }>;
}

/**
 * What `releaseByOrder` answered, reduced to the two facts worth keeping on
 * the row. The port types its answer `unknown` on purpose — `orders` discards
 * it — so this reads defensively rather than asserting a shape it was never
 * promised. `ALREADY_RELEASED` and `RESERVATION_NOT_FOUND` are both **done**:
 * either way no reservation is left for this order to hold.
 */
function creditResult(answer: unknown): Record<string, unknown> {
  if (answer === null || typeof answer !== 'object') return {};
  const { ok, code } = answer as { ok?: unknown; code?: unknown };
  return {
    ...(typeof ok === 'boolean' ? { ok } : {}),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

export function createOrderTransitionEffectHandlers(
  deps: OrderTransitionEffectHandlerDeps,
): OrderTransitionEffectHandlers {
  return {
    'stock.release': async ({ orderId }) => {
      const owner = ownerOfEffect('stock.release');
      if (!deps.isPresent(owner)) return { outcome: 'blocked', moduleId: owner };
      const { released } = await deps.releaseStock(orderId);
      return { outcome: 'done', result: { released } };
    },
    'credit.release': async ({ orderId, reason }) => {
      const owner = ownerOfEffect('credit.release');
      if (!deps.isPresent(owner)) return { outcome: 'blocked', moduleId: owner };
      const answer = await deps.creditLimit().releaseByOrder({ orderId, reason });
      return { outcome: 'done', result: creditResult(answer) };
    },
  };
}
