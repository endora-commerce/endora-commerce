import type { EntityManager } from '@mikro-orm/postgresql';
import { z, type ZodType } from 'zod';
import {
  adminAddOrderCommentRequestSchema,
  adminOrderPaymentStatusTransitionSchema,
  adminOrderStatusTransitionSchema,
  ERROR_CODES,
  type AggregateCommandOptions,
  type CustomFieldMerge,
  type OrderComment,
  type OrderCommandPort,
  type OrderCommentInput,
  type OrderExternalReference,
  type OrderExternalReferenceWrite,
  type OrderPaymentStatusTransitionInput,
  type OrderRecord,
  type OrderStatusTransitionInput,
  type OrderTransitionOutcome,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { assertCallerSource, withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { serializeComment } from '../order-response.js';
import { makeSetOrderCustomFieldValuesCommand } from './order-audit-state.js';
import type { OrderCommentService } from './order-comment-service.js';
import { setOrderExternalReference } from './order-external-reference-service.js';
import { toOrderRecord } from './order-read-port.js';
import type { OrderService } from './order-service.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';
import { ambientOrderStatusActor, applyStatusAsOutcome } from './order-status-outcome.js';
import type { OrderTransitionService } from './order-transition-service.js';

/**
 * `orderCommandPort` (`specs/186-aggregate-ports/` US4, issue #1823) — the
 * Order aggregate's write port. The contract, the refusals and the options
 * are `OrderCommandPort` in `@endora-commerce/contracts`.
 *
 * **It checks no permission.** The caller is the gate. Each method validates
 * `source` before it reads anything (issue #1922), parses its input with the
 * admin route's schema (a refusal is `422 VALIDATION_FAILED`, except the
 * external reference's published `400`), and runs the Command the route runs
 * through the route's own runner — `OrderTransitionService.apply`,
 * `OrderService.transitionPaymentStatus`, `OrderCommentService.addByAdmin`,
 * the custom-field factory the route's patch is a merge over. The caller's
 * `source` and `extensions` are added to that Command by `withCallerOptions`,
 * never by a second factory.
 *
 * The services are built in the plugin body, so they are resolved per call:
 * a call before route registration answers 503, as every `orders` port does.
 */
export interface OrderCommandServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
  readonly transitions: () => Pick<OrderTransitionService, 'apply'>;
  readonly graph: () => Pick<OrderStatusGraphService, 'loadGraph'>;
  readonly orders: () => Pick<OrderService, 'transitionPaymentStatus'>;
  readonly comments: () => Pick<OrderCommentService, 'addByAdmin'>;
}

/**
 * Not the admin route's `orderStatusCodeSchema` for `to`: a server-side caller
 * forwards a code it was configured with — a payment or delivery method's
 * `statusOnSuccess` / `statusOnFailure`, which their own schemas accept as any
 * 1–64 characters — and a code no status has must be the `unknown_status`
 * outcome the graph answers, never a thrown 422 a provider callback would turn
 * into a retry loop (refusals are values). Only a missing or empty `to` is
 * refused before the graph is asked.
 */
const statusInputSchema = z.object({
  to: z.string().min(1),
  reason: adminOrderStatusTransitionSchema.shape.reason.nullable(),
});
const paymentStatusInputSchema = adminOrderPaymentStatusTransitionSchema.pick({ to: true });

/** Parses a port input with the admin route's schema; a refusal is `422 VALIDATION_FAILED`. */
function parseOrRefuse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpError(
    422,
    ERROR_CODES.VALIDATION_FAILED,
    'The Order write is invalid.',
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.message })),
  );
}

export class OrderCommandService implements OrderCommandPort {
  constructor(private readonly deps: OrderCommandServiceDeps) {}

  async applyStatus(
    id: string,
    input: OrderStatusTransitionInput,
    options: AggregateCommandOptions = {},
  ): Promise<OrderTransitionOutcome> {
    const caller = callerOf(options);
    const { to, reason } = parseOrRefuse(statusInputSchema, { reason: null, ...input });
    return applyStatusAsOutcome(
      { emFactory: this.deps.emFactory, transitions: this.deps.transitions, graph: this.deps.graph },
      { orderId: id, to, reason: reason ?? null, actor: ambientOrderStatusActor(caller.source), caller },
    );
  }

  async applyPaymentStatus(
    id: string,
    input: OrderPaymentStatusTransitionInput,
    options: AggregateCommandOptions = {},
  ): Promise<OrderRecord> {
    const caller = callerOf(options);
    const { to } = parseOrRefuse(paymentStatusInputSchema, input);
    return toOrderRecord(await this.deps.orders().transitionPaymentStatus(id, to, caller));
  }

  async setCustomFieldValues(
    id: string,
    merge: CustomFieldMerge,
    options: AggregateCommandOptions = {},
  ): Promise<OrderRecord> {
    const caller = callerOf(options);
    const order = await this.deps.commandBus.run(
      withCallerOptions(makeSetOrderCustomFieldValuesCommand({ orderId: id, merge }), caller),
    );
    return toOrderRecord(order);
  }

  async addComment(id: string, input: OrderCommentInput, options: AggregateCommandOptions = {}): Promise<OrderComment> {
    const caller = callerOf(options);
    const body = parseOrRefuse(adminAddOrderCommentRequestSchema, input);
    const comment = await this.deps.comments().addByAdmin(id, ambientAdminUserId(), body, caller);
    return serializeComment(comment);
  }

  async setExternalReference(
    id: string,
    system: string,
    value: OrderExternalReferenceWrite,
    options: AggregateCommandOptions = {},
  ): Promise<OrderExternalReference> {
    const caller = callerOf(options);
    return setOrderExternalReference(this.deps.commandBus, { orderId: id, system, value }, caller);
  }
}

/**
 * The caller's options as the Commands take them. `source` is refused here,
 * first, so nothing is read or written for a malformed one (issue #1922).
 * `expectedVersion` is ignored: an order has no `version` column.
 */
function callerOf(options: AggregateCommandOptions): CallerOptions {
  assertCallerSource(options);
  return { source: options.source, extensions: options.extensions };
}

/**
 * The comment's author: the administrator the ambient context names — the
 * route's `resolveAdminUserId` for a request, the queuing administrator under
 * `withSystemScopeActingFor` — else none (the system actor wrote it).
 */
function ambientAdminUserId(): string | null {
  const ctx = getTenantContext();
  if (ctx?.impersonation) return ctx.impersonation.realAdminUserId;
  return ctx?.actor.kind === 'admin' ? (ctx.actor.id ?? null) : null;
}
