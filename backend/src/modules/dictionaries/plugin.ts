// Dictionaries module plugin — feature 017 / T004 (skeleton).
//
// Phase 1 establishes the export shape so downstream tasks (services, routes,
// validator, seed reconciler) can hang implementations on a stable handle.
// Real wiring lands in Phase 2 (T011, T013) and the user-story phases.

import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { DictionaryValidator as DictionaryValidatorPort } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import {
  runDictionarySeedReconciler,
  type SeedReconcilerSummary,
} from './services/seed-reconciler.js';
import { CountryService } from './services/country-service.js';
import { LanguageCountryService } from './services/language-country-service.js';
import { DictionaryCache } from './services/dictionary-cache.js';
import { DictionaryReadService } from './services/dictionary-read-service.js';
import { DictionaryValidator as DictionaryValidatorService } from './services/dictionary-validator.js';
import { LabelResolver } from './services/label-resolver.js';
import { TranslationService } from './services/translation-service.js';
import { registerDictionaryAdminRoutes } from './routes.admin.js';
import { registerDictionaryStorefrontRoutes } from './routes.storefront.js';
import { LanguageService } from '../languages/services/language-service.js';
import type { CurrencyService } from '../currencies/services/currency-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface DictionariesModuleOptions {
  emFactory: () => EntityManager;
  /**
   * Feature 072 (wave 1) — `currencies` owns this. Injected rather than built
   * here, because `languages` used to build a second one with a different
   * invalidator and the two diverged silently.
   */
  currencyService: CurrencyService;
  requireAdmin?: RequireAdminFactory;
  /** Redis is optional — when absent, the registry cache is skipped. */
  redis?: Redis;
  /** Feature 054 — audits dictionary writes co-transactionally when provided. */
  auditLog?: AuditLogService;
}

export interface DictionariesModuleHandle {
  /** Cross-module validator port — wired in Phase 6 (US4). */
  validator: DictionaryValidatorPort;
  /** Storefront registry cache, present when Redis is wired. */
  cache: DictionaryCache | undefined;
  /**
   * Run the boot reconciler (currencies + countries + Polish translations +
   * primary language↔country associations). Idempotent — operator edits are
   * preserved (FR-019).
   */
  reconcile(): Promise<SeedReconcilerSummary>;
}

export function dictionariesModule(options: DictionariesModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: DictionariesModuleHandle;
} {
  let reconciled = false;
  const cache = options.redis ? new DictionaryCache(options.redis) : undefined;
  const validator = new DictionaryValidatorService(options.emFactory);
  const invalidateDictionaryState = async (): Promise<void> => {
    validator.invalidate();
    await cache?.invalidateAll();
  };
  const labelResolver = new LabelResolver(options.emFactory);
  const readService = new DictionaryReadService(options.emFactory, cache, labelResolver);
  const translationService = new TranslationService(
    options.emFactory,
    invalidateDictionaryState,
    options.auditLog,
  );

  const handle: DictionariesModuleHandle = {
    validator,
    cache,
    reconcile: async () => {
      const summary = await runDictionarySeedReconciler(options.emFactory);
      reconciled = true;
      return summary;
    },
  };

  const plugin = async (app: FastifyInstance) => {
    if (!reconciled) {
      await handle.reconcile();
    }
    if (options.requireAdmin) {
      await registerDictionaryAdminRoutes(app, {
        emFactory: options.emFactory,
        countryService: new CountryService(options.emFactory, invalidateDictionaryState, options.auditLog),
        currencyService: options.currencyService,
        languageService: new LanguageService(options.emFactory, invalidateDictionaryState, options.auditLog),
        languageCountryService: new LanguageCountryService(
          options.emFactory,
          invalidateDictionaryState,
          options.auditLog,
        ),
        translationService,
        invalidateDictionaryState,
        requireAdmin: options.requireAdmin,
      });
    }
    await registerDictionaryStorefrontRoutes(app, { readService });
  };

  return { plugin, handle };
}
