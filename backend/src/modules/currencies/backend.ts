import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CURRENCY_CHANGED_EVENT,
  type CurrencyAdminPort,
  type CurrencyReadPort,
  type CurrencySeedPort,
  type DictionaryReferenceRegistryPort,
} from '@b2b/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { ModuleContext } from '../../kernel/index.js';
import { CurrencyService } from './services/currency-service.js';
import { CurrencyReadService, createCurrencyAdminPort } from './services/currency-ports.js';
import { CurrencyReferenceRegistry } from './services/currency-reference-registry.js';
import { CurrencySeedService } from './services/currency-seed-service.js';

/**
 * `currencies` — one service, where there were two (feature 072, wave 1).
 *
 * The module owns no routes: `dictionaries` serves
 * `/api/v1/admin/dictionary/currencies/*` and `languages` serves
 * `/api/v1/admin/currencies/*`. Both write the same table, and **each built its
 * own `CurrencyService` with different constructor arguments** — `dictionaries`
 * passed the dictionary invalidator, `languages` passed `undefined`.
 *
 * That is not a tidiness problem. `CurrencyService.setDefault` and `.remove`
 * call the invalidator, so the same delete performed through the second surface
 * left `DictionaryValidator`'s cache holding a code whose row was gone — and
 * the validator's job is to *accept or reject* codes, so the failure is a stale
 * **accept**: the next write referencing that currency passes validation and
 * lands a dangling reference. `test/integration/currencies/one-currency-service.test.ts`
 * pins it.
 *
 * One registration removes the class of bug rather than this instance of it.
 * The invalidator is read from the cradle at call time, because `dictionaries`
 * builds it inside its own factory and is not converted yet; resolving it
 * lazily is also what a port would do, so nothing here has to change again when
 * `dictionaries` converts.
 */

export interface CurrenciesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly eventBus: { emit: (event: string, payload: unknown) => void };
  readonly currencyService: CurrencyService;
  readonly currencyReferenceRegistry: DictionaryReferenceRegistryPort;
}

/**
 * Emitted after any write that changes the set or shape of currencies.
 *
 * The spelling moved to `@b2b/contracts` in feature 075's Phase P — it is a
 * constant, not behaviour, and `dictionaries` subscribes to it. Re-exported
 * here for the length of Phase P, which cuts no consumer.
 */
export { CURRENCY_CHANGED_EVENT };

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    currencyService: ctx
      .asFunction(({ emFactory, auditLogService }: CurrenciesCradle) => {
        // Announce, do not call. Whoever caches currency data subscribes and
        // drops its own; this module does not learn who they are, which is
        // what keeps the dependency graph acyclic and the module detachable
        // (Constitution I).
        const announce = async (): Promise<void> => {
          ctx.cradle<CurrenciesCradle>().eventBus.emit(CURRENCY_CHANGED_EVENT, {});
        };
        return new CurrencyService(emFactory, announce, auditLogService, () =>
          ctx.cradle<CurrenciesCradle>().currencyReferenceRegistry,
        );
      })
      .singleton(),
  });

  // ---------------------------------------------------------------------------
  // Feature 077 (D-87 drain) — who still points at a currency?
  //
  // `CurrencyService.remove` used to answer that with five hand-written counts
  // over `promotions`, `price_lists`, `dictionaries` and the kernel's channels.
  // Three of the four named another module's table in a string, which no
  // import-level boundary check can see. Contributors push a descriptor from
  // their own boot hook now, and this module asks the registry instead.
  //
  // A plain `ctx.di.register`, not a port: a contributor resolves it from a boot
  // hook, and a boot hook that resolved a transient gate would stop the backend
  // from starting the moment this module was switched off. The descriptor is
  // inert; `currencyAdminPort`, which writes currencies, is the port and does
  // fail closed. Enumeration policy is stated at the class.
  ctx.di.register({
    currencyReferenceRegistry: ctx
      .asFunction(() => new CurrencyReferenceRegistry())
      .singleton(),
  });

  /**
   * The insert `dictionaries` needs against this table. Its catalogue exists so
   * that `countries.default_currency_code` is satisfiable on a fresh install;
   * it used to write the 53 rows here as raw SQL from its own reconciler.
   */
  ctx.di.providePort<CurrencySeedPort>(
    'currencySeedPort',
    ctx
      .asFunction(({ emFactory }: CurrenciesCradle) => new CurrencySeedService(emFactory))
      .singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // Six of the fifteen inbound sites read the `Currency` **entity** rather than
  // this module's service: `dictionaries` resolving a label or validating a
  // code. These two ports are what they and the service consumers rewire to.
  //
  // `currencyService` above keeps its plain `ctx.di.register`, unchanged,
  // because retiring it is a cut and Phase P cuts nothing.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<CurrencyReadPort>(
    'currencyReadPort',
    ctx
      .asFunction(({ emFactory }: CurrenciesCradle) => new CurrencyReadService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<CurrencyAdminPort>(
    'currencyAdminPort',
    ctx
      .asFunction(() =>
        createCurrencyAdminPort(() => ctx.cradle<CurrenciesCradle>().currencyService),
      )
      .singleton(),
  );
}
