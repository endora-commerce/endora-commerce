import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LanguageService } from './services/language-service.js';
import { LocaleService } from './services/locale-service.js';
import type { CurrencyService } from '../currencies/services/currency-service.js';
import { registerI18nRoutes } from './routes.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface I18nModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 054 — audits language/currency writes co-transactionally when provided. */
  auditLog?: AuditLogService;
  /**
   * Feature 072 (wave 1) — `currencies` owns this. This module used to build
   * its own with `undefined` for the dictionary invalidator, so a currency
   * deleted through its surface stayed valid in the dictionary validator.
   */
  currencyService: CurrencyService;
}

export interface I18nModuleHandle {
  languageService: LanguageService;
  currencyService: CurrencyService;
  localeService: LocaleService;
}

export function i18nModule(options: I18nModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: I18nModuleHandle;
} {
  const languageService = new LanguageService(options.emFactory, undefined, options.auditLog);
  const currencyService = options.currencyService;
  const localeService = new LocaleService(languageService);

  return {
    handle: { languageService, currencyService, localeService },
    plugin: async (app: FastifyInstance) => {
      await registerI18nRoutes(app, {
        languageService,
        currencyService,
        requireAdmin: options.requireAdmin,
        onConfigChange: () => localeService.invalidateDefault(),
      });
    },
  };
}
