import type { PriceBookCellCode, PriceSource } from '@endora-commerce/contracts';

/**
 * The twelve buyer cells and the four price sources in words (feature 161,
 * T046; `research.md` R8). One map, shared by the explanation screen, the
 * precedence view and the cell detail, so a cell is named the same way
 * wherever an operator meets it. The keys are this module's own bundle's.
 */

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** `org.product` → `cells.org.product`. */
export function cellLabelKey(code: PriceBookCellCode): string {
  return `cells.${code}`;
}

/** `catalogue` → `sources.catalogue`. */
export function sourceLabelKey(source: PriceSource): string {
  return `sources.${source}`;
}

export function cellLabel(t: Translate, code: PriceBookCellCode): string {
  return t(cellLabelKey(code));
}

export function sourceLabel(t: Translate, source: PriceSource): string {
  return t(sourceLabelKey(source));
}
