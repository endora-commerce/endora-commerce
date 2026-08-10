import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { InterpreterService } from './services/interpreter.service.js';
import { PlanExecutorService } from './services/plan-executor.service.js';
import {
  PromptRequestService,
  type OperatorVisibilityFactory,
} from './services/prompt-request.service.js';
import { PromptActionToolRegistry } from './services/tool-registry.js';
import {
  LlmProviderFactory,
  type CredentialResolvePort,
  type SettingsReadPort,
} from './services/llm/provider-factory.js';
import type { FetchLike } from './services/llm/provider.js';
import type { PromptActionRequest } from './entities/prompt-action-request.entity.js';
import {
  registerPromptActionsAdminRoutes,
} from './routes.admin.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the prompt_actions module — feature 043.
 *
 * The module owns zero domain logic: catalog/inventory contribute tool
 * handlers into `handle.registry` at composition time (`composition.ts`),
 * mirroring the payment/shipping adapter-registry pattern (Principle I).
 */

export interface PromptActionsModuleOptions {
  emFactory: () => EntityManager;
  settings: SettingsReadPort;
  /** Channel used to resolve the global-scope assistant settings. */
  resolveSettingsChannelId: () => Promise<string>;
  permissionService: { hasPermission(adminUserId: string, permission: string): Promise<boolean> };
  isModuleInstalled: (moduleId: string) => boolean;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
  auditLogService?: AuditLogService;
  /** Feature 058 — resolves `prompt_actions.llm_credentials`; falls back to legacy settings when absent. */
  credentials?: CredentialResolvePort;
  /** Injected in tests to script provider responses; defaults to global fetch. */
  llmFetch?: FetchLike;
  /** US2: folds live catalog bulk-operation progress into delegated requests. */
  bulkProgressResolver?: (row: PromptActionRequest, em: EntityManager) => Promise<void>;
  /** Test seams. */
  now?: () => Date;
  ttlMinutes?: number;
  interpreterMaxRounds?: number;
}

export interface PromptActionsModuleHandle {
  registry: PromptActionToolRegistry;
  requestService: PromptRequestService;
  providerFactory: LlmProviderFactory;
}

export interface PromptActionsModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: PromptActionsModuleHandle;
}

export function promptActionsModule(
  options: PromptActionsModuleOptions,
): PromptActionsModuleResult {
  const registry = new PromptActionToolRegistry();

  const providerFactory = new LlmProviderFactory({
    settings: options.settings,
    resolveChannelId: options.resolveSettingsChannelId,
    ...(options.llmFetch !== undefined ? { fetchImpl: options.llmFetch } : {}),
    ...(options.credentials !== undefined ? { credentials: options.credentials } : {}),
  });

  const interpreter = new InterpreterService({
    registry,
    providerFactory,
    ...(options.interpreterMaxRounds !== undefined
      ? { maxRounds: options.interpreterMaxRounds }
      : {}),
    ...(options.now !== undefined ? { now: () => options.now!().getTime() } : {}),
  });

  const executor = new PlanExecutorService(registry);

  const visibilityFor: OperatorVisibilityFactory = (adminUserId) => ({
    hasPermission: (permission) => options.permissionService.hasPermission(adminUserId, permission),
    isModuleInstalled: async (moduleId) => options.isModuleInstalled(moduleId),
  });

  const requestService = new PromptRequestService({
    emFactory: options.emFactory,
    interpreter,
    executor,
    visibilityFor,
    ...(options.auditLogService !== undefined ? { auditLogService: options.auditLogService } : {}),
    ...(options.bulkProgressResolver !== undefined
      ? { bulkProgressResolver: options.bulkProgressResolver }
      : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.ttlMinutes !== undefined ? { ttlMinutes: options.ttlMinutes } : {}),
  });

  return {
    handle: { registry, requestService, providerFactory },
    plugin: async (app) => {
      await registerPromptActionsAdminRoutes(app, {
        requestService,
        providerFactory,
        requireAdmin: options.requireAdmin,
        resolveAdminContext: options.resolveAdminContext,
      });
    },
  };
}
