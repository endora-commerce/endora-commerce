import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@b2b/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Setting } from '../../../kernel/settings/setting.entity.js';
import { effectiveState } from '../services/effective-state.js';
import { registryCache } from '../services/registry-cache.js';

/**
 * The operator-activation flip — feature 073 / US1, FR-007, Principle XIII.
 *
 * Hosted by `_lifecycle` rather than `settings`, for three reasons that are
 * easy to lose:
 *
 *  - `_lifecycle` already imports the `Setting` entity (the orchestrator
 *    reconciles rows on install) and already receives `auditLog`, so this adds
 *    no dependency edge in either direction;
 *  - there is **no existing settings-write Command to copy**. `COMMAND_REGISTRY`
 *    has no `setting.*` action and the settings module never receives a
 *    `commandBus`: `SettingsAdminService.setValue` audits by hand *after*
 *    `em.flush()` and outside any transaction, which is exactly the torn-write
 *    window the Command Bus exists to close;
 *  - "activation is not an ordinary setting write" stays visible in the code
 *    rather than being implied by a guard somewhere else.
 *
 * The control still *renders* in the Settings surface, as Constitution XVII
 * requires. Only the write path is dedicated.
 *
 * What this command deliberately does **not** touch is `module_registrations`.
 * The two axes never overwrite each other (FR-003), and that is enforced by
 * this asymmetry rather than by a runtime check: the CLI path writes the
 * registry and never the Setting, this path writes the Setting and never the
 * registry.
 */

export interface SetModuleActivationInput {
  moduleId: string;
  active: boolean;
}

/**
 * Refuse before the Command opens a transaction.
 *
 * A refusal rather than a no-op: a control that silently does nothing is worse
 * than an absent one, because the operator believes they switched something.
 *
 * The dependency-graph refusals (deactivating a module with effectively-present
 * dependents; activating one whose dependency is absent) belong to US2 and are
 * added in the same place.
 */
export function assertActivationWritable(moduleId: string): string {
  const declaration = registryCache.activationDeclaration(moduleId);
  if (!declaration) {
    // Either the id is unknown, or the module has not declared a control yet
    // (the conversion sweep is per batch). Both are "there is nothing here to
    // switch", but they read differently to an operator.
    const known = registryCache.platformStateOf(moduleId) !== 'not-installed';
    if (!known) {
      throw new HttpError(
        404,
        ERROR_CODES.MODULE_NOT_FOUND,
        `No module "${moduleId}" is registered on this deployment.`,
      );
    }
    throw new HttpError(
      409,
      ERROR_CODES.MODULE_NOT_DEACTIVATABLE,
      `Module "${moduleId}" declares no activation control, so it cannot be switched on or off.`,
    );
  }
  if (declaration.settingCode === null) {
    throw new HttpError(
      409,
      ERROR_CODES.MODULE_NOT_DEACTIVATABLE,
      declaration.nonDeactivatableReason ??
        `Module "${moduleId}" cannot be switched off.`,
    );
  }
  return declaration.settingCode;
}

/**
 * Flip one module's operator activation.
 *
 * The audit snapshot is the resolved activation on either side rather than the
 * raw jsonb: `global_value` is `null` both for "the operator never chose" and
 * for a literal JSON null, so recording it would leave two consecutive audit
 * rows unable to say what the module's activation actually was at either moment.
 */
export function makeSetActivationCommand(
  input: SetModuleActivationInput,
): Command<{ moduleId: string; active: boolean }> {
  const settingCode = assertActivationWritable(input.moduleId);

  return {
    action: 'module.activation.set',
    objectType: 'module',
    objectId: input.moduleId,
    capture: async () => ({
      moduleId: input.moduleId,
      settingCode,
      activated: effectiveState.presence(input.moduleId)?.operatorActivated ?? true,
    }),
    run: async ({ em }) => {
      const setting = await em.findOne(Setting, { code: settingCode });
      if (!setting) {
        // The reconciler creates the row from the module's settings manifest at
        // boot. Its absence means the module declared an activation code it
        // does not own — a manifest error, not an operator one.
        throw new HttpError(
          500,
          ERROR_CODES.SETTING_NOT_REGISTERED,
          `Module "${input.moduleId}" declares activation setting "${settingCode}", which is not registered.`,
        );
      }
      setting.globalValue = input.active;
      await em.flush();

      return {
        result: { moduleId: input.moduleId, active: input.active },
        after: {
          moduleId: input.moduleId,
          settingCode,
          activated: input.active,
        },
      };
    },
    event: (result) => ({
      eventName: 'module.activation.changed',
      payload: {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        moduleId: result.moduleId,
        active: result.active,
      },
    }),
  };
}

/** The two side effects that make a flip visible outside the writing process. */
export interface ActivationPropagation {
  /** Re-reads both axes locally, so the next request in *this* process is correct. */
  refreshLocalState: () => Promise<void>;
  /** Notifies every other API and worker process over `b2b:module:state-changed`. */
  publishStateChanged: (payload: { moduleId: string; newState: string }) => Promise<void>;
  /** Drops the storefront's `modules:presence` cache entry. */
  revalidateStorefront: (tags: string[]) => Promise<void>;
}

/**
 * Propagate a committed flip. Called **after** the Command's transaction, never
 * inside it: a Redis hiccup must not roll back a change the operator was told
 * had been saved, and a subscriber that acted on a notification for a
 * transaction that then aborted would be acting on a state that never existed.
 *
 * Each step is best-effort and independent. The local refresh is what makes the
 * flip take effect without a redeploy in the writing process; the publish does
 * the same everywhere else; the revalidation does it for the storefront. A
 * process that misses the notification recovers through the degraded-mode timer.
 */
export async function propagateActivationChange(
  propagation: ActivationPropagation,
  input: { moduleId: string; active: boolean },
): Promise<void> {
  await propagation.refreshLocalState().catch(() => undefined);
  await propagation
    .publishStateChanged({
      moduleId: input.moduleId,
      newState: input.active ? 'activated' : 'deactivated',
    })
    .catch(() => undefined);
  await propagation.revalidateStorefront(['modules:presence']).catch(() => undefined);
}
