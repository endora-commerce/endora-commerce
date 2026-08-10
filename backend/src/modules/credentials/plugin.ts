import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '../../commands/index.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ConfigurationTypeRegistry } from './services/configuration-type-registry.js';
import {
  CredentialsService,
  type CredentialsSettingsPort,
} from './services/credentials.service.js';
import {
  registerCredentialsAdminRoutes,
} from './routes.admin.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the credentials module — feature 058.
 *
 * The module owns a `credential_configurations` table and reads configuration
 * types from the process-wide `ConfigurationTypeRegistry` (the cross-module
 * extension seam). Core types (LLM, email adapter) are registered in
 * `composition.ts` at boot (US1), never here.
 */

export type { CredentialsSettingsPort };

export interface CredentialsModuleOptions {
  emFactory: () => EntityManager;
  /** The settings port backing the delete-integrity guard (Principle I, FR-012). */
  settings?: CredentialsSettingsPort;
  permissionService: {
    hasPermission(adminUserId: string, permission: string): Promise<boolean>;
  };
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
  commandBus: CommandBus;
  configurationTypeRegistry: ConfigurationTypeRegistry;
  auditLogService?: AuditLogService;
  /** Base64 AES-256 key for secret fields; shared with settings (research §R4). */
  secretEncryptionKey?: string;
}

export interface CredentialsModuleHandle {
  configurationTypeRegistry: ConfigurationTypeRegistry;
  service: CredentialsService;
}

export interface CredentialsModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: CredentialsModuleHandle;
}

export function credentialsModule(options: CredentialsModuleOptions): CredentialsModuleResult {
  const service = new CredentialsService({
    emFactory: options.emFactory,
    commandBus: options.commandBus,
    registry: options.configurationTypeRegistry,
    secretEncryptionKey: options.secretEncryptionKey,
    ...(options.settings ? { settings: options.settings } : {}),
  });

  return {
    handle: {
      configurationTypeRegistry: options.configurationTypeRegistry,
      service,
    },
    plugin: async (app) => {
      await registerCredentialsAdminRoutes(app, {
        service,
        requireAdmin: options.requireAdmin,
        resolveAdminContext: options.resolveAdminContext,
      });
    },
  };
}
