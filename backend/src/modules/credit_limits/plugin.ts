import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { CommandBus } from '../../commands/index.js';
import { CreditLimitService, type CreditLimitEventBus } from './services/credit-limit-service.js';
import type { OrganizationInheritanceService } from '../organizations/services/organization-inheritance-service.js';
import { registerCreditLimitsRoutes } from './routes.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface CreditLimitsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  /** Feature 054 — audits `adjust` co-transactionally when provided. */
  commandBus?: CommandBus;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /**
   * Feature 056 — when provided, a descendant with no own credit limit transacts
   * against the nearest ancestor's per the effective mode. Absent ⇒ flat behavior.
   */
  inheritance?: OrganizationInheritanceService;
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
    options.commandBus,
    options.inheritance,
  );
  return {
    handle: { creditLimitService },
    plugin: async (app) => {
      await registerCreditLimitsRoutes(app, {
        creditLimitService,
        emFactory: options.emFactory,
        requireCustomer: options.requireCustomer,
        requireAdmin: options.requireAdmin,
        resolveCustomerContext: options.resolveCustomerContext,
      });
    },
  };
}
