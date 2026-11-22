import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentConfig, Data } from '@puckeditor/core';
import type { CmsPageBuilderDescriptor } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  editorDescriptor,
  fieldsPanel,
  mountPageBuilderEditor,
  selectOutlineItem,
  shippedBundles,
  stubEditorApi,
} from './page-builder-editor-harness';
import { buildPageBuilderEditorConfig } from '../../../../packages/modules/cms/src/admin/components/PageBuilderEditor';

/**
 * Issue #1684 (UX audit, follow-up to #1680) — the rich-text toolbar's *Read
 * more passage* seeds its summary in the **content language being edited**:
 * the CMS editor hands the language its host passes (`activeLanguage`, the
 * `ContentLanguageTabs` choice) to the page builder, so a Polish page gets
 * "Czytaj więcej" whatever the operator's admin language is, and an English
 * page "Read more" in a Polish admin.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
});

// ProseMirror scrolls the caret into view after `focus()`, measuring a `Range`,
// which jsdom does not lay out; answer an empty rectangle rather than throwing.
function stubRangeRects(): void {
  const empty = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  const proto = Range.prototype as unknown as Record<string, unknown>;
  proto['getClientRects'] ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  proto['getBoundingClientRect'] ??= () => empty;
}
stubRangeRects();

function page(): Data {
  return {
    root: { props: {} },
    content: [
      {
        type: 'cms.RichContent',
        props: { id: 'pb1684-rich', content: { type: 'doc', content: [{ type: 'paragraph' }] }, html: '' },
      },
    ],
  } as unknown as Data;
}

/** The text of the first read-more summary in the editor's latest document. */
function summaryIn(data: Data | null): string | null {
  const json = JSON.stringify(data ?? {});
  const match = /"type":"readMoreSummary","content":\[\{"type":"text","text":"([^"]*)"/.exec(json);
  return match?.[1] ?? null;
}

async function insertReadMore(language: 'en' | 'pl', activeLanguage: string): Promise<string | null> {
  stubEditorApi(apiClient as never);
  const editor = await mountPageBuilderEditor(page(), { language, activeLanguage });
  await selectOutlineItem(0);
  // The toolbar's own name stays in the admin language (#1680).
  const name = shippedBundles(language).core!['pageBuilder.fieldText.richText.readMore']!;
  const button = await waitFor(
    () => {
      const found = fieldsPanel()?.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
      if (!found) throw new Error(`no "${name}" button`);
      return found;
    },
    { timeout: 10_000 },
  );
  await act(async () => {
    fireEvent.click(button);
  });
  await waitFor(() => expect(summaryIn(editor.latest())).not.toBeNull());
  return summaryIn(editor.latest());
}

describe('the read-more summary follows the edited content language (#1684)', () => {
  it('a Polish page edited in an English admin gets a Polish summary', async () => {
    expect(await insertReadMore('en', 'pl-PL')).toBe('Czytaj więcej');
  }, 30_000);

  it('an English page edited in a Polish admin gets an English summary', async () => {
    expect(await insertReadMore('pl', 'en-US')).toBe('Read more');
  }, 30_000);
});

describe('a block dropped from the drawer starts with its copy in the edited content language (#1684)', () => {
  const EN = shippedBundles('en') as unknown as Record<string, Record<string, string>>;
  const readMoreLabel = (contentLocale: string | null): unknown => {
    const config = buildPageBuilderEditorConfig({
      descriptor: editorDescriptor() as unknown as CmsPageBuilderDescriptor,
      context: 'cms',
      t: (key) => EN['cms']?.[key] ?? key,
      translateInScope: (scope, key) => EN[scope]?.[key] ?? `${scope}.${key}`,
      contentLocale,
    });
    return ((config.components['blog.LatestPosts'] as ComponentConfig).defaultProps as Record<string, unknown>)['readMoreLabel'];
  };

  it('blog.LatestPosts\' read-more label', () => {
    expect(readMoreLabel('pl-PL')).toBe('Czytaj więcej');
    expect(readMoreLabel('en-US')).toBe('Read more');
    expect(readMoreLabel(null)).toBe('Read more');
  });
});
