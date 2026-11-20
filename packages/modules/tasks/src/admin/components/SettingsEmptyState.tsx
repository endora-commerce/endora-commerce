import { type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button, EmptyState } from '@endora-commerce/admin-kit/ui';

export interface SettingsEmptyStateProps {
  /** The decorative icon naming the kind of thing the list holds. */
  icon: ReactNode;
  title: string;
  /** What the thing is for — one sentence, ending with the invitation to add one. */
  body: string;
  /** The add action's label, the same words as the list's own Add button. */
  actionLabel: string;
  onAction: () => void;
}

/**
 * The empty state of a Task settings list (issue #527, ux-laws §6): an icon,
 * a title, what the list is for, and the one action that fills it — the kit's
 * `EmptyState` (issue #1448) with the Add button the settings lists share.
 *
 * The action is the filled, primary button: while the list is empty it is the
 * only thing the screen is for, so the screen hides the *Add* in its page
 * header and this one stands alone (Von Restorff, issue #1562).
 */
export function SettingsEmptyState(props: SettingsEmptyStateProps): ReactNode {
  return (
    <EmptyState
      icon={props.icon}
      title={props.title}
      description={props.body}
      action={
        <Button type="button" className="min-h-11 sm:min-h-9" onClick={props.onAction}>
          <Plus aria-hidden="true" />
          {props.actionLabel}
        </Button>
      }
    />
  );
}
