import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ORDER_STATUS_COLOR_PRESETS, readableTextColor } from './orderStatusColor';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Compact colour picker: a swatch trigger that opens a small popover with the
 * curated preset palette plus a native colour input + hex field for any custom
 * colour. Dependency-free (no popover lib) — closes on outside click / Escape,
 * mirroring the Combobox pattern.
 */
export function StatusColorPicker(props: {
  value: string;
  onChange: (hex: string) => void;
  /** Accessible label for the trigger + custom input. */
  label: string;
  customLabel: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(props.value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commit = (hex: string): void => {
    props.onChange(hex);
  };

  const onHexInput = (raw: string): void => {
    const next = raw.startsWith('#') ? raw : `#${raw}`;
    setDraft(next);
    if (HEX.test(next)) commit(next);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={props.label}
        aria-expanded={open}
        onClick={(): void => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-md border bg-card px-2 text-sm"
      >
        <span
          className="size-5 rounded-full border border-black/10"
          style={{ backgroundColor: props.value }}
        />
        <span className="font-mono text-xs uppercase">{props.value}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-56 rounded-md border bg-card p-3 shadow-md">
          <div className="grid grid-cols-6 gap-2">
            {ORDER_STATUS_COLOR_PRESETS.map((c) => {
              const selected = props.value.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={selected}
                  title={c}
                  onClick={(): void => {
                    commit(c);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border border-black/10 ring-ring ring-offset-1 ring-offset-card transition',
                    selected && 'ring-2',
                  )}
                  style={{ backgroundColor: c }}
                >
                  {selected ? (
                    <span className="text-xs" style={{ color: readableTextColor(c) }}>
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t pt-3">
            <input
              type="color"
              aria-label={props.customLabel}
              value={HEX.test(draft) ? draft : props.value}
              onChange={(e): void => {
                setDraft(e.target.value);
                commit(e.target.value);
              }}
              className="h-8 w-9 cursor-pointer rounded border bg-transparent p-0.5"
            />
            <input
              type="text"
              value={draft}
              onChange={(e): void => onHexInput(e.target.value)}
              placeholder="#1d4ed8"
              className="h-8 w-full rounded-md border px-2 font-mono text-xs uppercase"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
