export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Display value for the text input — empty string means transparent. */
export function colorFieldDisplayValue(value: string | undefined): string {
  if (value === undefined || value === '' || value === 'transparent') return '';
  return value;
}

/** Committed Puck value — undefined means transparent. */
export function colorFieldCommitValue(next: string): string | undefined {
  if (!next || next === 'transparent') return undefined;
  if (HEX_COLOR.test(next)) return next;
  return undefined;
}

/** @deprecated Use colorFieldDisplayValue — kept for internal comparisons. */
export function normalizeColorFieldValue(value: string | undefined): string {
  return colorFieldDisplayValue(value);
}

export function isTransparentColor(value: string): boolean {
  return value === 'transparent' || value === '';
}

/** Native color input only accepts #RRGGBB — use a neutral preview when transparent. */
export function colorPickerDisplayHex(value: string): string {
  if (isTransparentColor(value)) return '#ffffff';
  if (HEX_COLOR.test(value)) return value;
  return '#ffffff';
}

export function parseColorTextInput(raw: string): { display: string; commit?: string | undefined } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'transparent') {
    return { display: '', commit: undefined };
  }
  const next = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (HEX_COLOR.test(next)) {
    return { display: next, commit: next };
  }
  return { display: raw };
}

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}
