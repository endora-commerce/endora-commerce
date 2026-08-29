import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import {
  LANGUAGE_CHANGED_EVENT,
  type CurrencyReadPort,
  type DictionaryReferenceRegistryPort,
  type LanguageAdminPort,
  type LanguageReadPort,
  type LanguageSeedPort,
} from '@endora-commerce/contracts';
import { lazyPort, type ModuleContext } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { LanguageService } from './services/language-service.js';
import { LanguageReadService, createLanguageAdminPort } from './services/language-ports.js';
import { LanguageReferenceRegistry } from './services/language-reference-registry.js';
import { LanguageSeedService } from './services/language-seed-service.js';
import { LocaleService } from './services/locale-service.js';
import { registerI18nRoutes } from './routes.js';
import { Language } from './entities/language.entity.js';

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

export interface LanguagesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  /** Narrowed the same way `currencies` narrows it: announce, do not type. */
  readonly eventBus: { emit: (event: string, payload: unknown) => void };
  readonly requireAdmin: RequireAdminFactory;
  readonly languageService: LanguageService;
  readonly localeService: LocaleService;
  readonly languageReferenceRegistry: DictionaryReferenceRegistryPort;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'languageService',
    ctx
      .asFunction(({ emFactory, auditLogService }: LanguagesCradle) => {
        const announce = async (): Promise<void> => {
          ctx.cradle<LanguagesCradle>().eventBus.emit(LANGUAGE_CHANGED_EVENT, {});
        };
        return new LanguageService(emFactory, announce, auditLogService, () =>
          ctx.cradle<LanguagesCradle>().languageReferenceRegistry,
        );
      })
      .singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // `languageService` above hands out the class; ten of the sixteen inbound
  // sites do not want a service at all, they read the `Language` **entity**
  // to resolve a label, validate a code or walk a fallback chain. These two
  // ports are what both halves rewire to, and neither lets the entity across.
  //
  // The write side crosses a boundary by design rather than by accident:
  // `dictionaries` hosts the admin screen for this table. The invariants —
  // exactly one default, a default may not be deactivated, a fallback chain
  // may not cycle — stay on this side of the port, where they already were.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<LanguageReadPort>(
    'languageReadPort',
    ctx
      .asFunction(({ emFactory }: LanguagesCradle) => new LanguageReadService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<LanguageAdminPort>(
    'languageAdminPort',
    ctx
      .asFunction(() =>
        createLanguageAdminPort(() => ctx.cradle<LanguagesCradle>().languageService),
      )
      .singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 077 (D-87 drain) — who still points at a language?
  //
  // `LanguageService.remove` used to answer that with six hand-written counts
  // over `megamenu`, `blog` (twice), `cms` and the kernel's channels. Four of
  // the five named another module's table in a string, which no import-level
  // boundary check can see. Contributors push a descriptor from their own boot
  // hook now, and this module asks the registry instead.
  //
  // A plain `ctx.di.register`, not a port: a contributor resolves it from a boot
  // hook, and a boot hook that resolved a transient gate would stop the backend
  // from starting the moment this module was switched off. The descriptor is
  // inert; `languageService`, which reads and writes languages, is the port and
  // does fail closed. Enumeration policy is stated at the class.
  ctx.di.register({
    languageReferenceRegistry: ctx
      .asFunction(() => new LanguageReferenceRegistry())
      .singleton(),
  });

  /**
   * The one write `dictionaries` needs against this table: filling the empty
   * `native_label` migration 038 left behind. It used to run it as raw SQL from
   * its own reconciler.
   */
  ctx.di.providePort<LanguageSeedPort>(
    'languageSeedPort',
    ctx
      .asFunction(({ emFactory }: LanguagesCradle) => new LanguageSeedService(emFactory))
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
    const { languageService, localeService, requireAdmin } = ctx.cradle<LanguagesCradle>();
    await registerI18nRoutes(app, {
      languageService,
      // Feature 075, Phase C — `GET /api/v1/i18n/config` answers with both
      // catalogues, and `currencies` owns one of them. Its half arrives over
      // the port `currencies` publishes rather than over its service class, so
      // this module names no file of theirs, and the endpoint answers 503
      // `MODULE_DISABLED` if `currencies` ever stops being present. The proxy
      // resolves per call: a port captured in a singleton keeps answering after
      // its owner is switched off.
      //
      // `currencyAdminPort` went with the four `/api/v1/admin/currencies*`
      // routes on 2026-08-29 — that was this module hosting another module's
      // write surface, on the catalogue's permission code, for callers that do
      // not exist. What is left is one composed read.
      currencyRead: lazyPort<CurrencyReadPort>(ctx, 'currencyReadPort'),
      requireAdmin,
      onConfigChange: () => localeService.invalidateDefault(),
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
  Language,
];
