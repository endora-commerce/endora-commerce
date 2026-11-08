import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  MFA_SETTING_CODES,
  AdminModulePresenceResponseSchema,
  ModuleActivationRequestSchema,
  ModuleActivationResponseSchema,
  ModuleDeactivationImpactSchema,
  ModuleListQuerySchema,
  ModuleListResponseSchema,
  apiInterceptorListSchema,
  type AdminModulePresenceResponse,
  type ApiInterceptorList,
  type MfaDeactivationGuardPort,
  type MfaEnrolmentCountPort,
  type ModuleActivationResponse,
  type ModuleDeactivationImpact,
  type ModuleListResponse,
} from '@endora-commerce/contracts';
import type { CommandBus } from '../commands/index.js';
import type { ApiInterceptorRegistry } from '../http/interceptors/index.js';
import { HttpError } from '../http/error-envelope.js';
import type { ModuleLifecycleOrchestrator } from './services/orchestrator.js';
import { effectiveState, toModulePresenceDto } from '../kernel/lifecycle/effective-state.js';
import { rethrowIfModuleDisabled } from '../kernel/lifecycle/plugin-helpers.js';
import {
  makeSetActivationCommand,
  propagateActivationChange,
  type ActivationPropagation,
} from './commands/activation.commands.js';
import type { RequireAdminFactory } from '../kernel/ports/require-admin.js';

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

/**
 * Wire shape for one module. The conjunction is computed once, in the kernel,
 * because a second surface reports a module's presence too (issue #96).
 */
const toPresenceDto = toModulePresenceDto;

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
  /**
   * `mfa`'s live enrolment count, for the deactivation-impact projection.
   * Resolved lazily by `backend.ts`; this surface decides `mfa`'s presence
   * before it calls, and treats a failure as "unavailable".
   */
  mfaEnrolmentCount: MfaEnrolmentCountPort;
  /**
   * `mfa`'s answer to "is a second factor required of administrators right
   * now?" — by the setting or by a role's flag — asked before `mfa` is switched
   * off. Resolved lazily like the count; unlike the count, a failed read
   * refuses the switch-off.
   */
  mfaDeactivationGuard: MfaDeactivationGuardPort;
}

/**
 * Refuse switching `mfa` off while the platform requires administrators to
 * sign in with a second factor.
 *
 * Off means no second factor at all (D-96), so the switch-off would take the
 * administrator requirement with it in one step, as a side effect of a module
 * toggle. The requirement has two sources since issue #349 — the setting
 * `mfa.admin.totp_enforced` and any admin role whose `requiresTwoFactor` is
 * set — and each is turned off first, as its own change; the switch-off then
 * goes through exactly as before. Voluntary enrolments do not block it — the
 * deactivation dialog shows how many there are (D-96.5).
 *
 * The refusal names what to turn off. `details.roleCodes` is the list a client
 * reads; `details.roles` is the same list as text for the sentence, and
 * `details.code` is the token that picks the sentence
 * (`errors.MFA_DEACTIVATION_BLOCKED.<token>`): none when the setting alone
 * requires it, which keeps the sentence it always had.
 *
 * Asked only while `mfa` is present: the port is read through an open gate,
 * and a module that is already off has no requirement left to protect. Only
 * the switch-off is guarded; switching `mfa` back on is never refused here.
 */
export async function assertMfaMayBeSwitchedOff(
  moduleId: string,
  active: boolean,
  guard: MfaDeactivationGuardPort,
): Promise<void> {
  if (moduleId !== 'mfa' || active || !effectiveState.isPresent('mfa')) return;
  const setting = MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED;
  const requirement = await guard.requirement();
  const roleCodes = [...requirement.roleCodes];
  if (!requirement.setting && roleCodes.length === 0) return;
  if (roleCodes.length === 0) {
    throw new HttpError(
      409,
      ERROR_CODES.MFA_DEACTIVATION_BLOCKED,
      'Two-factor authentication cannot be switched off while administrators are required to ' +
        `use it. Turn off "${setting}" first, then switch the module off.`,
      { moduleId, setting, roleCodes },
    );
  }
  const roles = roleCodes.join(', ');
  const turnOff = requirement.setting
    ? `"${setting}" and the two-factor requirement of the roles ${roles}`
    : `the two-factor requirement of the roles ${roles}`;
  throw new HttpError(
    409,
    ERROR_CODES.MFA_DEACTIVATION_BLOCKED,
    'Two-factor authentication cannot be switched off while administrators are required to ' +
      `use it. Turn off ${turnOff} first, then switch the module off.`,
    {
      moduleId,
      setting,
      roleCodes,
      roles,
      code: requirement.setting ? 'setting_and_role_requirement' : 'role_requirement',
    },
  );
}

/**
 * Feature 073 — the presence projection and the activation write.
 *
 * Registered outside `defineModuleRoutes`, and not because this module holds a
 * privilege: gating a surface that reports on module presence on module
 * presence is circular, which is the same argument `ctx.ungatedRoutes` states
 * for the liveness probes (D-36b).
 *
 * The activation write joins them under D-36. It backs the kernel-served
 * `/platform/modules` screen rather than a module's own admin surface, so
 * switching a module off can no longer remove the control that would switch it
 * back on — the circle is gone rather than patched with a flag.
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

  /**
   * The live half of the deactivation confirmation — the owner's ruling on
   * D-96.5, and the **first live datum** on a screen whose consequence rows are
   * otherwise static facts about the code (one `whenAbsent` sentence per
   * present dependent, from a manifest, computed by
   * `deactivationConsequencesFor`).
   *
   * Read here rather than at flip time on purpose: the dialog renders *before*
   * the operator confirms, while the module is still on, so
   * `mfaEnrolmentCountPort` is asked through an **open** gate. The same
   * question after the flip would be a read of `mfa_enrolments` through a
   * closed one, which is why the "refuse only enrolled subjects" answer was
   * ruled unimplementable (D-96.7). Nothing is cached, denormalised, or
   * expected to survive deactivation.
   *
   * Two failure modes, one policy: **the number never blocks the flip.** If
   * `mfa` is already off there is no dialog and no count; if the read fails,
   * this answers `null` and the dialog renders the rest of the consequences
   * saying the count is unavailable. The presence decision is taken *before*
   * the `try`, so an absent module and a broken query are not one silent
   * `null`, and `rethrowIfModuleDisabled` is the first line of the `catch` so a
   * flip racing this read still fails closed rather than being laundered into
   * "unavailable".
   */
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/modules/:id/deactivation-impact',
    {
      preHandler: deps.requireAdmin('platform.modules.activate'),
      schema: { response: { 200: ModuleDeactivationImpactSchema } },
    },
    async (request): Promise<ModuleDeactivationImpact> => {
      const moduleId = request.params.id;
      // An id neither the registry nor a manifest knows has no deactivation to
      // describe — the activation write's answer for it (issue #793). Unchecked,
      // it reached the response schema, whose module-id pattern turned it into a 500.
      if (!effectiveState.presence(moduleId)) {
        throw new HttpError(
          404,
          ERROR_CODES.MODULE_NOT_FOUND,
          `No module "${moduleId}" is registered on this deployment.`,
        );
      }
      if (moduleId !== 'mfa' || !effectiveState.isPresent('mfa')) {
        return { moduleId, activeSecondFactorUsers: null };
      }
      try {
        return {
          moduleId,
          activeSecondFactorUsers: await deps.mfaEnrolmentCount.countActiveEnrolments(),
        };
      } catch (error) {
        // Narrow tolerance, and the reason is the product's: an operator must
        // be able to switch a module off when a count cannot be produced.
        // Everything else in the dialog is still true without it.
        rethrowIfModuleDisabled(error);
        request.log.warn(
          { err: error, moduleId },
          '[lifecycle] the active-second-factor count could not be read; the deactivation ' +
            'dialog renders without it',
        );
        return { moduleId, activeSecondFactorUsers: null };
      }
    },
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
      await assertMfaMayBeSwitchedOff(moduleId, body.active, deps.mfaDeactivationGuard);

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
