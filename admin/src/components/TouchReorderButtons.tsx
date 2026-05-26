import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface TouchReorderButtonsProps {
  onMoveUp: () => void;
  onMoveDown: () => void;
  disableUp?: boolean;
  disableDown?: boolean;
  disabled?: boolean;
}

/**
 * Touch-friendly alternative to HTML5 drag-and-drop (feature 029).
 */
export function TouchReorderButtons(props: TouchReorderButtonsProps): ReactNode {
  const { onMoveUp, onMoveDown, disableUp, disableDown, disabled } = props;
  const t = useTranslation('core');

  return (
    <div className="b2b-touch-reorder" role="group" aria-label={t('reorder.groupLabel')}>
      <button
        type="button"
        className="b2b-touch-reorder__btn"
        onClick={onMoveUp}
        disabled={disabled || disableUp}
        aria-label={t('reorder.moveUp')}
      >
        <ChevronUp size={18} />
      </button>
      <button
        type="button"
        className="b2b-touch-reorder__btn"
        onClick={onMoveDown}
        disabled={disabled || disableDown}
        aria-label={t('reorder.moveDown')}
      >
        <ChevronDown size={18} />
      </button>
    </div>
  );
}
