import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Text shown on the trigger when nothing is selected. */
  placeholder: string;
  /** aria-label for the trigger button. */
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  /** Optional leading icon for the trigger (e.g. a Columns glyph). */
  icon?: ReactNode;
}

/**
 * Dependency-free multi-select dropdown (no Radix popover), styled to match the
 * shadcn-style admin primitives. Renders a trigger button summarising the
 * selection and a checkbox panel; closes on outside pointer interactions.
 *
 * Reused by the orders list for the status / sales-channel / payment / delivery
 * filters and by the column picker.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  ariaLabel,
  className,
  disabled = false,
  icon,
}: MultiSelectProps): ReactNode {
  const reactId = useId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!containerRef.current || !target) return;
      if (containerRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return (): void => document.removeEventListener('pointerdown', handler);
  }, [open]);

  const selectedSet = new Set(selected);
  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? placeholder)
        : `${placeholder} (${selected.length})`;

  const toggle = (value: string): void => {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Preserve the option order rather than selection order.
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={ariaLabel ?? placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={(): void => setOpen((v) => !v)}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm',
          'disabled:cursor-not-allowed disabled:opacity-50',
          selected.length === 0 && 'text-muted-foreground',
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {icon}
          <span className="truncate">{summary}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-20 mt-1 max-h-72 w-max min-w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">—</p>
          ) : (
            options.map((opt) => {
              const checked = selectedSet.has(opt.value);
              return (
                <label
                  key={opt.value}
                  htmlFor={`${reactId}-${opt.value}`}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Checkbox
                    id={`${reactId}-${opt.value}`}
                    checked={checked}
                    onChange={(): void => toggle(opt.value)}
                  />
                  <span className="flex-1 truncate">{opt.label}</span>
                  {checked ? <Check className="size-3.5 opacity-70" /> : null}
                </label>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
