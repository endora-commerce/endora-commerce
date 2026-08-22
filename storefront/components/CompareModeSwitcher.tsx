'use client';

import type { ReactNode } from 'react';
import type { ComparisonDisplayMode } from '@endora-commerce/contracts';

/**
 * Three-button mode switcher for the comparison page (feature 007 / T031).
 *
 * Stateless: parent owns the active value and the callback. Mode change
 * is instantaneous from the customer's perspective — the parent already
 * holds the full attribute projection (every row, with its rowClass) so
 * a re-render filters the visible rows without any additional fetch.
 * (Spec NFR-002, SC-002.)
 */

const MODE_LABELS: Record<ComparisonDisplayMode, string> = {
  all: 'All attributes',
  common: 'Common attributes only',
  differences: 'Differences only',
};

const MODES: ComparisonDisplayMode[] = ['all', 'common', 'differences'];

export function CompareModeSwitcher(props: {
  value: ComparisonDisplayMode;
  onChange: (next: ComparisonDisplayMode) => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-line"
      role="radiogroup"
      aria-label="Display mode"
    >
      {MODES.map((mode) => {
        const active = mode === props.value;
        return (
          <button
            key={mode}
            type="button"
            className={`cursor-pointer px-[12px] py-[6px] text-[12px] disabled:opacity-50 ${
              active ? 'bg-accent text-white' : 'bg-surface text-fg-soft hover:bg-surface-alt'
            }`}
            role="radio"
            aria-checked={active}
            disabled={props.disabled}
            onClick={(): void => {
              if (!active) props.onChange(mode);
            }}
          >
            {MODE_LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}
