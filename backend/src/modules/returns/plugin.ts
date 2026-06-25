import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { EventBus } from '../../events/bus.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { RETURNS_SETTING_CODES } from './manifest.js';
import { ReturnStatusGraphService } from './services/return-status-graph-service.js';
import { ReturnTransitionService } from './services/return-transition-service.js';
import { ReturnCaseService } from './services/return-case-service.js';
import { ReturnCommentService } from './services/return-comment-service.js';
import { ReturnSettlementService } from './services/return-settlement-service.js';
import {
  ReturnAuthorizationService,
  type ReturnNotifier,
} from './services/return-authorization-service.js';
import { createRmaNumberGenerator } from './services/rma-number-generator.js';
import type { OrderReturnContextPort } from './ports/order-return-context.port.js';
import type { PaymentRefundPort } from './ports/payment-refund.port.js';
import type { CorrectiveInvoicePort } from './ports/corrective-invoice.port.js';
import type { CreditTopupPort } from './ports/credit-topup.port.js';
import { registerReturnsCustomerRoutes } from './routes.customer.js';
import { registerReturnsAdminRoutes } from './routes.admin.js';

/** Default free-return window when the setting cannot be resolved (manifest default). */
const DEFAULT_FREE_RETURN_DAYS = 14;

export interface ReturnsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  settingsService: SettingsService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveCustomerAccountId: (req: FastifyRequest) => string;
  resolveAdminUserId: (req: FastifyRequest) => string;
  orderContext: OrderReturnContextPort;
  /** Settlement ports (US5). Money refunds, corrective invoices, credit top-up. */
  paymentRefund: PaymentRefundPort;
  correctiveInvoice: CorrectiveInvoicePort;
  creditTopup: CreditTopupPort;
  /** Best-effort customer notifications on authorize/reject. */
  notifier?: ReturnNotifier;
  /** Exposes the transition service back to composition (e.g. for settlement guards). */
  exposeServices?: (services: {
    graphService: ReturnStatusGraphService;
    transitions: ReturnTransitionService;
    caseService: ReturnCaseService;
  }) => void;
}

/**
 * Composition root for the returns module (feature 046). Builds the workflow
 * engine, RMA numbering, and the case + authorization services, then registers
 * the customer (US1) and admin (US2/US3) routes. Returns a Fastify plugin in
 * the `module(options) => async (app) => {}` shape used across the codebase.
 */
export function returnsModule(
  options: ReturnsModuleOptions,
): (app: FastifyInstance) => Promise<void> {
  return async (app: FastifyInstance): Promise<void> => {
  const { emFactory, eventBus, settingsService, orderContext } = options;

  const graphService = new ReturnStatusGraphService(emFactory);
  const transitions = new ReturnTransitionService(emFactory, eventBus, graphService);

  const rmaGenerator = createRmaNumberGenerator({
    resolvePrefix: (sc) =>
      settingsService.get(RETURNS_SETTING_CODES.RMA_NUMBER_PREFIX, sc, z.string()),
    resolveSuffix: (sc) =>
      settingsService.get(RETURNS_SETTING_CODES.RMA_NUMBER_SUFFIX, sc, z.string()),
  });

  const resolveFreeReturnDays = async (salesChannelId: string): Promise<number> => {
    try {
      return await settingsService.get(
        RETURNS_SETTING_CODES.FREE_RETURN_DAYS,
        salesChannelId,
        z.number(),
      );
    } catch {
      return DEFAULT_FREE_RETURN_DAYS;
    }
  };

  const caseService = new ReturnCaseService({
    emFactory,
    graphService,
    orderContext,
    resolveFreeReturnDays,
  });

  const authorizationService = new ReturnAuthorizationService({
    emFactory,
    transitions,
    rmaGenerator,
    ...(options.notifier ? { notifier: options.notifier } : {}),
  });

  const commentService = new ReturnCommentService({ emFactory, graphService });

  const settlementService = new ReturnSettlementService({
    emFactory,
    events: eventBus,
    transitions,
    graphService,
    paymentRefund: options.paymentRefund,
    correctiveInvoice: options.correctiveInvoice,
    creditTopup: options.creditTopup,
  });

  options.exposeServices?.({ graphService, transitions, caseService });

  await registerReturnsCustomerRoutes(app, {
    caseService,
    commentService,
    requireCustomer: options.requireCustomer,
    resolveCustomerAccountId: options.resolveCustomerAccountId,
  });

  await registerReturnsAdminRoutes(app, {
    caseService,
    authorizationService,
    commentService,
    settlementService,
    transitions,
    graphService,
    requireAdmin: options.requireAdmin,
    resolveAdminUserId: options.resolveAdminUserId,
  });
  };
}
