import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { TouchReorderButtons } from '@endora-commerce/admin-kit/components';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * One reorder affordance per breakpoint (issue #1456): the kit's 44 px touch
 * pair below 1024 px, two icon buttons above it. CSS shows exactly one of the
 * two, so a screen reader and a keyboard meet one pair, never both; rows are no
 * longer HTML5-draggable, which no keyboard could operate.
 */
export function RowReorder({
  onMove,
  first,
  last,
}: {
  onMove: (direction: -1 | 1) => void;
  first: boolean;
  last: boolean;
}): ReactNode {
  // The kit's words, so both pairs carry one name (`TouchReorderButtons` reads the same keys).
  const t = useTranslation('core');
  return (
    <>
      <TouchReorderButtons
        onMoveUp={(): void => onMove(-1)}
        onMoveDown={(): void => onMove(1)}
        disableUp={first}
        disableDown={last}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="b2b-reorder-desktop-only"
        disabled={first}
        title={t('reorder.moveUp')}
        aria-label={t('reorder.moveUp')}
        onClick={(): void => onMove(-1)}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="b2b-reorder-desktop-only"
        disabled={last}
        title={t('reorder.moveDown')}
        aria-label={t('reorder.moveDown')}
        onClick={(): void => onMove(1)}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
    </>
  );
}
