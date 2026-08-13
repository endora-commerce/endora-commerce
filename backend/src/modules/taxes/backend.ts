import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import type { DictionaryValidator } from '@b2b/contracts';
import { Tax } from './entities/tax.entity.js';
import { TaxService } from './services/tax-service.js';
import { registerTaxRoutes } from './routes.js';

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

export const entities = [Tax];

export interface TaxesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: SalesChannelMembershipService;
  readonly dictionaryValidator: DictionaryValidator | undefined;
  readonly taxService: TaxService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'taxService',
    ctx
      .asFunction(
        ({
          emFactory,
          salesChannelMembershipPort,
          dictionaryValidator,
          auditLogService,
        }: TaxesCradle) =>
          new TaxService(
            emFactory,
            salesChannelMembershipPort,
            dictionaryValidator,
            auditLogService,
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const { taxService, requireAdmin } = ctx.cradle<TaxesCradle>();
    await registerTaxRoutes(app, { taxService, requireAdmin });
  });
}
