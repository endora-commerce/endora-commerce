import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';

/**
 * Issue #1489 (UX audit 2026-11-17, CAT-07): a row's removal in the product editor is a quiet
 * destructive action — the kit's `ghost` icon button in the destructive tone, named after its row
 * ("Remove Cordless drill"), never a filled red button. Ten rows are not ten red buttons
 * (Signal-to-Noise), and the page's one Save stays the only filled action (Von Restorff). The
 * caller asks before deleting (`useConfirmRemoval` or a `ModalDialog`). The kit README's
 * § Button hierarchy (DS-07) states the rule.
 */
export function RowRemoveButton({
  label,
  onClick,
  disabled,
}: {
  /** The accessible name, naming the row; also the tooltip. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-destructive hover:text-destructive max-lg:h-11 max-lg:w-11"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}
