import type { Data } from '@puckeditor/core';
import { isDraftEqual } from '@endora-commerce/admin-kit/lib';

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

/**
 * Issue #1461 (CONTENT-02) — whether a Page Builder editor's canvases hold
 * anything the last saved version does not: the active language's draft, and
 * every other language's draft stashed when the operator switched language
 * tab. A language with nothing saved compares against the empty canvas, so a
 * new entity whose canvas was never touched is not dirty.
 */
export function hasUnsavedCanvas(input: {
  draft: Data | null;
  activeLanguage: string | null;
  overrides: Readonly<Record<string, Data>>;
  saved: (language: string | null) => Data | null;
}): boolean {
  const differs = (data: Data, language: string | null): boolean =>
    !isDraftEqual(data, input.saved(language) ?? EMPTY_DATA);
  if (input.draft && differs(input.draft, input.activeLanguage)) return true;
  return Object.entries(input.overrides).some(([language, data]) => differs(data, language));
}
