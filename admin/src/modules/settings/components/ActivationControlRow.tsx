import { useCallback, useState, type ReactNode } from 'react';
import { Power, PowerOff, Lock } from 'lucide-react';
import type { SettingDto } from '@b2b/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { setModuleActivation, useModulePresence } from '@/lib/module-presence';

/**
 * A module's activation control — feature 073 / US1, Constitution XVII.
 *
 * It renders in the Settings surface, as the Constitution requires, but it is
 * **not** an ordinary setting row and deliberately does not reuse
 * `SettingRowEditor`:
 *
 *  - its write goes to `POST /admin/modules/:id/activation`, not to the
 *    settings batch save. The ordinary path refuses an activation code, so a
 *    shared editor would produce a row that looks saveable and always fails;
 *  - it is the **single exception** to "a switched-off module's configuration is
 *    not editable". Every other row of an absent module goes read-only; this one
 *    must not, or an operator who switched a module off could never switch it
 *    back on;
 *  - a non-deactivatable module renders it locked with the module's **own**
 *    declared reason. There is no hard-coded list of such modules anywhere in
 *    this app — the reason arrives on the presence projection, from the
 *    module's manifest.
 */

interface Props {
  setting: SettingDto;
  /** Surfaced to the page so a failure lands in the same banner as a save. */
  onError: (message: string) => void;
}

export function ActivationControlRow({ setting, onError }: Props): ReactNode {
  const t = useTranslation('settings');
  const { presenceOf, refresh } = useModulePresence();
  const [pending, setPending] = useState(false);

  const presence = presenceOf(setting.ownerModule);
  // Until the projection lands, the stored value is the best available answer.
  const activated = presence?.activated ?? setting.globalValue !== false;
  const locked = presence !== undefined && !presence.deactivatable;
  const lockedReason = presence?.nonDeactivatableReason ?? t('activation.locked');
  // A module the deployment does not offer at all cannot be switched on here:
  // that axis is the deployment operator's, and it is changed through the CLI.
  const platformUnavailable = presence !== undefined && presence.platformState !== 'installed';

  const toggle = useCallback(async (): Promise<void> => {
    if (activated && !window.confirm(t('activation.confirmDisable', { name: setting.name }))) {
      return;
    }
    setPending(true);
    try {
      await setModuleActivation(setting.ownerModule, !activated);
      await refresh();
    } catch (err) {
      onError(
        t('activation.failed', {
          message: err instanceof ApiError ? err.envelope.error.message : String(err),
        }),
      );
    } finally {
      setPending(false);
    }
  }, [activated, onError, refresh, setting.name, setting.ownerModule, t]);

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border-2 px-4 py-3',
        activated ? 'border-emerald-200 bg-emerald-50/30' : 'border-muted bg-muted/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{setting.name}</span>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {t('activation.title')}
            </Badge>
            <Badge
              variant={activated ? 'secondary' : 'outline'}
              className="text-[10px]"
            >
              {activated ? t('activation.on') : t('activation.off')}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {setting.description ?? t('activation.hint')}
          </p>
          {locked && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {lockedReason}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant={activated ? 'outline' : 'default'}
          size="sm"
          className="shrink-0"
          disabled={pending || locked || platformUnavailable}
          onClick={() => void toggle()}
        >
          {activated ? (
            <PowerOff className="mr-1 h-3.5 w-3.5" />
          ) : (
            <Power className="mr-1 h-3.5 w-3.5" />
          )}
          {activated ? t('activation.disable') : t('activation.enable')}
        </Button>
      </div>
    </div>
  );
}
