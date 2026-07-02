import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SaveButtonGroupProps {
  /** Primary action — persist and stay on the editor. */
  onSave: () => void | Promise<void>;
  /** Secondary action — persist and navigate back to the list view. */
  onSaveAndExit: () => void | Promise<void>;
  /** True while a save is in flight; disables both buttons and shows `savingLabel`. */
  saving?: boolean;
  /** Extra disable condition independent of `saving`. */
  disabled?: boolean;
  saveLabel: string;
  savingLabel: string;
  saveAndExitLabel: string;
  /** Button size; matches surrounding header buttons. Defaults to `default`. */
  size?: 'default' | 'sm';
  className?: string;
}

/**
 * Split "Save" button used across the Page Builder editors (CMS block /
 * page / template, invoice template, …). The primary button saves and
 * stays put; the attached chevron reveals a "Save and exit" item that
 * saves and then routes back to the list. Dependency-free popover (mirrors
 * the in-house Combobox pattern) so it composes anywhere the shadcn-style
 * components do.
 */
export function SaveButtonGroup(props: SaveButtonGroupProps): ReactNode {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const busy = props.saving ?? false;
  const disabled = props.disabled ?? false;
  const size = props.size ?? 'default';

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative inline-flex', props.className)}>
      <Button
        type="button"
        size={size}
        className="rounded-r-none"
        onClick={() => void props.onSave()}
        disabled={busy || disabled}
      >
        {busy ? props.savingLabel : props.saveLabel}
      </Button>
      <Button
        type="button"
        size={size}
        aria-label={props.saveAndExitLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn('rounded-l-none border-l border-primary-foreground/25 px-0', size === 'sm' ? 'w-8' : 'w-9')}
        onClick={() => setOpen((o) => !o)}
        disabled={busy || disabled}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-md border border-input bg-background p-1 text-sm shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setOpen(false);
              void props.onSaveAndExit();
            }}
          >
            {props.saveAndExitLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
