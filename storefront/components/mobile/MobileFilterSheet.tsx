'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { BottomSheet } from './BottomSheet';

/**
 * Feature 044 / US2 — mobile filter entry (Industria Mobile design §03).
 *
 * Renders the toolbar "Filtry (n)" trigger and a {@link BottomSheet} that
 * holds the existing {@link FilterPanel} facet markup (passed as `children`,
 * server-rendered, with its own submit button hidden). The footer applies the
 * filters by submitting that same `<form>` — so the GET round-trip and facet
 * semantics are reused verbatim, no client filter store.
 *
 * Shown only on phones; the trigger is `md:hidden`.
 */
export function MobileFilterSheet(props: {
  /** Current matching-result count, surfaced on the apply button. */
  resultCount: number;
  /** Number of currently-applied filter values (badge on the trigger). */
  activeFilterCount: number;
  /** Href that clears all filters (keeps sort/limit). */
  clearHref: string;
  labels: {
    filters: string;
    clear: string;
    /** Apply label with `{count}` placeholder, e.g. "Pokaż {count} wyników". */
    applyTemplate: string;
    close: string;
  };
  /** Existing FilterPanel facet markup. */
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const apply = (): void => {
    const form = bodyRef.current?.querySelector('form');
    if (form) {
      form.requestSubmit();
      return;
    }
    setOpen(false);
  };

  const applyLabel = props.labels.applyTemplate.replace(
    '{count}',
    props.resultCount.toLocaleString('pl-PL'),
  );

  return (
    <div className="md:hidden">
      <button
        type="button"
        className="inline-flex h-[40px] items-center gap-2 rounded-md border border-line bg-surface px-[12px] text-[13px] font-medium text-fg-soft"
        onClick={() => setOpen(true)}
      >
        <FilterIcon />
        {props.labels.filters}
        {props.activeFilterCount > 0 ? (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-[5px] font-mono text-[10px] font-semibold text-white">
            {props.activeFilterCount}
          </span>
        ) : null}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={props.labels.filters}
        closeLabel={props.labels.close}
        footer={
          <div className="flex w-full gap-2">
            <Link
              href={props.clearHref}
              className="btn btn--outline"
              style={{ flex: '0 0 38%' }}
              onClick={() => setOpen(false)}
            >
              {props.labels.clear}
            </Link>
            <button
              type="button"
              className="btn btn--dark justify-center"
              style={{ flex: 1 }}
              onClick={apply}
            >
              {applyLabel}
            </button>
          </div>
        }
      >
        <div ref={bodyRef}>{props.children}</div>
      </BottomSheet>
    </div>
  );
}

function FilterIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
