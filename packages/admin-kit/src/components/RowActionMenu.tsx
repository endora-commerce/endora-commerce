import { type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
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
 */

export interface RowActionMenuProps {
  /** Accessible name for the trigger — say what it opens, e.g. "Actions for Winter feed". */
  label: string;
  children: ReactNode;
  /** Disables the trigger outright; pair with `title` to say why. */
  disabled?: boolean;
  title?: string | undefined;
}

export function RowActionMenu({
  label,
  children,
  disabled = false,
  title,
}: RowActionMenuProps): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
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
  return (
    <DropdownMenuItem
      asChild={asChild}
      destructive={destructive}
      disabled={disabled}
      {...(title === undefined ? {} : { title })}
      {...(onSelect === undefined ? {} : { onSelect: () => onSelect() })}
    >
      {children}
    </DropdownMenuItem>
  );
}

export function RowActionMenuSeparator(): ReactNode {
  return <DropdownMenuSeparator />;
}
