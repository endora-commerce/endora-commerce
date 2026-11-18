import { createContext, useContext, useRef, type MutableRefObject, type ReactNode } from 'react';
import { ChevronDown, MoreVertical } from 'lucide-react';
import { Button } from '../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';

/**
 * The overflow ("…") menu on a table row.
 *
 * Every admin list needs the same thing — a few secondary actions that would
 * crowd the row if they were buttons — and every hand-rolled version of it has
 * the same two bugs: it is clipped by the table's `overflow-x: auto`, and it
 * answers to the mouse but not the keyboard. Both are solved once here.
 *
 * The trigger is an icon button with a real accessible name (`label`): "⋮" on
 * its own tells a screen-reader user nothing, and a `title` alone is not a name
 * on every platform (WCAG 2.2 AA, 4.1.2).
 *
 * **An item that opens a dialog** (`specs/181-guest-complaints/` design review A-1). Radix
 * closes the menu in the same event that selects an item, and gives focus back to the trigger
 * only later — in a timer queued when the content unmounts, after its exit animation. An
 * item's action that mounts a dialog at once had the dialog take focus first and then lose
 * it to the trigger behind the scrim: Tab left the modal, Enter reopened the menu instead of
 * answering, and the destructive dialog's "open on *Cancel*" was defeated (WCAG 2.4.3,
 * 2.1.2). So an item's action is **deferred** to the menu's `onCloseAutoFocus`: focus is put
 * on the trigger there, and the action runs after it, so the dialog's focus trap finds the
 * trigger as its opener and returns focus to it on close. A plain close keeps Radix's own
 * trigger focus; an `asChild` navigation item has no action and is untouched.
 */

/** The action an item chose, run once the menu has let go of focus. */
const DeferredActionContext = createContext<MutableRefObject<(() => void) | null> | null>(null);

export interface RowActionMenuProps {
  /** Accessible name for the trigger — say what it opens, e.g. "Actions for Winter feed". */
  label: string;
  children: ReactNode;
  /** Disables the trigger outright; pair with `title` to say why. */
  disabled?: boolean;
  title?: string | undefined;
  /**
   * Shows `label` as the trigger's text, in an outline button with a chevron, instead of the
   * icon alone — for a menu outside a table row, where an icon-only ⋮ hides the only actions
   * of a page (Picture Superiority: icon plus label on a path that matters). The text is then
   * the accessible name.
   */
  showLabel?: boolean;
}

export function RowActionMenu({
  label,
  children,
  disabled = false,
  title,
  showLabel = false,
}: RowActionMenuProps): ReactNode {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deferred = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {showLabel ? (
          <Button
            ref={triggerRef}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            {...(title === undefined ? {} : { title })}
          >
            {label}
            <ChevronDown size={16} aria-hidden="true" />
          </Button>
        ) : (
          <Button
            ref={triggerRef}
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={label}
            disabled={disabled}
            {...(title === undefined ? {} : { title })}
          >
            <MoreVertical size={16} aria-hidden="true" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const run = deferred.current;
          if (!run) return;
          deferred.current = null;
          // Radix's own trigger focus is skipped; the action runs with the trigger focused.
          event.preventDefault();
          triggerRef.current?.focus();
          run();
        }}
      >
        <DeferredActionContext.Provider value={deferred}>{children}</DeferredActionContext.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface RowActionMenuItemProps {
  children: ReactNode;
  onSelect?: (() => void) | undefined;
  disabled?: boolean;
  title?: string | undefined;
  /** Irreversible actions (delete, revoke). Renders in the destructive colour. */
  destructive?: boolean;
  /**
   * Render as something other than a button — a `<Link>` or an `<a download>`.
   * Radix forwards its item behaviour onto the child, so navigation entries
   * keep working with middle-click and "open in new tab" instead of being
   * buttons that call `navigate()`.
   */
  asChild?: boolean;
}

export function RowActionMenuItem({
  children,
  onSelect,
  disabled = false,
  title,
  destructive = false,
  asChild = false,
}: RowActionMenuItemProps): ReactNode {
  const deferred = useContext(DeferredActionContext);
  const select = (): void => {
    if (!onSelect) return;
    // Inside a `RowActionMenu`: run after the menu has closed and focus is settled.
    if (deferred) deferred.current = onSelect;
    else onSelect();
  };
  return (
    <DropdownMenuItem
      asChild={asChild}
      destructive={destructive}
      disabled={disabled}
      {...(title === undefined ? {} : { title })}
      {...(onSelect === undefined ? {} : { onSelect: select })}
    >
      {children}
    </DropdownMenuItem>
  );
}

export function RowActionMenuSeparator(): ReactNode {
  return <DropdownMenuSeparator />;
}
