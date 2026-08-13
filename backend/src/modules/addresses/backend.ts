import type { EntityManager } from '@mikro-orm/postgresql';
import type { DictionaryValidator } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { Address } from './entities/address.entity.js';
import { AddressService } from './services/address-service.js';

/**
 * `addresses` — one service, where there were three (feature 072, wave 1,
 * T090).
 *
 * The module owns no routes: `organizations`, `customers`, `orders` and
 * `quick_order` each serve their own address surface over the same table. Three
 * of them built their own `AddressService`, and the constructor takes its
 * dictionary validator and its audit writer as **optional** arguments — so the
 * three instances were not required to agree, and one of them did not:
 *
 *     orders/plugin.ts:  options.addressService ?? new AddressService(options.emFactory)
 *
 * Both roots pass `addressService`, so that branch is dead today. It is a
 * *loaded* dead branch, though, not an inert one: anything constructing
 * `commerceModule` without the option gets an address service that validates no
 * country or region code and writes no audit entry, on the checkout path.
 * `currencies` shipped this exact shape in wave 1 and there it was live, which
 * is the argument for removing the shape rather than the instance.
 *
 * A **port**, because four other modules resolve it: an address write reaching
 * a module the operator switched off should get an explicit 503 rather than a
 * service that half-answers.
 *
 * `dictionaryValidator` is read from the cradle rather than destructured —
 * `dictionaries` is still hand-wired and registers it after this module
 * composes. Reading it lazily is also what the port will do once that module
 * converts, so nothing here changes again.
 */

export const entities = [Address];

export interface AddressesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly dictionaryValidator: DictionaryValidator | undefined;
  readonly addressService: AddressService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'addressService',
    ctx
      .asFunction(({ emFactory, auditLogService }: AddressesCradle) => {
        const validator = ctx.cradle<AddressesCradle>().dictionaryValidator;
        return new AddressService(emFactory, validator, auditLogService);
      })
      .singleton(),
  );
}
