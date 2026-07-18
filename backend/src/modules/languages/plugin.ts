import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LanguageService } from './services/language-service.js';
import { LocaleService } from './services/locale-service.js';
import { CurrencyService } from '../currencies/services/currency-service.js';
import { registerI18nRoutes } from './routes.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface I18nModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 054 — audits language/currency writes co-transactionally when provided. */
  auditLog?: AuditLogService;
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
  const currencyService = new CurrencyService(options.emFactory, undefined, options.auditLog);
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
