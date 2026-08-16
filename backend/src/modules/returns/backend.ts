import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { TransactionalEmailSender } from '@b2b/contracts';
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
import {
  ReturnEmailNotifier,
  type CustomerEmailResolver,
} from './services/return-email-notifier.js';
import type { Mailer } from '../email/services/mailer.js';
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

/**
 * How this composition settles a return, and who is asking.
 *
 * T143c narrowed it. The four settlement adapters used to arrive here as
 * objects a root constructed out of `orders`, `payments`, `invoices` and
 * `credit_limits`; each is that module's port now and this bridge forwards to
 * it, so the adapter answers on its owner's effective state instead of on a
 * root's captured instance. What is left is what only a composition can say:
 * who is asking, and how to reach two facts that live outside every module
 * involved — the customer's address and the channel's language.
 */
export interface ReturnsBridge {
  readonly resolveCustomerAccountId: ReturnsModuleOptions['resolveCustomerAccountId'];
  readonly resolveAdminUserId: ReturnsModuleOptions['resolveAdminUserId'];
  readonly orderContext: ReturnsModuleOptions['orderContext'];
  readonly paymentRefund: ReturnsModuleOptions['paymentRefund'];
  readonly correctiveInvoice: ReturnsModuleOptions['correctiveInvoice'];
  readonly creditTopup: ReturnsModuleOptions['creditTopup'];
  /**
   * Where the authorize / reject e-mail goes. `null` means no address resolves,
   * which the notifier reports as `no_recipient` rather than treating as sent.
   */
  readonly resolveCustomerEmail: CustomerEmailResolver;
  /** The language a channel's e-mail is rendered in. */
  readonly resolveChannelLanguage: (salesChannelId: string) => Promise<string>;
}

export interface ReturnsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly settingsReadPort: ReturnsModuleOptions['settingsService'];
  readonly returnsBridge: ReturnsBridge;
  /**
   * `transactional_emails`' late-bound sender, read per send. It answers
   * `undefined` until that module announces it, which is later than this module
   * composes — the reason it is an accessor rather than the sender itself.
   */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  /** The factory returns a bare plugin, not a `{ plugin, handle }` pair. */
  readonly returns: ReturnType<typeof returnsModule>;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    returns: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: ReturnsCradle) => {
        const bridge = (): ReturnsBridge => ctx.cradle<ReturnsCradle>().returnsBridge;
        const b = bridge();
        /**
         * The customer notification, built here rather than handed in (T143c).
         *
         * It is this module's own class, and a root that constructs its own
         * class builds it slightly differently in each root — which is what
         * happened: the two spellings differed in the mailer they passed and in
         * nothing that made the difference visible. The mailer is resolved per
         * send, so a composition that contributes one later (the harness does)
         * is not a race, and the sender accessor stays late-bound because
         * `transactional_emails` announces it after this module composes.
         */
        const notifier = new ReturnEmailNotifier(
          lazyPort<Mailer>(ctx, 'emailMailer'),
          (customerAccountId) => bridge().resolveCustomerEmail(customerAccountId),
          {
            getTransactionalEmailSender: () =>
              ctx.cradle<ReturnsCradle>().transactionalEmailSenderAccessor(),
            resolveLanguage: (salesChannelId) => bridge().resolveChannelLanguage(salesChannelId),
          },
        );
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
          // The four settlement adapters. Held by value: since T143c each is a
          // thin forwarder a root builds onto the owning module's gated port,
          // so what is captured here resolves that gate per settlement rather
          // than being one. Before T143c these were the adapter *instances*,
          // constructed by a root out of four other modules and answering
          // whether or not those modules were switched on.
          orderContext: b.orderContext,
          paymentRefund: b.paymentRefund,
          correctiveInvoice: b.correctiveInvoice,
          creditTopup: b.creditTopup,
          notifier,
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
