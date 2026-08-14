import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { ReturnStatus } from './entities/return-status.entity.js';
import { ReturnStatusTransition } from './entities/return-status-transition.entity.js';
import { ReturnCase } from './entities/return-case.entity.js';
import { ReturnCaseItem } from './entities/return-case-item.entity.js';
import { ReturnCaseComment } from './entities/return-case-comment.entity.js';
import { ReturnReason } from './entities/return-reason.entity.js';
import { ReturnDeliveryMethod } from './entities/return-delivery-method.entity.js';
import { Refund } from './entities/refund.entity.js';
import { ReturnShipment } from './entities/return-shipment.entity.js';
import { ReturnCaseAttachment } from './entities/return-case-attachment.entity.js';
import { ReturnListSavedView } from './entities/return-list-saved-view.entity.js';
import { returnsModule, type ReturnsModuleOptions } from './plugin.js';
import { RETURN_AUTHORIZED_DEFAULT, RETURN_REJECTED_DEFAULT } from './email-templates/transactional-defaults.js';
import type { EmailDefaultsRegistry } from '../transactional_emails/services/email-defaults-registry.js';

/**
 * `returns` — four settlement ports and a dead callback (feature 072, wave 2,
 * T109).
 *
 * The settlement ports are the interesting part. Authorising a return can move
 * money four ways — refund a payment, issue a corrective invoice, top up a
 * credit limit, and read the order it came from — and each is a small adapter a
 * root builds over `payments`, `invoices`, `credit_limits` and `orders`. They
 * are contributed as one {@link ReturnsBridge} with the actor resolvers and the
 * notifier, because a composition supplies all of them or none: a return module
 * that can refund but not issue a correction is not a coherent deployment, it
 * is a half-wired one.
 *
 * **`exposeServices` is deleted rather than converted.** It was a callback for
 * handing the transition services back to a composition — declared, called, and
 * supplied by nobody. Its comment said "e.g. for settlement guards", which is a
 * use that never arrived. A conversion is the right moment to notice that: the
 * option survived because reading a factory's signature does not tell you
 * whether anything passes a given argument, and the container makes that
 * visible by refusing to register a name nothing provides.
 *
 * `auditLog` stops being optional. FR-041 requires status changes *and*
 * settlement to be recorded, and settlement is where the money moved.
 */

export const entities = [
  ReturnStatus,
  ReturnStatusTransition,
  ReturnCase,
  ReturnCaseItem,
  ReturnCaseComment,
  ReturnReason,
  ReturnDeliveryMethod,
  Refund,
  ReturnShipment,
  ReturnCaseAttachment,
  ReturnListSavedView,
];

/** How this composition settles a return, and who is asking. */
export interface ReturnsBridge {
  readonly resolveCustomerAccountId: ReturnsModuleOptions['resolveCustomerAccountId'];
  readonly resolveAdminUserId: ReturnsModuleOptions['resolveAdminUserId'];
  readonly orderContext: ReturnsModuleOptions['orderContext'];
  readonly paymentRefund: ReturnsModuleOptions['paymentRefund'];
  readonly correctiveInvoice: ReturnsModuleOptions['correctiveInvoice'];
  readonly creditTopup: ReturnsModuleOptions['creditTopup'];
  /** Best-effort customer notification; absent means the transition is silent. */
  readonly notifier?: ReturnsModuleOptions['notifier'];
}

export interface ReturnsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly settingsReadPort: ReturnsModuleOptions['settingsService'];
  readonly returnsBridge: ReturnsBridge;
  /** The factory returns a bare plugin, not a `{ plugin, handle }` pair. */
  readonly returns: ReturnType<typeof returnsModule>;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    returns: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: ReturnsCradle) => {
        const bridge = (): ReturnsBridge => ctx.cradle<ReturnsCradle>().returnsBridge;
        const b = bridge();
        return returnsModule({
          emFactory,
          eventBus,
          auditLog: auditLogService,
          settingsService: lazyPort<ReturnsModuleOptions['settingsService']>(
            ctx,
            'settingsReadPort',
          ),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<ReturnsCradle>().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) => ctx.cradle<ReturnsCradle>().requireCustomer(req, reply),
          resolveCustomerAccountId: (req) => bridge().resolveCustomerAccountId(req),
          resolveAdminUserId: (req) => bridge().resolveAdminUserId(req),
          // The four settlement adapters. Held by value rather than forwarded
          // per call: they are plain objects a root constructs once, and the
          // module keeps them for the life of the composition.
          orderContext: b.orderContext,
          paymentRefund: b.paymentRefund,
          correctiveInvoice: b.correctiveInvoice,
          creditTopup: b.creditTopup,
          ...(b.notifier === undefined ? {} : { notifier: b.notifier }),
        });
      })
      .singleton(),
  });

  ctx.routes(async (app) => {
    await ctx.cradle<ReturnsCradle>().returns(app);
  });

  /**
   * The default subject and content for the 2 transactional emails this
   * module declares in its manifest (T143a).
   *
   * These were fourteen `emailDefaultsRegistry.register(...)` calls in
   * `composition.ts`, each importing a template constant out of the module that
   * owns it — a root reaching into seven modules to hand their own content to
   * an eighth. Each module registers its own now.
   *
   * `ctx.onBoot` rather than a registration: the registry is *read* once, by
   * `transactional_emails`' boot reconciler inside its plugin body. Boot hooks
   * run during composition and plugin bodies only when the Fastify app is
   * built, so this always lands first — by construction, not by ordering luck.
   */
  ctx.onBoot(async () => {
    const defaults = lazyPort<EmailDefaultsRegistry>(ctx, 'emailDefaultsPort');
    defaults.register('return_authorized', RETURN_AUTHORIZED_DEFAULT, 'returns');
    defaults.register('return_rejected', RETURN_REJECTED_DEFAULT, 'returns');
  });

}
