import { useCallback, useState, type ReactNode } from 'react';
import { Power, PowerOff } from 'lucide-react';
import type { ModulePresence } from '@endora-commerce/contracts';
import { Button } from '../../components/ui/button.js';
import { ApiError } from '../../lib/api-client.js';
import { setModuleActivation, useModulePresence } from '../../lib/module-presence/index.js';

/**
 * A module's one activation control — Constitution XVII, relocated by D-36.
 *
 * It used to render on the Settings screen. That put the control that switches
 * modules on and off inside a module, so switching Settings off took the
 * control that would switch it back on with it. The three binding requirements
 * are unchanged — exactly one control per module, declared by the owning
 * module's manifest, reachable without CLI access — and only the surface moved.
 *
 * The write goes to `POST /admin/modules/:id/activation`, whose audited Command
 * is the only door: the ordinary settings write path refuses activation codes.
 * No optimistic update — the flip is re-read from the server's projection, so
 * what the operator sees is what the platform resolved rather than what this
 * component assumed.
 */

interface Props {
  moduleId: string;
  moduleName: string;
  presence: ModulePresence;
  t: (key: string, params?: Record<string, string | number>) => string;
  onError: (message: string) => void;
}

/**
 * The two dependency refusals (FR-008), by envelope code and by the field of
 * `details` that names the modules to act on.
 *
 * They are translated here rather than shown as the server's sentence because
 * the sentence is the only part that is copy: the module ids are data, and
 * carrying them separately means no bundle can drop or reorder them — the same
 * treatment the version-drift numbers get on this screen.
 *
 * Every other refusal keeps the server's message. `MODULE_NOT_DEACTIVATABLE`
 * carries the module's **own declared reason**, and replacing that with a
 * generic sentence would be the hard-coded exception list Constitution XVII
 * prohibits, spelled in the bundle instead of in the code.
 */
const DEPENDENCY_REFUSALS: Readonly<Record<string, { key: string; field: string }>> = {
  MODULE_DEPENDENTS_PRESENT: {
    key: 'platform.modules.error.dependentsPresent',
    field: 'blockedBy',
  },
  MODULE_DEPENDENCIES_ABSENT: {
    key: 'platform.modules.error.dependenciesAbsent',
    field: 'missing',
  },
};

export function activationErrorMessage(
  err: unknown,
  moduleName: string,
  t: Props['t'],
): string {
  if (!(err instanceof ApiError)) return String(err);
  const code = err.envelope.error.code;
  const details = err.envelope.error.details;

  if (code === 'PIM_CONNECTOR_ALREADY_ACTIVE' && details && !Array.isArray(details)) {
    const activeModuleId = (details as Record<string, unknown>)['activeModuleId'];
    if (typeof activeModuleId === 'string' && activeModuleId.length > 0) {
      return t('platform.modules.error.pimConnectorAlreadyActive', {
        name: moduleName,
        activeModuleId,
      });
    }
  }

  if (code === 'ERP_CONNECTOR_ALREADY_ACTIVE' && details && !Array.isArray(details)) {
    const activeModuleId = (details as Record<string, unknown>)['activeModuleId'];
    if (typeof activeModuleId === 'string' && activeModuleId.length > 0) {
      return t('platform.modules.error.erpConnectorAlreadyActive', {
        name: moduleName,
        activeModuleId,
      });
    }
  }

  const refusal = DEPENDENCY_REFUSALS[code];
  if (refusal && details && !Array.isArray(details)) {
    const named = (details as Record<string, unknown>)[refusal.field];
    if (Array.isArray(named) && named.length > 0) {
      return t(refusal.key, { name: moduleName, modules: named.join(', ') });
    }
  }
  return err.envelope.error.message;
}

export function ModuleActivationControl({
  moduleId,
  moduleName,
  presence,
  t,
  onError,
}: Props): ReactNode {
  const { refresh } = useModulePresence();
  const [pending, setPending] = useState(false);
  const activated = presence.activated;

  const toggle = useCallback(async (): Promise<void> => {
    if (
      activated &&
      !window.confirm(t('platform.modules.action.confirmDisable', { name: moduleName }))
    ) {
      return;
    }
    setPending(true);
    try {
      await setModuleActivation(moduleId, !activated);
      await refresh();
    } catch (err) {
      onError(activationErrorMessage(err, moduleName, t));
    } finally {
      setPending(false);
    }
  }, [activated, moduleId, moduleName, onError, refresh, t]);

  return (
    <Button
      type="button"
      variant={activated ? 'outline' : 'default'}
      size="sm"
      disabled={pending}
      onClick={() => void toggle()}
    >
      {activated ? (
        <PowerOff className="mr-1 size-3.5" />
      ) : (
        <Power className="mr-1 size-3.5" />
      )}
      {activated
        ? t('platform.modules.action.disable')
        : t('platform.modules.action.enable')}
    </Button>
  );
}
