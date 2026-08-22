import type { EntityManager } from '@mikro-orm/postgresql';
import type { DictionaryValidator,
  DictionaryReferenceRegistryPort,
} from '@b2b/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { AddressReadPort, AddressServicePort } from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { AddressService } from './services/address-service.js';
import { AddressReadService, createAddressServicePort } from './services/address-ports.js';
import { registerAddressCountryReferences } from './services/address-country-reference.js';

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
 * `dictionaryValidator` goes through `lazyPort`, and the reason changed under
 * it. It used to be read once in the factory body — `const validator =
 * ctx.cradle<…>().dictionaryValidator` — which looks deferred and is not: the
 * factory body runs when the registration is first constructed. That was
 * harmless while `dictionaries` registered a plain value, and stopped being
 * harmless the moment that module converted and made it a port, because a
 * singleton may not hold a transient gate. `lazyPort` defers it per call, which
 * is what the comment always claimed was happening.
 */

export interface AddressesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly dictionaryValidator: DictionaryValidator | undefined;
  readonly addressService: AddressService;
}

export function registerModule(ctx: ModuleContext): void {
  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // `addressService` below hands out the class; four of the ten inbound sites
  // do not want a service at all, they read the `Address` entity to snapshot
  // one onto an order, serialise one, or resolve a buyer's default. These two
  // ports are what both halves rewire to, and every read on the first is
  // scoped by organisation — three of the four direct readers apply that check
  // in a second statement today, in a tenancy-critical table.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<AddressReadPort>(
    'addressReadPort',
    ctx
      .asFunction(({ emFactory }: AddressesCradle) => new AddressReadService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<AddressServicePort>(
    'addressServicePort',
    ctx
      .asFunction(() =>
        createAddressServicePort(() => ctx.cradle<AddressesCradle>().addressService),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'addressService',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: AddressesCradle) =>
          new AddressService(
            emFactory,
            lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
            auditLogService,
          ),
      )
      .singleton(),
  );

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
    registerAddressCountryReferences(
      lazyPort<DictionaryReferenceRegistryPort>(ctx, 'countryReferenceRegistry'),
      ctx.cradle<AddressesCradle>().emFactory,
    );
  });
}
