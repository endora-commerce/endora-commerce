/**
 * `orders transition-effects-repair` — list, and with `--apply` release, what
 * cancelled or paid orders are still holding
 * (`specs/142-order-transition-atomicity/`, D9).
 *
 * Usage:
 *   pnpm --filter backend run cli orders transition-effects-repair
 *   pnpm --filter backend run cli orders transition-effects-repair --apply
 *
 * Without `--apply` it is a dry run: it prints every order found holding stock
 * allocations or a credit reservation it should have released, with what each
 * holds, and writes nothing. With `--apply` it records the releases through the
 * same follow-up mechanism a live cancellation uses and attempts them at once;
 * anything that does not complete is retried by the background sweep. Running
 * it again finds nothing left.
 *
 * Run it once after upgrading from a version in which a failed or refused
 * release could leave an order cancelled while still holding stock or credit.
 * The dry run first — a release changes reserved-stock counters and available
 * credit, and anything corrected by hand since should be seen before it is
 * applied.
 *
 * A switched-off `inventory` or `credit_limits` cannot be asked what orders
 * hold; the command says so and exits successfully for the rest.
 *
 * The scope is established here: the host's command runner sets no tenant
 * context, this reads every organization's orders, and the Command Bus —
 * through which the applied write is audited — refuses to run without one. A
 * system actor is recorded on the audit entry as no admin user.
 */
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import { enterSystemScope, type ModuleContext } from '@endora-commerce/platform/kernel';
import type {
  OrderTransitionEffectRepairService,
  RepairReport,
} from '../services/order-transition-effect-repair-service.js';

/** The one registration this command reads — this module's own. */
interface TransitionEffectsRepairCradle {
  readonly orderTransitionEffectRepairService: OrderTransitionEffectRepairService;
}

export function describeRepairReport(report: RepairReport): string[] {
  const lines: string[] = [];
  const tag = '[orders transition-effects-repair]';
  for (const moduleId of report.notExamined) {
    lines.push(
      `${tag} module '${moduleId}' is switched off: what orders hold there was NOT examined. ` +
        'Switch it on and run this again.',
    );
  }
  for (const order of report.stranded) {
    const holds = [
      ...(order.stock.length > 0
        ? [
            `stock: ${order.stock.reduce((sum, a) => sum + a.quantity, 0)} unit(s) in ` +
              `${order.stock.length} allocation(s)`,
          ]
        : []),
      ...(order.credit !== null ? [`credit: ${order.credit.amount} ${order.credit.currency}`] : []),
    ].join('; ');
    lines.push(
      `${tag} order ${order.businessId} (${order.orderId}) status=${order.status} ` +
        `payment=${order.paymentStatus} holds ${holds}`,
    );
  }
  lines.push(
    `${tag} examined=${report.examined} stranded=${report.stranded.length}` +
      (report.applied
        ? ` recorded=${report.recorded} released=${report.attempts.done} ` +
          `waiting=${report.attempts.blocked} failed=${report.attempts.failed}`
        : ''),
  );
  if (!report.applied && report.stranded.length > 0) {
    lines.push(`${tag} dry run: nothing was written. Run again with --apply to release the above.`);
  }
  if (report.applied && report.attempts.blocked + report.attempts.failed > 0) {
    lines.push(
      `${tag} releases that did not complete are recorded and are retried by the background sweep.`,
    );
  }
  return lines;
}

export async function transitionEffectsRepair({
  ctx,
  argv,
  out,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  const apply = argv.includes('--apply');
  // A cradle read rather than `lazyPort`: the name is this module's own plain
  // registration, so spelling it as a port would suggest a presence gate it
  // does not carry. Presence for this module was decided by the host before
  // this body ran; the two owners' presence is decided inside the service.
  const service = ctx.cradle<TransitionEffectsRepairCradle>().orderTransitionEffectRepairService;
  const report = await enterSystemScope(
    `orders: transition-effects-repair${apply ? ' --apply' : ' (dry run)'}`,
    () => service.run({ apply }),
  );
  for (const line of describeRepairReport(report)) out(line);
  return 0;
}
