import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { TouchReorderButtons } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

export interface ReorderControlsProps {
  /** The row's name, for the controls' accessible names. */
  name: string;
  isFirst: boolean;
  isLast: boolean;
  /** A reorder is in flight: every control waits for it. */
  disabled: boolean;
  onMove: (delta: number) => void;
}

/**
 * Move one row of a configuration list up or down (issue #1560): the kit's
 * `TouchReorderButtons` on a touch screen and a pair of arrow buttons on a
 * pointer screen — the dictionaries' Languages and Countries tabs' pattern.
 *
 * While a reorder is in flight the arrow buttons are `aria-disabled` rather
 * than `disabled`: the row moves under the keyboard user's focus, and a
 * `disabled` button would drop that focus to the page.
 */
export function ReorderControls(props: ReorderControlsProps): ReactNode {
  const t = useTranslation('tasks');
  const { name, isFirst, isLast, disabled, onMove } = props;
  return (
    <>
      <TouchReorderButtons
        onMoveUp={(): void => onMove(-1)}
        onMoveDown={(): void => onMove(1)}
        disableUp={isFirst}
        disableDown={isLast}
        disabled={disabled}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="b2b-reorder-desktop-only min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
        disabled={isFirst}
        aria-disabled={disabled || undefined}
        aria-label={t('reorder.moveUp', { name })}
        onClick={(): void => {
          if (!disabled) onMove(-1);
        }}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="b2b-reorder-desktop-only min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
        disabled={isLast}
        aria-disabled={disabled || undefined}
        aria-label={t('reorder.moveDown', { name })}
        onClick={(): void => {
          if (!disabled) onMove(1);
        }}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
    </>
  );
}
