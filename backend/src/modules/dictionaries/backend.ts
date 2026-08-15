import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { DictionaryValidator as DictionaryValidatorPort } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { CurrencyService } from '../currencies/services/currency-service.js';
import type { LanguageService } from '../languages/services/language-service.js';
import { CURRENCY_CHANGED_EVENT } from '../currencies/backend.js';
import { LANGUAGE_CHANGED_EVENT } from '../languages/backend.js';
import { Country } from './entities/country.entity.js';
import { DictionaryCache } from './services/dictionary-cache.js';
import { DictionaryValidator as DictionaryValidatorService } from './services/dictionary-validator.js';
import { DictionaryReadService } from './services/dictionary-read-service.js';
import { LabelResolver } from './services/label-resolver.js';
import { TranslationService } from './services/translation-service.js';
import { CountryService } from './services/country-service.js';
import { LanguageCountryService } from './services/language-country-service.js';
import { runDictionarySeedReconciler } from './services/seed-reconciler.js';
import { registerDictionaryAdminRoutes } from './routes.admin.js';
import { registerDictionaryStorefrontRoutes } from './routes.storefront.js';

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
 */

export const entities = [Country];

export interface DictionariesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly redis: Redis | undefined;
  readonly requireAdmin: RequireAdminFactory;
  /** Owned by `currencies`; this module's admin surface serves both. */
  readonly currencyService: CurrencyService;
  /** Owned by `languages`; there used to be a second one built here. */
  readonly languageService: LanguageService;
  readonly dictionaryCache: DictionaryCache | undefined;
  readonly dictionaryValidator: DictionaryValidatorPort;
  readonly dictionaryInvalidator: () => Promise<void>;
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

  ctx.di.providePort(
    'dictionaryValidator',
    ctx
      .asFunction(
        ({ emFactory }: DictionariesCradle) => new DictionaryValidatorService(emFactory),
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

  ctx.onBoot(async () => {
    // Seeds the ISO reference data. Reads nothing but its own tables, so unlike
    // `_i18n`'s bundle reconcile this is safe wherever the pass places it.
    await runDictionarySeedReconciler(ctx.cradle<DictionariesCradle>().emFactory);
  });

  ctx.routes(async (app) => {
    const { emFactory, auditLogService, requireAdmin, dictionaryCache, dictionaryInvalidator } =
      ctx.cradle<DictionariesCradle>();
    await registerDictionaryAdminRoutes(app, {
      emFactory,
      countryService: new CountryService(emFactory, dictionaryInvalidator, auditLogService),
      currencyService: lazyPort<CurrencyService>(ctx, 'currencyService'),
      languageService: lazyPort<LanguageService>(ctx, 'languageService'),
      languageCountryService: new LanguageCountryService(
        emFactory,
        dictionaryInvalidator,
        auditLogService,
      ),
      translationService: new TranslationService(
        emFactory,
        dictionaryInvalidator,
        auditLogService,
      ),
      invalidateDictionaryState: dictionaryInvalidator,
      requireAdmin,
    });
    await registerDictionaryStorefrontRoutes(app, {
      readService: new DictionaryReadService(
        emFactory,
        dictionaryCache,
        new LabelResolver(emFactory),
      ),
    });
  });
}
