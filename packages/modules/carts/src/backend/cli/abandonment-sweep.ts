/**
 * `carts abandonment-sweep` — one pass of `CartAbandonmentWorker.sweep()`
 * against the live database (feature 027 US5).
 *
 * Intended for a cron job or a deploy hook, and safe to run manually:
 *
 *   pnpm --filter backend run cart:abandonment-sweep
 *
 * Idempotent: subsequent invocations within the same threshold window are a
 * no-op, because the eligibility filter excludes carts that already carry
 * `abandonment_notified_at`.
 *
 * ## Why this file no longer asks the gate itself (feature 080, T042b)
 *
 * It used to, and the header it carried was the best statement in the tree of
 * the question D-157 answered:
 *
 * > It used to run whatever the platform's opinion of `carts` was, because there
 * > is nothing here for the gate to hang on: `ctx.routes` / `ctx.worker` /
 * > `ctx.subscribe` gate at a registration seam and `providePort` gates at a
 * > resolution, and a CLI has none of the three.
 *
 * There is a seam now, and it is the **declaration**: the host knows which
 * module declared the command it is about to run and asks
 * `requireModuleEnabled` about that module — first, before it builds a context
 * and outside every `try` — in `src/cli/module-commands.ts`. That is the same
 * call at the same point in the same order; what changed is that it is applied
 * once, by the host, for every command, instead of being a line each command's
 * author has to remember. Constitution XVII item 3 states the reason in the
 * general case: *"A gate the registration applies cannot be forgotten in the one
 * service somebody adds later, which a hand-placed call can and did."*
 *
 * ## What the conversion fixed
 *
 * The old file's *"What it still does not do"* section named it: *"It builds its
 * services by hand, so a deployment **decoration** over `cartAuditService` or
 * `cartAbandonmentWorker` does not reach it."* That is a client not getting an
 * override they paid for, and it is fixed by resolving the module's own
 * registration instead of running `new CartAbandonmentWorker(…)` here.
 *
 * The same section refused composition on the ground that `composeApp()`
 * *"starts every queue consumer in the platform"*. That was false and
 * `worker.ts` says so in its own comment — a composition without `buildServer`
 * starts no BullMQ worker and arms no timer, because all three `ctx.worker(`
 * call sites and both module timers sit inside `ctx.routes(…)` bodies that run
 * at Fastify registration (D-157.2, measured three ways). The claim is retired
 * here rather than left for the next author to re-derive.
 *
 * ## Notification dispatch
 *
 * The old file said no e-mail is dispatched in the CLI variant, and that *"the
 * HTTP-bootstrap path in `composition.ts` injects the real
 * `dispatchCartAbandonmentNotification`"*. The second half is stale: measured on
 * this tree, `cartAbandonmentNotifier` is a contribution point that **nobody
 * contributes** — neither composition root writes it — so it defaults to
 * `undefined` and the composed worker dispatches nothing either. Behaviour is
 * therefore unchanged by the conversion, and the day a deployment does
 * contribute a notifier, this command and the platform will agree about it,
 * which they could not before.
 */
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { CartAbandonmentWorker } from '../services/cart-abandonment-worker.js';

/** The one registration this command reads — this module's own. */
interface AbandonmentSweepCradle {
  readonly cartAbandonmentWorker: CartAbandonmentWorker;
}

export async function abandonmentSweep({
  ctx,
  out,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  // This module's own registration, so a deployment decoration over it reaches
  // the command — and so the settings thresholds come from the one file
  // `backend.ts` composes the worker from, which is what stopped the CLI and the
  // server disagreeing about them (D-41/D-43).
  //
  // A cradle read rather than `lazyPort`, because `cartAbandonmentWorker` is a
  // plain `ctx.di.register` and not a `providePort`: spelling it as a port here
  // would suggest a presence gate that this name does not carry. Presence for
  // this module is decided by the host before the command is invoked.
  const worker = ctx.cradle<AbandonmentSweepCradle>().cartAbandonmentWorker;
  const result = await worker.sweep();
  out(
    `[cart abandonment-sweep] abandoned=${result.abandonedCount} ` +
      `notified=${result.notifiedCount}`,
  );
  return 0;
}
