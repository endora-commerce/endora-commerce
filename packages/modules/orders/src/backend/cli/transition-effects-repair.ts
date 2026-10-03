/**
 * `orders transition-effects-repair` — list, and with `--apply` release, what
 * cancelled or paid orders are still holding
 * (`specs/142-order-transition-atomicity/`, D9).
 *
 * Usage:
 *   pnpm --filter backend run cli orders transition-effects-repair
 *   pnpm --filter backend run cli orders transition-effects-repair --apply
 *   pnpm --filter backend run cli orders transition-effects-repair --apply --except=<order id>
 *   pnpm --filter backend run cli orders transition-effects-repair --apply --order=<order id>
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
 * credit.
 *
 * **What the dry run cannot show.** It lists what each order's own rows say it
 * holds. It cannot tell whether an operator has already corrected the stock
 * counter by hand for that order: the allocation row is still unreleased, so
 * the order is listed, and applying it lowers the counter a second time —
 * reserving less than live orders actually hold. `--except=<order id>`
 * (repeatable) leaves such an order out; `--order=<order id>` (repeatable)
 * repairs only the orders named. Both take the order's id as the list prints
 * it in brackets.
 *
 * A switched-off `inventory` or `credit_limits` cannot be asked what orders
 * hold; the command says so and exits successfully for the rest.
 *
 * No scope is opened here: the host's dispatcher runs every module command
 * inside a system scope over its own composition, which is what this needs —
 * it reads every organization's orders, and the Command Bus, through which the
 * applied write is audited, refuses to run without a tenant context. A system
 * actor is recorded on the audit entry as no admin user.
 */
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RepairArguments {
  readonly apply: boolean;
  readonly only: readonly string[];
  readonly except: readonly string[];
}

/** `--apply`, `--order=<id>` and `--except=<id>`; anything else is refused. */
export function parseRepairArguments(argv: readonly string[]): RepairArguments | { error: string } {
  let apply = false;
  const only: string[] = [];
  const except: string[] = [];
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    const match = /^--(order|except)=(.+)$/.exec(arg);
    if (!match) return { error: `Unknown argument: ${arg}` };
    if (!UUID.test(match[2]!)) {
      return { error: `--${match[1]} takes an order id (a UUID), got: ${match[2]}` };
    }
    (match[1] === 'order' ? only : except).push(match[2]!.toLowerCase());
  }
  if (only.length > 0 && except.length > 0) {
    return { error: 'Give --order or --except, not both.' };
  }
  return { apply, only, except };
}

export async function transitionEffectsRepair({
  ctx,
  argv,
  out,
  err,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  const args = parseRepairArguments(argv);
  if ('error' in args) {
    err(`[orders transition-effects-repair] ${args.error}`);
    return 2;
  }
  // A cradle read rather than `lazyPort`: the name is this module's own plain
  // registration, so spelling it as a port would suggest a presence gate it
  // does not carry. Presence for this module was decided by the host before
  // this body ran; the two owners' presence is decided inside the service.
  const service = ctx.cradle<TransitionEffectsRepairCradle>().orderTransitionEffectRepairService;
  const report = await service.run(args);
  for (const line of describeRepairReport(report)) out(line);
  return 0;
}
