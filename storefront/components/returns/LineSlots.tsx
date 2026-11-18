'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The product lines of a complaint without an order, as a list the customer adds to and
 * removes from (`specs/180-off-platform-complaints/` FR-B12). Each slot's fields are rendered
 * on the server and handed in as `slots`; a slot keeps its field names (`lines.N.…`) whatever
 * its position, and the route handler skips the slots that post nothing.
 *
 * **Without JavaScript** the slots after the first wait in nested `<details>`, one "add"
 * control at a time, and a line is "removed" by leaving it empty. **With JavaScript** only
 * the open slots are mounted — a removed line posts nothing — and each line, once there are
 * two, has a heading and a "Remove" button. Focus follows the change: to the new line's first
 * field after adding, to the add button after removing.
 */
export function LineSlots({
  slots,
  initialCount,
  addLabel,
  removeLabel,
  headings,
  removeNames,
}: {
  slots: readonly ReactNode[];
  /** The slots open on render: the refused attempt's filled lines, at least one. */
  initialCount: number;
  addLabel: string;
  removeLabel: string;
  /** "Product 1", "Product 2", … by position. */
  headings: readonly string[];
  /** "Remove product 1", … by position — the remove button's accessible name. */
  removeNames: readonly string[];
}): ReactNode {
  const [enhanced, setEnhanced] = useState(false);
  const [open, setOpen] = useState<number[]>(() =>
    Array.from({ length: Math.min(slots.length, Math.max(1, initialCount)) }, (_, i) => i),
  );
  const [focus, setFocus] = useState<{ to: 'slot'; slot: number } | { to: 'add' } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setEnhanced(true), []);

  useEffect(() => {
    if (!focus) return;
    if (focus.to === 'add') addRef.current?.focus();
    else listRef.current?.querySelector<HTMLElement>(`[data-slot="${focus.slot}"] input:not([type=hidden])`)?.focus();
    setFocus(null);
  }, [focus]);

  if (!enhanced) return <>{nested(slots, 0, initialCount, addLabel, headings)}</>;

  const free = Array.from({ length: slots.length }, (_, i) => i).find((i) => !open.includes(i));
  return (
    <div ref={listRef} className="b2b-stacked__lines">
      {open.map((slot, position) => (
        <div key={slot} data-slot={slot} className="b2b-stacked__line">
          {open.length > 1 ? (
            <div className="b2b-stacked__line-head">
              <h3>{headings[position]}</h3>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label={removeNames[position]}
                onClick={() => {
                  setOpen((current) => current.filter((s) => s !== slot));
                  setFocus({ to: 'add' });
                }}
              >
                {removeLabel}
              </button>
            </div>
          ) : null}
          {slots[slot]}
        </div>
      ))}
      {free !== undefined ? (
        <button
          ref={addRef}
          type="button"
          className="b2b-stacked__add"
          onClick={() => {
            setOpen((current) => [...current, free]);
            setFocus({ to: 'slot', slot: free });
          }}
        >
          + {addLabel}
        </button>
      ) : null}
    </div>
  );
}

/** The no-JS chain: slot `i` and, inside it, the control for the next one. */
function nested(slots: readonly ReactNode[], i: number, openCount: number, addLabel: string, headings: readonly string[]): ReactNode {
  if (i === 0) {
    return (
      <>
        {slots[0]}
        {nested(slots, 1, openCount, addLabel, headings)}
      </>
    );
  }
  if (i >= slots.length) return null;
  return (
    <details className="b2b-stacked__more" {...(i < openCount ? { open: true } : {})}>
      <summary className="b2b-stacked__add">
        <span className="b2b-stacked__when-closed">+ {addLabel}</span>
        <span className="b2b-stacked__when-open">{headings[i]}</span>
      </summary>
      {slots[i]}
      {nested(slots, i + 1, openCount, addLabel, headings)}
    </details>
  );
}
