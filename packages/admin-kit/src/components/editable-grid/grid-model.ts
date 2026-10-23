/**
 * The editable grid's pure half (feature 161, `specs/161-price-book-editor/research.md`
 * R4): positions, the selection rectangle, keyboard moves and the clipboard's
 * block format. No React and no DOM, so the rules are readable in one place.
 */

/** A data cell by its 0-based row and column on the rendered page. */
export interface GridPosition {
  readonly row: number;
  readonly col: number;
}

/** An inclusive rectangle of data cells. */
export interface GridRect {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

export function rectOf(a: GridPosition, b: GridPosition): GridRect {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function inRect(rect: GridRect, row: number, col: number): boolean {
  return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
}

export function clamp(position: GridPosition, rows: number, cols: number): GridPosition {
  return {
    row: Math.max(0, Math.min(position.row, rows - 1)),
    col: Math.max(0, Math.min(position.col, cols - 1)),
  };
}

export type GridMove =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'rowStart'
  | 'rowEnd'
  | 'gridStart'
  | 'gridEnd'
  | 'pageUp'
  | 'pageDown';

/** Where `move` takes `from`, stopping at the edges (WAI-ARIA data grid: no wrapping). */
export function moveFrom(from: GridPosition, move: GridMove, rows: number, cols: number, pageStep: number): GridPosition {
  const next = ((): GridPosition => {
    switch (move) {
      case 'up':
        return { row: from.row - 1, col: from.col };
      case 'down':
        return { row: from.row + 1, col: from.col };
      case 'left':
        return { row: from.row, col: from.col - 1 };
      case 'right':
        return { row: from.row, col: from.col + 1 };
      case 'rowStart':
        return { row: from.row, col: 0 };
      case 'rowEnd':
        return { row: from.row, col: cols - 1 };
      case 'gridStart':
        return { row: 0, col: 0 };
      case 'gridEnd':
        return { row: rows - 1, col: cols - 1 };
      case 'pageUp':
        return { row: from.row - pageStep, col: from.col };
      case 'pageDown':
        return { row: from.row + pageStep, col: from.col };
    }
  })();
  return clamp(next, rows, cols);
}

/**
 * A block of cells read from the clipboard: what a spreadsheet writes
 * (tab-separated, `\r\n` or `\n` between rows, a cell holding a tab, a line
 * break or a quote wrapped in quotes with `""` for a quote), or — when the
 * text holds no tab at all — a semicolon-separated line, as a CSV or a text
 * editor gives it. One trailing line break is dropped; empty cells are kept.
 */
export function parseClipboardBlock(text: string): string[][] {
  if (text === '') return [];
  const separator = text.includes('\t') || !text.includes(';') ? '\t' : ';';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atCellStart = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
      continue;
    }
    if (ch === separator) {
      row.push(cell);
      cell = '';
      atCellStart = true;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
      continue;
    }
    cell += ch;
    atCellStart = false;
  }
  if (!atCellStart || cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A block as a spreadsheet pastes it: tabs between cells, `\r\n` between rows, quoted where needed. */
export function serializeClipboardBlock(rows: readonly (readonly string[])[]): string {
  const quote = (cell: string): string => (/[\t\r\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return rows.map((row) => row.map(quote).join('\t')).join('\r\n');
}
