import { useCallback, useState, type ReactNode } from 'react';
import { Power, PowerOff } from 'lucide-react';
import type { ModulePresence } from '@b2b/contracts';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { setModuleActivation, useModulePresence } from '@/lib/module-presence';

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
      onError(
        err instanceof ApiError ? err.envelope.error.message : String(err),
      );
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
