import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type {
  CreditLimitReadPort,
  OrganizationDetailsPort,
  OrganizationInheritancePort,
} from '@endora-commerce/contracts';
import { CreditLimitService, type CreditLimitEventBus } from './services/credit-limit-service.js';
import { CreditLimitReadService } from './services/credit-limit-read.js';
import { CreditTopupProvider } from './services/credit-topup.js';
import { registerCreditLimitsRoutes } from './routes.js';
import { CreditLimit } from './entities/credit-limit.entity.js';
import { CreditLimitReservation } from './entities/credit-limit-reservation.entity.js';
import { CreditLimitReturnTopup } from './entities/credit-limit-return-topup.entity.js';

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
  /**
   * Who the acting admin is, from the production actor (feature 080, T051).
   * Root-supplied, like the other request resolvers; both roots answer it from
   * `request.actor` and throw 401 for a non-admin.
   */
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  /** A port `organizations` provides — read it per call, never captured. */
  readonly organizationInheritancePort: OrganizationInheritancePort;
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
            // `creditOwner` is the only method reached, and since Phase C the
            // delegate is typed by `organizations`' published contract rather
            // than cast onto its service class, so this module names nothing in
            // that module's directory.
            {
              creditOwner: (orgId: string) =>
                ctx.cradle<CreditLimitsCradle>().organizationInheritancePort.creditOwner(orgId),
            },
          ),
      )
      .singleton(),
  );

  /**
   * The membership read `organizations` needs to resolve an inherited limit
   * (feature 077, D-87).
   *
   * `OrganizationInheritanceService.creditOwner` walks an ancestor chain and
   * has to know which of those organisations hold a row here. It selected from
   * this module's table to find out — a statement naming no import specifier,
   * so the boundary compiled and nothing gated it, and the answer stayed the
   * same after an operator switched credit limits off.
   *
   * A **read** port and deliberately not a method on `creditLimitService`: that
   * service is the gated write seam whose `getForOrganization` asks
   * `organizations` the very question this answers, so widening it would put
   * both directions on one name. Separate names keep the two hops legible —
   * this module asks who the owner is, `organizations` asks who holds a row —
   * and neither recurses.
   *
   * `filters: { org: false }` is load-bearing rather than defensive: the holder
   * is by definition an ancestor outside the caller's tenant scope, which is
   * the whole point of the inheritance, so the org filter would answer the
   * empty set for every descendant.
   */
  ctx.di.providePort<CreditLimitReadPort>(
    'creditLimitReadPort',
    ctx
      .asFunction(
        ({ emFactory }: CreditLimitsCradle) => new CreditLimitReadService(emFactory),
      )
      .singleton(),
  );

  /**
   * How a return settlement credits an organization (feature 046 R7), as this
   * module's port instead of a class both roots constructed (T143c).
   *
   * The provider is a thin rule over `CreditLimitService` and lives in this
   * module already; what a root added was a second, ungated way to reach it, so
   * a settlement kept topping up a grant with `credit_limits` switched off. The
   * service is still handed in as an accessor, for the reason the routes below
   * take it lazily: it is this module's own gated port, and resolving it while
   * this registration is built asks the gate at composition time.
   */
  ctx.di.providePort(
    'creditTopupPort',
    ctx
      .asFunction(() => {
        const creditLimitService = lazyPort<CreditLimitService>(ctx, 'creditLimitService');
        return new CreditTopupProvider(() => creditLimitService);
      })
      .singleton(),
  );

  ctx.routes(async (app) => {
    const { requireCustomer, requireAdmin, customerContextResolver } =
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
      // `organizations`' port, lazily for the same reason and one more: it is
      // another module's gate, so a captured reference would keep answering
      // after an operator switched that module off.
      organizationDetailsPort: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
      requireCustomer,
      requireAdmin,
      resolveCustomerContext: customerContextResolver,
      resolveAdminUserId: (request) =>
        ctx.cradle<CreditLimitsCradle>().adminContextResolver(request).adminUserId,
    });
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
 *
 * Three classes, and this module is where the absent named export and a foreign
 * key had to be shown to coexist (D-169): `credit_limit_reservations` carries
 * `credit_limit_reservations_order_fk` into `orders.id`, and a constraint is
 * between two column names — it needs the **table**, never the class. Nothing
 * another module can legitimately do with `CreditLimitReservation` is lost.
 * D-32 forbids an ORM relation into it; what `orders` actually needs is the
 * *method* placement calls, which leaves this package as `CreditLimitPort` on
 * the type-only `./ports` subpath.
 */
export const entities = [CreditLimit, CreditLimitReservation, CreditLimitReturnTopup];
