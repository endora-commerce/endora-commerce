import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { CurrencyService } from '../currencies/services/currency-service.js';
import { LanguageService } from './services/language-service.js';
import { LocaleService } from './services/locale-service.js';
import { registerI18nRoutes } from './routes.js';

/**
 * `languages` — the stale-accept `currencies` already fixed, still live here
 * (feature 072, wave 2, T105).
 *
 * `LanguageService`'s second constructor argument is a dictionary-cache
 * invalidator, and the factory passed a hard-coded `undefined`:
 *
 *     new LanguageService(options.emFactory, undefined, options.auditLog)
 *
 * So deactivating or deleting a language through this module's admin surface
 * dropped nothing. `DictionaryValidator` caches existence and active-state
 * in-process for 60 s (`TTL_MS`), and the Redis `DictionaryCache` holds
 * dictionary reads for an hour by default — so a removed language kept
 * validating for up to a minute in each process and kept being served for up to
 * an hour. Meanwhile `currencies` announces its changes and both caches drop
 * immediately. One validator, one platform, two behaviours.
 *
 * Wave 1 fixed the currency half (`f3bacb52`, "one CurrencyService, and the
 * stale-accept it was caching") and left this half because `languages` was not
 * yet converted. This closes it the same way, and the way matters: the module
 * **announces** rather than calling the dictionary cache. Declaring that call as
 * a dependency produces a real cycle — `dictionaries` reads `Language`, so
 * `languages` calling into `dictionaries` would close a loop — and the cycle is
 * the design saying a language must not know a dictionary cache exists. The
 * root listens and invalidates, exactly as it already does for currencies.
 *
 * `auditLog` stops being optional while we are here: language writes are
 * audited or they are not, and "not" should not be reachable by omission.
 */

/** Emitted after any language write; the root drops the dictionary caches. */
export const LANGUAGE_CHANGED_EVENT = 'languages.changed';

export interface LanguagesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  /** Narrowed the same way `currencies` narrows it: announce, do not type. */
  readonly eventBus: { emit: (event: string, payload: unknown) => void };
  readonly requireAdmin: RequireAdminFactory;
  /** Owned by `currencies`; the admin surface here serves both. */
  readonly currencyService: CurrencyService;
  readonly languageService: LanguageService;
  readonly localeService: LocaleService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'languageService',
    ctx
      .asFunction(({ emFactory, auditLogService }: LanguagesCradle) => {
        const announce = async (): Promise<void> => {
          ctx.cradle<LanguagesCradle>().eventBus.emit(LANGUAGE_CHANGED_EVENT, {});
        };
        return new LanguageService(emFactory, announce, auditLogService);
      })
      .singleton(),
  );

  ctx.di.register({
    // `LocaleService` caches the default locale for 60 s and exposes
    // `invalidateDefault()`, so it has to be a singleton — and a singleton may
    // not capture `languageService`, which is a transient port gate. Awilix's
    // strict mode refuses that outright, and it is right to: a captured port
    // keeps answering after its module is switched off. The delegate resolves
    // per call instead.
    localeService: ctx
      .asFunction(
        () =>
          new LocaleService({
            getDefault: () => ctx.cradle<LanguagesCradle>().languageService.getDefault(),
          } as unknown as LanguageService),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { languageService, currencyService, localeService, requireAdmin } =
      ctx.cradle<LanguagesCradle>();
    await registerI18nRoutes(app, {
      languageService,
      currencyService,
      requireAdmin,
      onConfigChange: () => localeService.invalidateDefault(),
    });
  });
}
