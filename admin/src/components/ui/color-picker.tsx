import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A small, neutral default palette used when no `presets` are supplied. */
export const DEFAULT_COLOR_PRESETS = [
  '#1d4ed8', '#2563eb', '#0ea5e9', '#0d9488', '#16a34a', '#65a30d',
  '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#475569',
  '#111827', '#6b7280', '#fafafa', '#ffffff',
] as const;

/** Black or white text for a given background hex, chosen by perceived luminance. */
function readableTextColor(hex: string): string {
  const value = HEX.test(hex) ? hex.slice(1) : 'ffffff';
  const int = Number.parseInt(value, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1f2937' : '#ffffff';
}

/**
 * Core colour picker — a swatch trigger that opens a small popover with a
 * curated preset palette plus a native colour input + hex field for any custom
 * colour. Dependency-free (no popover lib): closes on outside click / Escape,
 * mirroring the Combobox pattern. Fully controlled.
 *
 * Reused across the admin (order-status colours, PWA theme/background colours).
 */
export function ColorPicker(props: {
  value: string;
  onChange: (hex: string) => void;
  /** Accessible label for the trigger. */
  label: string;
  /** Accessible label for the custom colour input. */
  customLabel: string;
  /** Preset swatches; falls back to {@link DEFAULT_COLOR_PRESETS}. Pass `[]` to hide. */
  presets?: readonly string[];
  disabled?: boolean;
}): ReactNode {
  const presets = props.presets ?? DEFAULT_COLOR_PRESETS;
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
        disabled={props.disabled}
        onClick={(): void => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-md border bg-card px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
          {presets.length > 0 ? (
            <div className="grid grid-cols-6 gap-2">
              {presets.map((c) => {
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
          ) : null}
          <div className={cn('flex items-center gap-2', presets.length > 0 && 'mt-3 border-t pt-3')}>
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
