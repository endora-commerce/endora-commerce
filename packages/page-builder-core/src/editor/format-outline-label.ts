import { EDITOR_NAME_FIELD_KEY } from '../types/editor-chrome.js';

export function formatOutlineLabel(
  componentType: string,
  props: Record<string, unknown> | undefined,
  typeLabel?: string,
): string {
  const base = typeLabel ?? componentType;
  const name = props?.[EDITOR_NAME_FIELD_KEY];
  if (typeof name === 'string' && name.trim().length > 0) {
    return `${base} - ${name.trim()}`;
  }
  return base;
}
