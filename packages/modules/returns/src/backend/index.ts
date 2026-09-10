import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type {
  CorrectiveInvoicePort,
  CreditTopupPort,
  CustomerAccountReadPort,
  EmailDefaultsRegistryPort,
  EmailMailerPort,
  OrderReturnContextPort,
  PaymentRefundPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { returnsModule, type ReturnsModuleOptions } from './plugin.js';
import { ReturnEmailNotifier } from './services/return-email-notifier.js';
import {
  createChannelLanguageResolver,
  createCustomerEmailResolver,
} from './services/notification-context.js';
import { RETURN_AUTHORIZED_DEFAULT, RETURN_REJECTED_DEFAULT } from './email-templates/transactional-defaults.js';
import { Refund } from './entities/refund.entity.js';
import { ReturnCaseAttachment } from './entities/return-case-attachment.entity.js';
import { ReturnCaseComment } from './entities/return-case-comment.entity.js';
import { ReturnCaseItem } from './entities/return-case-item.entity.js';
import { ReturnCase } from './entities/return-case.entity.js';
import { ReturnDeliveryMethod } from './entities/return-delivery-method.entity.js';
import { ReturnListSavedView } from './entities/return-list-saved-view.entity.js';
import { ReturnReason } from './entities/return-reason.entity.js';
import { ReturnShipment } from './entities/return-shipment.entity.js';
import { ReturnStatusTransition } from './entities/return-status-transition.entity.js';
import { ReturnStatus } from './entities/return-status.entity.js';

/**
 * `returns` — four settlement ports and a dead callback (feature 072, wave 2,
 * T109).
 *
 * The settlement ports are the interesting part. Authorising a return can move
 * money four ways — refund a payment, issue a corrective invoice, top up a
 * credit limit, and read the order it came from — and each is a port its owning
 * module publishes: `orderReturnContextPort`, `paymentRefundPort`,
 * `correctiveInvoicePort` and `creditTopupPort`.
 *
 * **T118c retired the bridge that used to carry them.** They arrived as one
 * `returnsBridge` object a composition root assembled, on the argument that a
 * composition supplies all of them or none. That argument was about the days
 * when the four were *adapters a root constructed*; since T143c each has been a
 * forwarder onto its owner's port, and forwarding through a root left the edge
 * undeclared — `payments`, `invoices` and `credit_limits` appeared in no
 * manifest of this module's, so nothing could tell an operator what switching
 * one of them off costs. This module resolves the four itself now and says so in
 * its manifest. The bridge's other four members went the same way: the two actor
 * resolvers are the platform's own contributions, and the address and the
 * language are in `services/notification-context.ts`.
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

/**
 * What this module reads out of the composition, now that `returnsBridge` is
 * gone (`specs/110-instance-repository/` T118c).
 *
 * The bridge held eight members and none of them was a composition's answer to
 * give. The four settlement adapters are the ports `orders`, `payments`,
 * `invoices` and `credit_limits` publish, resolved below with `lazyPort`; the
 * recipient's address is `customer_accounts`' published record; the channel's
 * language is a read of the platform's own entity. What is left here is the pair
 * only a composition can answer — *who is asking* — and both are names the
 * platform contributes for every module that takes one (`compose-app.ts`, the
 * actor-shaped nine of T118b), not a shape this module invents.
 */
export interface ReturnsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly settingsReadPort: ReturnsModuleOptions['settingsService'];
  /**
   * How this composition names the calling customer, for the customer-facing RMA
   * routes. It asserts a customer session and nothing more — a return is
   * submitted by an account with or without an Organization, which is why this is
   * `customerAccountIdResolver` and not `customerContextResolver`.
   */
  readonly customerAccountIdResolver: ReturnsModuleOptions['resolveCustomerAccountId'];
  /** How this composition names the acting admin; root-shaped, like the above. */
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
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
        const cradle = (): ReturnsCradle => ctx.cradle<ReturnsCradle>();
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
         *
         * T118c — its two remaining inputs are this module's own now. The
         * address comes from `customer_accounts`' published record and the
         * language from the case's channel; both were `returnsBridge` closures a
         * root wrote twice, and both live in `services/notification-context.ts`
         * so the mapping and its fallbacks are testable with nothing composed.
         */
        const notifier = new ReturnEmailNotifier(
          lazyPort<EmailMailerPort>(ctx, 'emailMailer'),
          createCustomerEmailResolver(
            lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          ),
          {
            getTransactionalEmailSender: () => cradle().transactionalEmailSenderAccessor(),
            resolveLanguage: createChannelLanguageResolver(emFactory),
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
            cradle().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) => cradle().requireCustomer(req, reply),
          resolveCustomerAccountId: (req) => cradle().customerAccountIdResolver(req),
          resolveAdminUserId: (req) => cradle().adminContextResolver(req).adminUserId,
          // The four settlement adapters, resolved here since T118c. Each was a
          // forwarder a composition root built onto the owning module's port and
          // handed over as a `returnsBridge` member, which meant the edge into
          // `payments`, `invoices` and `credit_limits` appeared in no manifest:
          // a root's resolution is nobody's declared dependency, so an operator
          // switching one of the three off was told nothing about what stops.
          // The `lazyPort` proxy resolves per call, so the gate still answers at
          // the settlement it is about rather than at composition.
          orderContext: lazyPort<OrderReturnContextPort>(ctx, 'orderReturnContextPort'),
          paymentRefund: lazyPort<PaymentRefundPort>(ctx, 'paymentRefundPort'),
          correctiveInvoice: lazyPort<CorrectiveInvoicePort>(ctx, 'correctiveInvoicePort'),
          creditTopup: lazyPort<CreditTopupPort>(ctx, 'creditTopupPort'),
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
    const defaults = lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort');
    defaults.register('return_authorized', RETURN_AUTHORIZED_DEFAULT, 'returns');
    defaults.register('return_rejected', RETURN_REJECTED_DEFAULT, 'returns');
  });

}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  Refund,
  ReturnCaseAttachment,
  ReturnCaseComment,
  ReturnCaseItem,
  ReturnCase,
  ReturnDeliveryMethod,
  ReturnListSavedView,
  ReturnReason,
  ReturnShipment,
  ReturnStatusTransition,
  ReturnStatus,
];
