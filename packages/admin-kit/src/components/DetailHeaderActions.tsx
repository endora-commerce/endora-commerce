import { Children, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '../ui/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { cn } from '../lib/utils.js';

/**
 * The actions of a record's detail header — issue #1441 (UX audit 2026-11-17,
 * DS-07): **one primary action per view**.
 *
 * Detail headers had drifted to four or five outline buttons and no primary
 * (order, RFQ), or several filled ones competing with each other. This lays out
 * the hierarchy once:
 *
 * - **`primary`** — the one filled (`variant="default"`) action the screen is
 *   for, drawn **last** in reading order, at the right edge where a header's
 *   main action is expected (Von Restorff, Jakob, Fitts). Leave it out when
 *   the record has no obvious next step; never pass two.
 * - **`secondary`** — at most one or two frequent actions as `outline`
 *   buttons, before the primary.
 * - **`children`** — everything else, as `RowActionMenuItem` /
 *   `RowActionMenuSeparator` entries of a "More" menu drawn first, so the
 *   long tail costs one press instead of a decision at every glance (Hick).
 *   Destructive entries go here with `destructive`, away from the primary
 *   (Fitts: distance, not proximity), and their `onSelect` opens a
 *   `useConfirmDialog` question before anything irreversible happens.
 *
 * The "More" trigger carries a visible label as well as its icon, so its
 * accessible name is the word on screen (WCAG 2.5.3), and it is not rendered
 * when the menu would be empty. The panel is the kit's `DropdownMenu`, which
 * portals out of the header (no clipping), traps focus, supports typeahead and
 * returns focus to the trigger on Escape.
 */
export interface DetailHeaderActionsProps {
  /** The one primary action — a `Button` with the default variant, or a `SaveButtonGroup`. */
  primary?: ReactNode;
  /** One or two visible secondary actions, `variant="outline"`. */
  secondary?: ReactNode;
  /** The "More" menu's entries: `RowActionMenuItem` and `RowActionMenuSeparator`. */
  children?: ReactNode;
  /** The menu trigger's visible label. Defaults to the `core` bundle's "More". */
  moreLabel?: string;
  /** Disables the menu trigger; pair with `moreTitle` to say why. */
  moreDisabled?: boolean;
  moreTitle?: string;
  className?: string;
}

export function DetailHeaderActions({
  primary,
  secondary,
  children,
  moreLabel,
  moreDisabled = false,
  moreTitle,
  className,
}: DetailHeaderActionsProps): ReactNode {
  const t = useTranslation('core');
  // `toArray` drops `null`, `false` and `undefined`, so a menu whose entries are
  // all conditional and all off renders no trigger.
  const hasMenu = Children.toArray(children).length > 0;
  const hasPrimary = primary !== undefined && primary !== null && primary !== false;
  const hasSecondary = secondary !== undefined && secondary !== null && secondary !== false;
  if (!hasMenu && !hasPrimary && !hasSecondary) return null;

  return (
    <div data-slot="detail-header-actions" className={cn('flex flex-wrap items-center gap-2', className)}>
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="pointer-coarse:min-h-11"
              disabled={moreDisabled}
              {...(moreTitle === undefined ? {} : { title: moreTitle })}
            >
              <MoreHorizontal aria-hidden="true" />
              {moreLabel ?? t('common.action.more')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">{children}</DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {hasSecondary ? secondary : null}
      {hasPrimary ? primary : null}
    </div>
  );
}
