import { Children, useRef, type ReactNode } from 'react';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { Button } from '../ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { DeferredActionMenuContent } from './RowActionMenu.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { cn } from '../lib/utils.js';
import { InlineStatus, type InlineStatusProps } from '../ui/inline-status.js';

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
 * returns focus to the trigger on Escape. An entry that opens a dialog (a
 * `useConfirmDialog` question, a `ModalDialog`) runs only once the menu has
 * handed focus back to the trigger, as in `RowActionMenu`, so the dialog keeps
 * its focus and returns it to "More" when it closes (WCAG 2.4.3).
 *
 * **`status`** — the result of the last header action ("Approved", "Copied",
 * "Sent to 2 recipients"), said beside the buttons that caused it rather than
 * as a success banner stacked under the header (issue #1499, UX audit SALES-17;
 * owner decision DEC-12 a: Proximity, Von Restorff). Pass the
 * `useInlineStatus().props` of the screen: the kit's `InlineStatus` is then
 * mounted, empty, from the first render, so a message that arrives is
 * announced (WCAG 4.1.3). It sits first, so the primary stays last.
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
  /**
   * An entry of the menu is running: the trigger is disabled, marked
   * `aria-busy` and shows a spinner in place of its icon, so a second press
   * cannot start it again (Doherty). Its label stays.
   */
  moreBusy?: boolean;
  /**
   * The last header action's result — normally `useInlineStatus().props`. Given at all, a
   * polite live region is mounted before the buttons, empty while there is nothing to say,
   * and the group renders even when the record has no action left.
   */
  status?: Pick<InlineStatusProps, 'children' | 'tone' | 'revision'>;
  className?: string;
}

export function DetailHeaderActions({
  primary,
  secondary,
  children,
  moreLabel,
  moreDisabled = false,
  moreTitle,
  moreBusy = false,
  status,
  className,
}: DetailHeaderActionsProps): ReactNode {
  const t = useTranslation('core');
  const triggerRef = useRef<HTMLButtonElement>(null);
  // `toArray` drops `null`, `false` and `undefined`, so a menu whose entries are
  // all conditional and all off renders no trigger.
  const hasMenu = Children.toArray(children).length > 0;
  const hasPrimary = primary !== undefined && primary !== null && primary !== false;
  const hasSecondary = secondary !== undefined && secondary !== null && secondary !== false;
  if (!hasMenu && !hasPrimary && !hasSecondary && status === undefined) return null;

  return (
    <div data-slot="detail-header-actions" className={cn('flex flex-wrap items-center gap-2', className)}>
      {status !== undefined ? (
        <InlineStatus
          tone={status.tone ?? 'success'}
          {...(status.revision === undefined ? {} : { revision: status.revision })}
          className="max-w-sm"
        >
          {status.children}
        </InlineStatus>
      ) : null}
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              type="button"
              variant="outline"
              className="pointer-coarse:min-h-11"
              disabled={moreDisabled || moreBusy}
              {...(moreBusy ? { 'aria-busy': true } : {})}
              {...(moreTitle === undefined ? {} : { title: moreTitle })}
            >
              {moreBusy ? (
                <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
              ) : (
                <MoreHorizontal aria-hidden="true" />
              )}
              {moreLabel ?? t('common.action.more')}
            </Button>
          </DropdownMenuTrigger>
          <DeferredActionMenuContent triggerRef={triggerRef}>{children}</DeferredActionMenuContent>
        </DropdownMenu>
      ) : null}
      {hasSecondary ? secondary : null}
      {hasPrimary ? primary : null}
    </div>
  );
}
