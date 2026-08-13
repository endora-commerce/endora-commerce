import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { effectiveState } from '../_lifecycle/services/effective-state.js';
import type { PromptActionRequest } from './entities/prompt-action-request.entity.js';
import { registerPromptActionsAdminRoutes } from './routes.admin.js';
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

/**
 * `prompt_actions` — the module every other module contributes *into*
 * (feature 072, wave 1).
 *
 * It owns no domain logic. Its whole job is to hold the tool catalogue that
 * `catalog`, `inventory` and `orders` populate, hand a permission-filtered view
 * of it to an LLM, and execute the confirmed plan through the contributors'
 * own services. That inverts the usual direction — this module is nobody's
 * dependency and everybody's dependant — so nothing here is a port. A port is
 * for a name *other* modules resolve; the two names this module publishes are
 * read by the composition root, which is not gated by anything.
 *
 * **`promptActionToolRegistry` is deliberately an ordinary registration.**
 * Making it a port would mean the root gets a 503 while contributing tools if
 * the operator switched the assistant off — at composition time, before the
 * effective state is even loaded. Contribution has to be tolerant; it is the
 * *routes* that gate, and they already do.
 *
 * **No `activation:` declaration, deliberately.** The module already ships
 * `prompt_actions.enabled`, and it is *not* an activation control in the
 * Constitution XVII sense: switching it off is supposed to leave the capability
 * endpoint answering `200 {status: 'disabled'}` and submissions answering `409
 * ASSISTANT_DISABLED`, which is what the admin palette reads to hide the prompt
 * mode. Declaring it as the activation setting would make `ctx.routes` 503 the
 * whole surface instead, including the probe the palette needs to *learn* the
 * module is off. Reconciling a bespoke kill switch with the two-axis machinery
 * is feature 073's problem, not this conversion's; until then the module is
 * gated on the platform axis alone — which is one axis more than it had.
 *
 * The one behaviour change: tool visibility now resolves `effectiveState`
 * rather than `registryCache.isEnabled`. See
 * `test/integration/prompt_actions/deactivated-module-tools.test.ts` — the old
 * seam advertised tools belonging to a module the operator had deactivated.
 */

export interface PromptActionsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly settingsReadPort: SettingsReadPort;
  readonly settingsChannelResolver: () => Promise<string>;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly permissionService: {
    hasPermission(adminUserId: string, permission: string): Promise<boolean>;
  };
  readonly credentialsService: CredentialResolvePort;
  /**
   * Contributed by `catalog` when a deployment ships it, so a delegated bulk
   * request can show live progress. Absent is a supported state — the request
   * simply reports no progress — which is why this module does not declare
   * `catalog` as a dependency for it.
   */
  readonly promptActionsBulkProgressResolver:
    | ((row: PromptActionRequest, em: EntityManager) => Promise<void>)
    | undefined;
  /** Test seams; a root overrides them by re-registering the name. */
  readonly promptActionsLlmFetch: FetchLike | undefined;
  readonly promptActionsNow: (() => Date) | undefined;
  readonly promptActionsTtlMinutes: number | undefined;

  readonly promptActionToolRegistry: PromptActionToolRegistry;
  readonly llmProviderFactory: LlmProviderFactory;
  readonly promptRequestService: PromptRequestService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    promptActionToolRegistry: ctx.asFunction(() => new PromptActionToolRegistry()).singleton(),

    // Contribution points, defaulted to empty by their owner. A deployment
    // that ships `catalog` overrides the resolver from its composition root;
    // one that does not gets the documented absent behaviour rather than an
    // `AwilixResolutionError` at first request.
    promptActionsBulkProgressResolver: ctx
      .asFunction(
        (): ((row: PromptActionRequest, em: EntityManager) => Promise<void>) | undefined =>
          undefined,
      )
      .singleton(),

    promptActionsLlmFetch: ctx.asFunction((): FetchLike | undefined => undefined).singleton(),
    promptActionsNow: ctx.asFunction((): (() => Date) | undefined => undefined).singleton(),
    promptActionsTtlMinutes: ctx.asFunction((): number | undefined => undefined).singleton(),

    llmProviderFactory: ctx
      .asFunction(
        ({ promptActionsLlmFetch }: PromptActionsCradle) => {
          // `credentialsService` is a **port**, so it is resolved per call
          // rather than captured. Awilix's strict mode refuses the capture
          // outright — a singleton may not hold a transient — and it is right
          // to: a captured port keeps answering after the operator switches
          // `credentials` off, so the assistant would go on decrypting API
          // keys through a module that is supposed to be absent. Resolving per
          // call turns that into the 503 the port exists to produce, and only
          // on the path that actually needs a secret.
          const credentials: CredentialResolvePort = {
            resolve: (configurationCode) =>
              ctx.cradle<PromptActionsCradle>().credentialsService.resolve(configurationCode),
          };
          return new LlmProviderFactory({
            settings: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
            // A function-valued name, so it cannot go through `lazyPort` —
            // that forwards method calls on an object. The closure is the same
            // deferral by hand.
            resolveChannelId: () =>
              ctx.cradle<PromptActionsCradle>().settingsChannelResolver(),
            credentials,
            ...(promptActionsLlmFetch === undefined
              ? {}
              : { fetchImpl: promptActionsLlmFetch }),
          });
        },
      )
      .singleton(),

    promptRequestService: ctx
      .asFunction(
        ({
          emFactory,
          auditLogService,
          promptActionToolRegistry,
          llmProviderFactory,
          promptActionsNow,
          promptActionsTtlMinutes,
        }: PromptActionsCradle) => {
          // `maxRounds` is not threaded through a container seam: the old
          // options type carried one and nothing ever passed it. The property
          // it guards is covered where it belongs, in the interpreter's own
          // unit test, which constructs the service directly.
          const interpreter = new InterpreterService({
            registry: promptActionToolRegistry,
            providerFactory: llmProviderFactory,
            ...(promptActionsNow === undefined
              ? {}
              : { now: () => promptActionsNow().getTime() }),
          });

          const visibilityFor: OperatorVisibilityFactory = (adminUserId) => ({
            hasPermission: (permission) =>
              ctx.cradle<PromptActionsCradle>().permissionService.hasPermission(
                adminUserId,
                permission,
              ),
            // Constitution XVII: presence is the conjunction of both axes. A
            // module the operator deactivated must not appear in the
            // catalogue, or the assistant plans work the platform refuses.
            isModuleInstalled: async (moduleId) => effectiveState.isPresent(moduleId),
          });

          const bulkProgressResolver =
            ctx.cradle<PromptActionsCradle>().promptActionsBulkProgressResolver;

          return new PromptRequestService({
            emFactory,
            interpreter,
            executor: new PlanExecutorService(promptActionToolRegistry),
            visibilityFor,
            auditLogService,
            ...(bulkProgressResolver === undefined ? {} : { bulkProgressResolver }),
            ...(promptActionsNow === undefined ? {} : { now: promptActionsNow }),
            ...(promptActionsTtlMinutes === undefined
              ? {}
              : { ttlMinutes: promptActionsTtlMinutes }),
          });
        },
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { promptRequestService, llmProviderFactory, requireAdmin, adminContextResolver } =
      ctx.cradle<PromptActionsCradle>();
    await registerPromptActionsAdminRoutes(app, {
      requestService: promptRequestService,
      providerFactory: llmProviderFactory,
      requireAdmin,
      resolveAdminContext: adminContextResolver,
    });
  });
}
