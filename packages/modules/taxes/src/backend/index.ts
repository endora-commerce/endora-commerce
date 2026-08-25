import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type {
  TaxServicePort, DictionaryValidator,
  DictionaryReferenceRegistryPort,
} from '@endora-commerce/contracts';
import { TaxService } from './services/tax-service.js';
import { registerTaxRoutes } from './routes.js';
import { registerTaxCountryReferences } from './services/tax-country-reference.js';
import { Tax } from './entities/tax.entity.js';

/**
 * `taxes` — three optional arguments, all of which change what a write means
 * (feature 072, wave 2, T119).
 *
 * `TaxService` took its channel-membership binder, its dictionary validator and
 * its audit writer as optional constructor arguments. Omit them and a tax rate
 * is created that binds to no sales channel, validates no country or region
 * code, and records nothing — a write that looks identical from the API and is
 * wrong in three separate ways. Both roots passed all three, so nothing was
 * live; this is the eleventh, twelfth and thirteenth removal of that shape in
 * this transition, and the argument for removing it does not depend on any of
 * them having fired.
 *
 * `taxService` is a **port**: `orders` and `carts` resolve it across a module
 * boundary to price a line, so an operator switching taxes off should get the
 * explicit 503 envelope rather than a service that quietly returns no rate —
 * which, on a checkout path, is a discount.
 */

export interface TaxesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: SalesChannelMembershipPort;
  readonly dictionaryValidator: DictionaryValidator | undefined;
  readonly taxService: TaxService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort<TaxServicePort>(
    'taxService',
    ctx
      .asFunction(
        ({
          emFactory,
          auditLogService,
        }: TaxesCradle) =>
          new TaxService(
            emFactory,
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
            auditLogService,
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const { requireAdmin } = ctx.cradle<TaxesCradle>();
    await registerTaxRoutes(app, {
      // Lazily, even though the module owns this port: route *registration* runs
      // inside `buildServer` whatever the module's effective state is, so
      // destructuring the gate here would stop the next start instead of
      // stopping the routes (D-40).
      taxService: lazyPort<TaxService>(ctx, 'taxService'),
      requireAdmin,
    });
  });

  /**
   * This module's rows carry a country code, so it answers "who still points at
   * this country?" about its own tables (feature 077, D-87), where the owner used
   * to count them with SQL naming this module's tables.
   *
   * A **contribution** hook: it pushes an inert descriptor into `countryReferenceRegistry`,
   * an ungated registry, and carries no presence probe (D-62/D-68). Probing
   * would be wrong in the dangerous direction — a switched-off module still owns
   * the rows, so its country must still refuse the delete, which is the
   * enumeration policy the registry states.
   */
  ctx.onBoot(() => {
    registerTaxCountryReferences(
      lazyPort<DictionaryReferenceRegistryPort>(ctx, 'countryReferenceRegistry'),
      ctx.cradle<TaxesCradle>().emFactory,
    );
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
  Tax,
];
