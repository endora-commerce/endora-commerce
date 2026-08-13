import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { OrganizationInheritanceService } from '../organizations/services/organization-inheritance-service.js';
import { CreditLimit } from './entities/credit-limit.entity.js';
import { CreditLimitService, type CreditLimitEventBus } from './services/credit-limit-service.js';
import { registerCreditLimitsRoutes } from './routes.js';

/**
 * `credit_limits` — an optional Command Bus on the one write that must be
 * audited (feature 072, wave 2, T101).
 *
 * `CreditLimitService` took `commandBus` as an optional constructor argument,
 * documented as "audits `adjust` co-transactionally when provided". Adjusting a
 * customer's credit limit is precisely the class of write Constitution XIII
 * exists for — an admin moving how much money an organization may spend before
 * paying — and the optional form means the audited path is the one you get by
 * remembering. Both roots passed it, so nothing was unaudited; the shape goes
 * anyway, for the same reason as the twelve before it.
 *
 * `inheritance` was optional too, and its absence is quieter and stranger:
 * "Absent ⇒ flat behavior", meaning a descendant organization with no own limit
 * transacts against nothing instead of against its nearest ancestor's. Not an
 * error, not a refusal — a different and more permissive credit policy, chosen
 * by omission.
 *
 * `creditLimitService` is a **port**: `orders` reserves against it and the
 * credit-topup payment provider draws on it, both across a module boundary, so
 * an operator switching credit limits off should get the explicit 503 rather
 * than a service that reports no limit — which on a checkout path means
 * unlimited credit.
 */

export const entities = [CreditLimit];

export interface CreditLimitsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (request: FastifyRequest) => Promise<void>;
  /** How this composition resolves the calling customer; root-shaped. */
  readonly customerContextResolver: (request: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** Owned by `organizations`; a root registers it until that module converts. */
  readonly organizationInheritancePort: OrganizationInheritanceService;
  readonly creditLimitService: CreditLimitService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'creditLimitService',
    ctx
      .asFunction(
        ({ emFactory, eventBus, commandBus }: CreditLimitsCradle) =>
          new CreditLimitService(
            emFactory,
            eventBus as unknown as CreditLimitEventBus,
            commandBus,
            // Resolved per call, not destructured. This module composes in the
            // early pass — both roots read `creditLimitService` well before the
            // late pass — while `organizationInheritancePort` is registered
            // later, after `organizations` is built. Taking it as a constructor
            // argument resolves it at composition time and fails on a name that
            // does not exist yet. `creditOwner` is the only method reached, so
            // the delegate is exact rather than a cast hiding a gap.
            {
              creditOwner: (orgId: string) =>
                ctx.cradle<CreditLimitsCradle>().organizationInheritancePort.creditOwner(orgId),
            } as OrganizationInheritanceService,
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const { creditLimitService, emFactory, requireCustomer, requireAdmin, customerContextResolver } =
      ctx.cradle<CreditLimitsCradle>();
    await registerCreditLimitsRoutes(app, {
      creditLimitService,
      emFactory,
      requireCustomer,
      requireAdmin,
      resolveCustomerContext: customerContextResolver,
    });
  });
}
