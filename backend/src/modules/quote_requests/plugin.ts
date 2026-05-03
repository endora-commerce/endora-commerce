import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { RfqService, type RfqEventBus } from './services/rfq-service.js';
import { RfqAdminService } from './services/rfq-admin-service.js';
import { RfqEventService } from './services/rfq-event-service.js';
import { RfqRevisionService } from './services/rfq-revision-service.js';
import { RfqNotificationService } from './services/rfq-notification-service.js';
import { RfqExpiryWorker } from './services/rfq-expiry-worker.js';
import { SalesRepAssignmentService } from '../organizations/services/sales-rep-assignment-service.js';
import { QuoteRequest } from './entities/quote-request.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import {
  registerQuoteRequestsCustomerRoutes,
  type CustomerContextResolver,
  type RequireCustomerGuard,
} from './routes.customer.js';
import {
  registerQuoteRequestsAdminRoutes,
  type AdminContextResolver,
} from './routes.admin.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface QuoteRequestsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  requireCustomer: RequireCustomerGuard;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: CustomerContextResolver;
  resolveAdminContext: AdminContextResolver;
  /** Reads the current `quote_requests.expiry_days` from the settings module. */
  resolveExpiryDays: () => Promise<number>;
  /** Reads the storefront-visibility flags from settings. */
  resolveBoolSetting: (key: 'show_add_to_quote_on_card' | 'show_add_to_quote_on_pdp') => Promise<boolean>;
}

export interface QuoteRequestsModuleHandle {
  expiryWorker: RfqExpiryWorker;
  rfqService: RfqService;
  adminService: RfqAdminService;
  salesRepAssignment: SalesRepAssignmentService;
}

export function quoteRequestsModule(options: QuoteRequestsModuleOptions): {
  register: (app: FastifyInstance) => Promise<void>;
  handle: () => QuoteRequestsModuleHandle;
} {
  const eventService = new RfqEventService(options.emFactory);
  const revisionService = new RfqRevisionService(options.emFactory);
  const notificationService = new RfqNotificationService(options.emFactory);
  const salesRepAssignment = new SalesRepAssignmentService(options.emFactory);

  const rfqService = new RfqService({
    emFactory: options.emFactory,
    events: options.eventBus as RfqEventBus,
    eventService,
    revisionService,
    notificationService,
    salesRepAssignment,
  });

  const adminService = new RfqAdminService({
    emFactory: options.emFactory,
    events: options.eventBus as RfqEventBus,
    rfqService,
    eventService,
    revisionService,
    notificationService,
    salesRepAssignment,
  });

  const expiryWorker = new RfqExpiryWorker({
    emFactory: options.emFactory,
    events: options.eventBus as RfqEventBus,
    eventService,
    notificationService,
    salesRepAssignment,
    resolveExpiryDays: options.resolveExpiryDays,
  });

  // US5 — when an order is created with sourceQuoteRequestId set, flip
  // the originating RFQ to Completed and notify both parties (FR-007 +
  // FR-028). The order-creation flow itself lives in orders/, so we
  // observe `order.created.v1` rather than coupling the modules.
  options.eventBus.on('order.created.v1', async (payload) => {
    const em = options.emFactory();
    const orderId = (payload as unknown as { orderId: string }).orderId;
    const order = await em.findOne(Order, { id: orderId });
    if (!order || !order.sourceQuoteRequestId) return;
    const rfq = await em.findOne(QuoteRequest, { id: order.sourceQuoteRequestId });
    if (!rfq || rfq.status === 'Completed') return;
    rfq.status = 'Completed';
    rfq.completedAt = new Date();
    rfq.convertedOrderId = order.id;
    rfq.version += 1;
    await em.flush();
    const evt = await eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'completed',
      actor: { roleLabel: 'System' },
      payload: { type: 'completed', orderId: order.id },
    });
    await notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });
    void randomUUID; // silence unused-import in some build configs
  });

  return {
    register: async (app: FastifyInstance): Promise<void> => {
      await registerQuoteRequestsCustomerRoutes(app, {
        rfqService,
        requireCustomer: options.requireCustomer,
        resolveCustomerContext: options.resolveCustomerContext,
      });
      await registerQuoteRequestsAdminRoutes(app, {
        adminService,
        requireAdmin: options.requireAdmin,
        resolveAdminContext: options.resolveAdminContext,
      });
      const { registerOrganizationsSalesRepRoutes } = await import(
        '../organizations/routes.sales-reps.js'
      );
      await registerOrganizationsSalesRepRoutes(app, {
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
        salesRepAssignment,
      });

      // Storefront-public Quote Requests settings (FR-032 / FR-033) so the
      // storefront can show/hide "Add to quote" buttons without going through
      // the admin-gated settings endpoint. Reads through `resolveBoolSetting`,
      // a callback supplied by composition.ts that consults the settings
      // service. Falls back to `true` for both flags on any read error so a
      // settings outage cannot disable storefront affordances.
      app.get('/api/v1/storefront/settings/quote-requests', async (_request, reply) => {
        reply.header('cache-control', 'public, max-age=60');
        try {
          const card = await options.resolveBoolSetting('show_add_to_quote_on_card');
          const pdp = await options.resolveBoolSetting('show_add_to_quote_on_pdp');
          return { data: { showAddToQuoteOnCard: card, showAddToQuoteOnPdp: pdp } };
        } catch {
          return { data: { showAddToQuoteOnCard: true, showAddToQuoteOnPdp: true } };
        }
      });
    },
    handle: (): QuoteRequestsModuleHandle => ({
      expiryWorker,
      rfqService,
      adminService,
      salesRepAssignment,
    }),
  };
}

export type { CustomerContextResolver, AdminContextResolver, RequireCustomerGuard, FastifyRequest };
