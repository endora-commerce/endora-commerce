import type { FastifyInstance } from 'fastify';
import {
  AdminModulePresenceResponseSchema,
  ModuleActivationRequestSchema,
  ModuleActivationResponseSchema,
  ModuleListQuerySchema,
  ModuleListResponseSchema,
  apiInterceptorListSchema,
  type AdminModulePresenceResponse,
  type ApiInterceptorList,
  type ModuleActivationResponse,
  type ModuleListResponse,
  type ModulePresence,
} from '@b2b/contracts';
import type { CommandBus } from '../../commands/index.js';
import type { ApiInterceptorRegistry } from '../../http/interceptors/index.js';
import { HttpError } from '../../http/error-envelope.js';
import type { ModuleLifecycleOrchestrator } from './services/orchestrator.js';
import { effectiveState, type ModulePresenceState } from './services/effective-state.js';
import {
  makeSetActivationCommand,
  propagateActivationChange,
  type ActivationPropagation,
} from './commands/activation.commands.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Read-only admin surface for the lifecycle subsystem (feature 018 / E-1).
 *
 * The platform axis stays CLI-only (per `contracts/admin-http.md` E-2
 * deferred): installing, uninstalling, enabling and disabling a module at
 * deployment level is deployment-operator work. The admin app renders an
 * "Installed Modules" panel from this response and surfaces orphan /
 * pending-upgrade flags as warnings.
 *
 * Feature 073 adds the **other** axis — the business operator's activation
 * control — plus the presence projection both frontends resolve their surfaces
 * from. Those two are not the same thing and the API keeps them apart.
 */

/** Wire shape for one module. The conjunction is computed here, once. */
function toPresenceDto(state: ModulePresenceState): ModulePresence {
  return {
    id: state.moduleId,
    present: state.platformAvailable && state.operatorActivated,
    platformState: state.platformState,
    activated: state.operatorActivated,
    deactivatable: state.deactivatable,
    nonDeactivatableReason: state.nonDeactivatableReason,
  };
}

export interface LifecycleAdminDeps {
  orchestrator: ModuleLifecycleOrchestrator;
  requireAdmin: RequireAdminFactory;
}

export async function registerLifecycleAdminRoutes(
  app: FastifyInstance,
  deps: LifecycleAdminDeps,
): Promise<void> {
  app.get<{ Querystring: { state?: string; flag?: string } }>(
    '/api/v1/admin/modules',
    {
      preHandler: deps.requireAdmin('platform.modules.read'),
      schema: {
        querystring: ModuleListQuerySchema,
        response: { 200: ModuleListResponseSchema },
      },
    },
    async (request): Promise<ModuleListResponse> => {
      const query = ModuleListQuerySchema.parse(request.query);
      const all = await deps.orchestrator.status();
      let modules = all;
      if (query.state) {
        modules = modules.filter((m) => m.state === query.state);
      }
      if (query.flag) {
        modules = modules.filter((m) => m.flags.includes(query.flag!));
      }
      return { modules };
    },
  );
}

export interface ModulePresenceAdminDeps {
  requireAdmin: RequireAdminFactory;
  /**
   * The write path's collaborators. Omitted in a composition that has no
   * Command Bus — the projection still serves, because rendering a correct
   * navigation must not depend on being able to change it.
   */
  activation?: {
    commandBus: CommandBus;
    propagation: ActivationPropagation;
  };
}

/**
 * Feature 073 — the presence projection and the activation write.
 *
 * Registered outside `defineModuleRoutes`: `_lifecycle` is non-deactivatable,
 * and gating the surface that tells the frontends what is present on the very
 * state it reports would be circular.
 */
export function registerModulePresenceRoutes(
  app: FastifyInstance,
  deps: ModulePresenceAdminDeps,
): void {
  /**
   * No permission code, deliberately. Every admin needs this to render their
   * own navigation; `platform.modules.read` is a restricted code, and gating
   * presence behind it would leave most admins with an unfiltered sidebar —
   * the exact leak this feature exists to close.
   */
  app.get(
    '/api/v1/admin/module-presence',
    {
      preHandler: deps.requireAdmin(),
      schema: { response: { 200: AdminModulePresenceResponseSchema } },
    },
    async (): Promise<AdminModulePresenceResponse> => ({
      modules: effectiveState.all().map(toPresenceDto),
      degraded: effectiveState.isDegraded(),
    }),
  );

  if (!deps.activation) return;
  const { commandBus, propagation } = deps.activation;

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/modules/:id/activation',
    {
      preHandler: deps.requireAdmin('platform.modules.activate'),
      schema: {
        body: ModuleActivationRequestSchema,
        response: { 200: ModuleActivationResponseSchema },
      },
    },
    async (request): Promise<ModuleActivationResponse> => {
      const body = ModuleActivationRequestSchema.parse(request.body);
      const moduleId = request.params.id;

      // The Command's factory performs the refusals, so an invalid flip never
      // opens a transaction. `CommandBus.run` resolves the actor from the
      // ambient TenantContext and throws without one, which satisfies FR-007's
      // actor requirement without this handler naming an actor at all.
      const result = await commandBus.run(
        makeSetActivationCommand({ moduleId, active: body.active }),
      );
      await propagateActivationChange(propagation, result);

      const presence = effectiveState.presence(moduleId);
      if (!presence) {
        throw new HttpError(
          500,
          'INTERNAL',
          `Module "${moduleId}" vanished from the presence projection after its activation was written.`,
        );
      }
      return { module: toPresenceDto(presence) };
    },
  );
}

export interface ApiInterceptorAdminDeps {
  registry: ApiInterceptorRegistry;
  requireAdmin: RequireAdminFactory;
}

/**
 * Feature 060 — read-only diagnostics for the API interceptor mechanism.
 * The response IS the execution plan: items sorted by target, then phase
 * (pre before post), then execution order. `moduleEnabled` is resolved live
 * from the enabled-set predicate at request time. Registrations are shipped
 * module code, so there is no write surface (and no Command Bus involvement).
 */
export function registerApiInterceptorAdminRoutes(
  app: FastifyInstance,
  deps: ApiInterceptorAdminDeps,
): void {
  app.get(
    '/api/v1/admin/api-interceptors',
    {
      preHandler: deps.requireAdmin('platform.modules.read'),
      schema: { response: { 200: apiInterceptorListSchema } },
    },
    async (): Promise<ApiInterceptorList> => ({
      items: deps.registry.list().map((item) => ({
        ...item,
        moduleEnabled: deps.registry.isModuleEnabled(item.module),
      })),
    }),
  );
}
