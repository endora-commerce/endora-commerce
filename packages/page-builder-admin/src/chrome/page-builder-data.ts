import type { Data } from '@measured/puck';

const EMPTY_DATA: Data = { root: { props: {} }, content: [] };

export function emptyPageBuilderData(): Data {
  return structuredClone(EMPTY_DATA);
}

/** True when the canvas has no top-level components. */
export function isEmptyPageBuilderData(data: Data | null | undefined): boolean {
  if (!data) return true;
  const content = data.content;
  return !Array.isArray(content) || content.length === 0;
}
