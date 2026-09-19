import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { effectiveState, lazyPort } from '@endora-commerce/platform/kernel';
import { CAPABILITY_KEYS, type PimConnectorRegistryPort } from '@endora-commerce/contracts';
import { PimConnectorActivationLock } from './entities/pim-connector-activation-lock.entity.js';
import { PimConnectorRegistryService } from './services/pim-connector-registry.service.js';

interface PimConnectorCradle {
  emFactory: () => import('@mikro-orm/postgresql').EntityManager;
}

interface ModuleActivationChangedPayload {
  moduleId?: string;
  active?: boolean;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort<PimConnectorRegistryPort>(
    'pimConnectorRegistryPort',
    ctx
      .asFunction(({ emFactory }: PimConnectorCradle) => new PimConnectorRegistryService(emFactory))
      .singleton(),
  );

  /**
   * **The** exclusivity seam — one interceptor, registered by the capability's
   * owner over the derived family (feature 132,
   * `specs/132-connector-family-discovery/contracts/capability-exclusivity.md`
   * R1.1–R1.2).
   *
   * It used to be registered by **one member**, with that member's own id
   * hard-coded in the handler, so every new connector had to remember to write one
   * — and two of the four shipped ones did not. Registered here over
   * `declaredMembersOfCapability`, a connector that declares membership is
   * covered **by existing**, and the failure mode stops being a silent gap.
   *
   * Three properties of the placement are load-bearing:
   *
   *  - **This module is always present.** It declares
   *    `activation.nonDeactivatable`, so the seam cannot be switched off by the
   *    operator whose activation attempt it is judging.
   *  - **Interceptor gating uses the platform axis** (`registryCache.isEnabled`),
   *    so the handler still runs while the *member* is operator-deactivated —
   *    which is exactly when an activation attempt arrives.
   *  - **It refuses before the audited Command runs** (`pre`), so a refused
   *    activation writes nothing: Principle XIII keeps the write audited and this
   *    keeps the refusal out of the write's way.
   *
   * The membership test reads **declared** members, not effective ones: the
   * question is "is the module being activated one of mine", and a module about
   * to be switched on is by definition not effectively present. Which members
   * *hold* the claim is the registry's question, and it resolves effective
   * presence (R2.2).
   */
  ctx.interceptors([
    {
      id: 'refuse-when-another-family-member-is-active',
      target: 'POST /api/v1/admin/modules/:id/activation',
      phase: 'pre',
      handler: async (interceptorCtx: {
        params: unknown;
        body: unknown;
      }): Promise<void> => {
        const { params, body } = interceptorCtx;
        const moduleId =
          params !== null && typeof params === 'object' && 'id' in params
            ? String((params as { id: unknown }).id)
            : '';
        const active =
          body !== null &&
          typeof body === 'object' &&
          'active' in body &&
          (body as { active: unknown }).active === true;
        // Deactivation is never refused by this seam (R2.4).
        if (moduleId === '' || !active) return;
        if (!isFamilyMember(moduleId)) return;
        await lazyPort<PimConnectorRegistryPort>(ctx, 'pimConnectorRegistryPort').assertCanActivate(
          moduleId,
        );
      },
    },
  ]);

  /**
   * Feature 089 / T079 — mirror a member's successful activation flip onto the
   * diagnostic lock row. Owned here (always present) so the handler still runs
   * when the event fires before local presence has refreshed after activate, and
   * after deactivate when the member itself is already absent.
   *
   * Feature 132 — the test compared `event.moduleId` against one connector's id
   * written out here, so the lock was accurate for one connector out of four and
   * this module named a member it does not own. It is a membership test over the
   * derived family now, and **declared**
   * membership is the right side of it for the reason above: on a deactivation the
   * member is already absent, so an effective-presence test would drop exactly the
   * event that has to clear the lock.
   */
  ctx.subscribe('module.activation.changed', async (payload) => {
    const event = payload as ModuleActivationChangedPayload;
    const moduleId = event.moduleId;
    if (moduleId === undefined || typeof event.active !== 'boolean') return;
    if (!isFamilyMember(moduleId)) return;
    const registry = lazyPort<PimConnectorRegistryPort>(ctx, 'pimConnectorRegistryPort');
    if (event.active) {
      await registry.recordActive(moduleId, null);
    } else {
      await registry.clearActive(moduleId);
    }
  });
}

/**
 * Whether `moduleId` declared membership of the capability this module owns.
 *
 * The family is read from the platform on every call rather than captured at
 * registration: `registryCache` is re-installed by the `b2b:module:state-changed`
 * refresh, and a list closed over at composition time would answer for the
 * deployment as it was when this module registered.
 */
function isFamilyMember(moduleId: string): boolean {
  return effectiveState
    .declaredMembersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR)
    .includes(moduleId);
}

export const entities = [PimConnectorActivationLock];
