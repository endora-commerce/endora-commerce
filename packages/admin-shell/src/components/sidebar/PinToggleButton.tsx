import type { ReactNode } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

export interface PinToggleButtonProps {
  /** The sidebar entry's own label, in the admin's language. */
  label: string;
  pinned: boolean;
  onToggle: () => void;
  /** Always shown and ≥ 44 × 44 px — the mobile drawer, where there is no hover. */
  touch?: boolean;
  className?: string;
}

/**
 * Feature 164 — the pin / unpin control of one sidebar row (FR-004).
 *
 * A real button **after** the row's link, never inside it, so activating it
 * cannot navigate; it is the Tab stop directly after its link (owner ruling,
 * research § *Readings* item 1) and activating it leaves focus where it is. It is
 * revealed on the row's hover and focus, and always shown with a 44 px target
 * on touch (`.b2b-nav-pin--touch`, and `(pointer: coarse)` in the theme).
 */
export function PinToggleButton({
  label,
  pinned,
  onToggle,
  touch = false,
  className,
}: PinToggleButtonProps): ReactNode {
  const t = useTranslation('core');
  const name = t(pinned ? 'appShell.pinned.unpin' : 'appShell.pinned.pin', { label });
  return (
    <button
      type="button"
      className={cn('b2b-nav-pin', touch && 'b2b-nav-pin--touch', className)}
      aria-pressed={pinned}
      aria-label={name}
      title={name}
      onClick={onToggle}
    >
      {pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
    </button>
  );
}
