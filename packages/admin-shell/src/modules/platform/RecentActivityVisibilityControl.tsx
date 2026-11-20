import { useCallback, useState, type ReactNode } from 'react';
import { Switch } from '@endora-commerce/admin-kit/ui';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { setRecentActivityVisibility } from './api.js';

/**
 * A module's dashboard-activity control — feature 080, T042j / D-163.1.
 *
 * **The second axis of a narrower object.** The module's `manifest.ts` declares
 * that its activity is *eligible* for the home dashboard's Recent Activity
 * card; this is where the operator decides whether it *appears*, and the
 * default is that it does. Neither axis overwrites the other, and neither is
 * derivable from the other — Constitution XVII's shape, applied to one card
 * instead of to a whole module.
 *
 * **Why it renders here and not on the module's own screen.** It is the
 * operator's per-module choice, and `/platform/modules` is the surface they
 * already use for exactly that; a card the operator did not configure appearing
 * on their home screen is the surprise the ruling exists to prevent, and a
 * switch they cannot find is the same surprise one click further away. The
 * screen belongs to no module (D-36), so hosting a second per-module control
 * costs it nothing.
 *
 * Only eligible modules get one: `listRecentActivityVisibility()` returns the
 * declaring set, and a module absent from it renders nothing. That is the
 * declaration axis showing through — this app holds no list of which modules
 * contribute activity, and could not: a packaged module is one of them.
 *
 * No optimistic update, for the reason the activation control has none: the
 * server's re-read is what the operator sees, not what this component assumed.
 */

interface Props {
  moduleId: string;
  moduleName: string;
  visible: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  onChanged: (moduleId: string, visible: boolean) => void;
  onError: (message: string) => void;
}

export function RecentActivityVisibilityControl({
  moduleId,
  moduleName,
  visible,
  t,
  onChanged,
  onError,
}: Props): ReactNode {
  const [pending, setPending] = useState(false);

  const toggle = useCallback(async (): Promise<void> => {
    setPending(true);
    try {
      const res = await setRecentActivityVisibility(moduleId, !visible);
      onChanged(res.module.moduleId, res.module.visible);
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : String(err));
    } finally {
      setPending(false);
    }
  }, [moduleId, onChanged, onError, visible]);

  // Issue #1520 (SHELL-12): a `Switch` in the *Dashboard* column. It used to be
  // a ghost button whose label was the state ("On the dashboard"), which read
  // as a status rather than as something to press (Similarity). The choice
  // takes effect at once, so it is a switch rather than a checkbox (DEC-04);
  // the column header carries the explanation, and the accessible name says
  // what the switch is about.
  return (
    <Switch
      checked={visible}
      busy={pending}
      onCheckedChange={() => void toggle()}
      aria-label={t('platform.modules.recentActivity.switchLabel', { name: moduleName })}
      data-testid={`recent-activity-visibility-${moduleId}`}
      data-visible={visible ? 'true' : 'false'}
    />
  );
}
