import { type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';

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
 * a title, what the list is for, and the one action that fills it — drawn with
 * the kit's `b2b-empty` pattern rather than a parallel style.
 *
 * The action is the filled, primary button: while the list is empty it is the
 * only thing the screen is for, so the screen hides its outline *Add* in the
 * card header and this one stands alone (Von Restorff).
 */
export function SettingsEmptyState(props: SettingsEmptyStateProps): ReactNode {
  return (
    <div className="b2b-empty">
      <div className="b2b-empty__icon" aria-hidden="true">
        {props.icon}
      </div>
      <p className="b2b-empty__title">{props.title}</p>
      <p className="b2b-empty__sub">{props.body}</p>
      <Button type="button" className="mt-2 min-h-11 sm:min-h-9" onClick={props.onAction}>
        <Plus aria-hidden="true" />
        {props.actionLabel}
      </Button>
    </div>
  );
}
