import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { CreditLimitService, type CreditLimitEventBus } from './services/credit-limit-service.js';
import { registerCreditLimitsRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface CreditLimitsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export interface CreditLimitsModuleHandle {
  creditLimitService: CreditLimitService;
}

export function creditLimitsModule(
  options: CreditLimitsModuleOptions,
): { plugin: (app: FastifyInstance) => Promise<void>; handle: CreditLimitsModuleHandle } {
  const creditLimitService = new CreditLimitService(
    options.emFactory,
    options.eventBus as CreditLimitEventBus,
  );
  return {
    handle: { creditLimitService },
    plugin: async (app) => {
      await registerCreditLimitsRoutes(app, {
        creditLimitService,
        requireCustomer: options.requireCustomer,
        requireAdmin: options.requireAdmin,
        resolveCustomerContext: options.resolveCustomerContext,
      });
    },
  };
}
