import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
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
  /** A port `organizations` provides — read it per call, never captured. */
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
            // Resolved per call, not destructured. `organizationInheritancePort`
            // is a port `organizations` provides, which makes it a transient gate
            // on that module's effective state: capturing it in this singleton's
            // factory is refused by awilix strict mode, and a captured gate would
            // keep answering after an operator switched `organizations` off.
            // Resolving at the point of use also means this registration does not
            // care which module registered first — registration resolves nothing.
            // `creditOwner` is the only method reached, so the delegate is exact
            // rather than a cast hiding a gap.
            {
              creditOwner: (orgId: string) =>
                ctx.cradle<CreditLimitsCradle>().organizationInheritancePort.creditOwner(orgId),
            } as OrganizationInheritanceService,
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const { emFactory, requireCustomer, requireAdmin, customerContextResolver } =
      ctx.cradle<CreditLimitsCradle>();
    await registerCreditLimitsRoutes(app, {
      // Lazily, even though the module owns this port: `providePort` gates on
      // the module's effective state and route *registration* happens whatever
      // that state is — only requests are gated. Destructuring it here asked
      // the gate while `buildServer` was wiring the app, so an operator who had
      // switched `credit_limits` off stopped the backend from starting instead
      // of stopping its routes. Inside a handler the gate is open by
      // construction, so nothing else changes.
      creditLimitService: lazyPort<CreditLimitService>(ctx, 'creditLimitService'),
      emFactory,
      requireCustomer,
      requireAdmin,
      resolveCustomerContext: customerContextResolver,
    });
  });
}
