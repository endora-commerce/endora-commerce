/** Insert `snippet` into `value` at `start`…`end` (selection). Returns next value + caret. */
export function insertAtCursor(
  value: string,
  snippet: string,
  start: number,
  end: number = start,
): { value: string; selectionStart: number; selectionEnd: number } {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const next = value.slice(0, safeStart) + snippet + value.slice(safeEnd);
  const caret = safeStart + snippet.length;
  return { value: next, selectionStart: caret, selectionEnd: caret };
}

export function varSnippet(key: string): string {
  return `{{var ${key}}}`;
}
