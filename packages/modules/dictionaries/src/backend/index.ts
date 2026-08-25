import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import {
  CURRENCY_CHANGED_EVENT,
  LANGUAGE_CHANGED_EVENT,
  type CurrencyAdminPort,
  type CurrencyReadPort,
  type CurrencySeedPort,
  type DictionaryReferenceRegistryPort,
  type DictionaryValidator as DictionaryValidatorPort,
  type LanguageAdminPort,
  type LanguageReadPort,
  type LanguageSeedPort,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { DictionaryCache } from './services/dictionary-cache.js';
import { DictionaryValidator as DictionaryValidatorService } from './services/dictionary-validator.js';
import { DictionaryReadService } from './services/dictionary-read-service.js';
import { LabelResolver } from './services/label-resolver.js';
import { TranslationService } from './services/translation-service.js';
import { CountryService } from './services/country-service.js';
import { CountryReferenceRegistry } from './services/country-reference-registry.js';
import { registerCountryCurrencyReference } from './services/country-currency-reference.js';
import { LanguageCountryService } from './services/language-country-service.js';
import { runDictionarySeedReconciler } from './services/seed-reconciler.js';
import { registerDictionaryAdminRoutes } from './routes.admin.js';
import { registerDictionaryStorefrontRoutes } from './routes.storefront.js';
import { Country } from './entities/country.entity.js';
import { DictionaryTranslation } from './entities/dictionary-translation.entity.js';
import { LanguageCountry } from './entities/language-country.entity.js';

/**
 * `dictionaries` — the module that owns the cache everybody else announces to
 * (feature 072, wave 2, T112).
 *
 * Two things move *into* this module, and both were in a composition root only
 * because the module could not reach them.
 *
 * **The invalidation listeners.** Each root subscribed to `currencies.changed`
 * and `languages.changed` and reached back in to call
 * `dictionaries.handle.validator.invalidate()` and
 * `cache?.invalidateAll()`. That is this module's own cache being dropped by
 * somebody else, spelled twice. `ctx.subscribe` puts it where it belongs — and
 * gates it, so the drops stop when the module does. The direction stays the one
 * wave 1 established: `currencies` and `languages` *announce*, and whoever
 * caches their data subscribes. Declaring the reverse call as a dependency
 * produces a real cycle, because this module reads both their entities.
 *
 * **The second `LanguageService`.** `plugin.ts` built one here —
 * `new LanguageService(emFactory, invalidateDictionaryState, auditLog)` — while
 * `languages` built another that announces on the EventBus. Two services
 * writing the same table through different invalidation mechanisms, which is
 * the divergence this transition keeps finding. `languages` provides the port
 * now, so this module resolves it and there is one.
 *
 * `requireAdmin` stops being optional. Its absence removed the admin surface
 * rather than opening it — the `comparisons` shape, safe but still a surface
 * that exists or not depending on whether an argument was passed.
 *
 * `dictionaryValidator` is a **port**, and its `HOST_REGISTERED_PORTS` entry
 * goes: `blog`, `taxes`, `organizations`, `orders` and `catalog` resolve it to
 * validate country, region, currency and language codes on write, and a
 * composition with dictionaries off should refuse those writes rather than
 * accept unvalidated ones.
 *
 * **Feature 075, Phase C.** Seventeen imports of `currencies`' and `languages`'
 * files are gone. Ten of them read those modules' *entities* — this module owns
 * the admin screen and the storefront registry for two tables it does not own,
 * so it queried them directly, and deactivation drops no tables: the registry
 * kept listing currencies and the validator kept accepting codes out of modules
 * an operator had switched off. Both are now the four published ports, each
 * resolved with `lazyPort` and handed to the service that needs it, never
 * captured. The two event names are constants in `@endora-commerce/contracts` now, which is
 * where a string belongs; the direction is untouched — `currencies` and
 * `languages` announce, this module subscribes, and neither learns who listens.
 */

export interface DictionariesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly redis: Redis | undefined;
  readonly requireAdmin: RequireAdminFactory;
  /** Owned by `currencies`; this module's admin surface serves both. */
  readonly currencyReadPort: CurrencyReadPort;
  readonly currencyAdminPort: CurrencyAdminPort;
  /** Owned by `languages`; there used to be a second service built here. */
  readonly languageReadPort: LanguageReadPort;
  readonly languageAdminPort: LanguageAdminPort;
  readonly dictionaryCache: DictionaryCache | undefined;
  readonly dictionaryValidator: DictionaryValidatorPort;
  readonly dictionaryInvalidator: () => Promise<void>;
  readonly countryReferenceRegistry: DictionaryReferenceRegistryPort;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    dictionaryCache: ctx
      .asFunction(({ redis }: DictionariesCradle) =>
        redis ? new DictionaryCache(redis) : undefined,
      )
      .singleton(),

    /** Drops both layers: the validator's in-process map and the Redis cache. */
    dictionaryInvalidator: ctx
      .asFunction(() => async (): Promise<void> => {
        const { dictionaryValidator, dictionaryCache } = ctx.cradle<DictionariesCradle>();
        dictionaryValidator.invalidate();
        // Swallowed rather than left floating: a drop that lands after the
        // server closed surfaces as an unhandled rejection from ioredis's
        // socket-close path. A cache that could not be dropped because the
        // process is going away has nothing to be stale for.
        await dictionaryCache?.invalidateAll().catch(() => undefined);
      })
      .singleton(),
  });

  // ---------------------------------------------------------------------------
  // Feature 077 (D-87 drain) — who still points at a country?
  //
  // `CountryService.remove` used to answer that with raw counts over
  // `addresses`, `taxes` and `organizations`, and the orphan report with twelve
  // `left join`s over eleven tables in nine modules. Every one of them named a
  // table this module does not own, in a string no import-level boundary check
  // can see. Contributors push a descriptor from their own boot hook now.
  //
  // A plain `ctx.di.register`, not a port: a contributor resolves it from a boot
  // hook, and a boot hook that resolved a transient gate would stop the backend
  // from starting the moment this module was switched off. Enumeration policy is
  // stated at the class.
  ctx.di.register({
    countryReferenceRegistry: ctx
      .asFunction(() => new CountryReferenceRegistry())
      .singleton(),
  });

  ctx.di.providePort(
    'dictionaryValidator',
    ctx
      .asFunction(
        ({ emFactory }: DictionariesCradle) =>
          new DictionaryValidatorService(
            emFactory,
            lazyPort<CurrencyReadPort>(ctx, 'currencyReadPort'),
            lazyPort<LanguageReadPort>(ctx, 'languageReadPort'),
          ),
      )
      .singleton(),
  );

  // Whoever caches currency or language data drops its own when told. This
  // module is one of them, and now says so itself rather than being reached
  // into by a root.
  //
  // The two sales-channel events are issue #101's other half. The registry a
  // storefront reads is *scoped to a channel* — `languages` and `currencies`
  // are filtered by the channel's own lists, and `defaults` come off its
  // `defaultLanguage` / `defaultCurrency` — so a channel write invalidates this
  // cache exactly as a currency or language write does. Nothing subscribed
  // before, so a PATCH of the default channel's languages served the old
  // registry until the entry's hour expired, and a flag move (D-51) changed
  // which channel the platform-wide read resolves without dropping anything.
  // `identity_changed` covers the PATCH, `lifecycle_changed` the move and the
  // deactivations. Both are EventBus announcements — no manifest dependency,
  // and none is wanted: `sales_channels` must not know who caches its rows.
  const invalidationEvents = [
    CURRENCY_CHANGED_EVENT,
    LANGUAGE_CHANGED_EVENT,
    'sales_channels.identity_changed',
    'sales_channels.lifecycle_changed',
  ];
  for (const event of invalidationEvents) {
    ctx.subscribe(event, async () => {
      await ctx.cradle<DictionariesCradle>().dictionaryInvalidator();
    });
  }

  /**
   * `countries.default_currency_code` points at `currencies`, so this module is
   * one of that dictionary's consumers and contributes a descriptor like any
   * other. `blocking: false` — the column's own foreign key is
   * `on delete set null`, so the reference is worth reporting to an operator
   * about to blank it but must not refuse the delete, which is exactly what the
   * hand-written version said in a comment and expressed by leaving the count
   * out of a sum.
   *
   * A contribution hook, kept separate from the seeding hook below: it must run
   * whatever this module's state, and pushes an inert descriptor into an ungated
   * registry (D-62). `product_feeds/backend.ts` is the shipped example of the
   * pair.
   */
  ctx.onBoot(() => {
    registerCountryCurrencyReference(
      lazyPort<DictionaryReferenceRegistryPort>(ctx, 'currencyReferenceRegistry'),
      ctx.cradle<DictionariesCradle>().emFactory,
    );
  });

  ctx.onBoot(async () => {
    // Seeds the ISO reference data. The two tables it seeds that this module
    // does not own — `currencies` and `languages` — go through their owners'
    // published ports since feature 077's D-87 drain; before that they were raw
    // statements naming those tables here.
    await runDictionarySeedReconciler(ctx.cradle<DictionariesCradle>().emFactory, {
      currencySeed: lazyPort<CurrencySeedPort>(ctx, 'currencySeedPort'),
      currencyRead: lazyPort<CurrencyReadPort>(ctx, 'currencyReadPort'),
      languageSeed: lazyPort<LanguageSeedPort>(ctx, 'languageSeedPort'),
      languageRead: lazyPort<LanguageReadPort>(ctx, 'languageReadPort'),
    });
  });

  ctx.routes(async (app) => {
    const {
      emFactory,
      auditLogService,
      requireAdmin,
      dictionaryCache,
      dictionaryInvalidator,
      countryReferenceRegistry,
    } = ctx.cradle<DictionariesCradle>();
    // Resolved once per route registration and handed down, never captured into
    // a singleton: `lazyPort` returns a proxy that resolves the gate per call,
    // so a switched-off owner is answered at the call and not at composition.
    const currencyRead = lazyPort<CurrencyReadPort>(ctx, 'currencyReadPort');
    const languageRead = lazyPort<LanguageReadPort>(ctx, 'languageReadPort');
    await registerDictionaryAdminRoutes(app, {
      emFactory,
      countryService: new CountryService(
        emFactory,
        dictionaryInvalidator,
        auditLogService,
        () => countryReferenceRegistry,
      ),
      currencyRead,
      currencyAdmin: lazyPort<CurrencyAdminPort>(ctx, 'currencyAdminPort'),
      languageRead,
      languageAdmin: lazyPort<LanguageAdminPort>(ctx, 'languageAdminPort'),
      languageCountryService: new LanguageCountryService(
        emFactory,
        languageRead,
        dictionaryInvalidator,
        auditLogService,
      ),
      translationService: new TranslationService(
        emFactory,
        currencyRead,
        languageRead,
        dictionaryInvalidator,
        auditLogService,
      ),
      invalidateDictionaryState: dictionaryInvalidator,
      requireAdmin,
      countryReferences: countryReferenceRegistry,
      currencyReferences: lazyPort<DictionaryReferenceRegistryPort>(
        ctx,
        'currencyReferenceRegistry',
      ),
      languageReferences: lazyPort<DictionaryReferenceRegistryPort>(
        ctx,
        'languageReferenceRegistry',
      ),
    });
    await registerDictionaryStorefrontRoutes(app, {
      readService: new DictionaryReadService(
        emFactory,
        currencyRead,
        languageRead,
        dictionaryCache,
        new LabelResolver(emFactory, currencyRead, languageRead),
      ),
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
 */
export const entities = [
  Country,
  DictionaryTranslation,
  LanguageCountry,
];
