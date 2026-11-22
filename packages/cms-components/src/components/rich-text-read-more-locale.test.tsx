// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { PAGE_BUILDER_FIELD_TEXT, PageBuilderContentLocaleProvider } from '@endora-commerce/page-builder-core';
import { RichContentEditorField } from './RichContentEditorField.js';

// `page-builder-core` reaches Puck's drag-and-drop layer, which observes element sizes on import.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Issue #1684 — the toolbar's *Read more passage* button seeds the passage's
 * summary in the content locale being edited, which the host names through
 * `PageBuilderContentLocaleProvider`. The toolbar's own words stay in the
 * admin language (#1680); only the content it inserts follows the content.
 */

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function mount(node: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
  // The TipTap editor is created after the first render (`immediatelyRender: false`).
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
  return host;
}

function summaryOf(value: JSONContent | null): string | null {
  const find = (node: JSONContent | undefined): JSONContent | undefined => {
    if (!node) return undefined;
    if (node.type === 'readMoreSummary') return node;
    for (const child of node.content ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  const summary = find(value ?? undefined);
  return summary ? (summary.content ?? []).map((child) => child.text ?? '').join('') : null;
}

async function insertReadMore(locale: string | null): Promise<string | null> {
  let latest: JSONContent | null = null;
  const field = (
    <RichContentEditorField
      value={null}
      onChange={(next) => {
        latest = next;
      }}
    />
  );
  const host = await mount(
    locale === null ? field : <PageBuilderContentLocaleProvider locale={locale}>{field}</PageBuilderContentLocaleProvider>,
  );
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${PAGE_BUILDER_FIELD_TEXT['richText.readMore']}"]`);
  if (!button) throw new Error('no read-more button');
  await act(async () => {
    button.click();
  });
  return summaryOf(latest);
}

describe('the read-more passage is seeded in the edited content locale (#1684)', () => {
  it('a Polish content locale gets a Polish summary', async () => {
    expect(await insertReadMore('pl-PL')).toBe('Czytaj więcej');
  });

  it('an English content locale gets an English summary', async () => {
    expect(await insertReadMore('en-US')).toBe('Read more');
  });

  it('a host that names no content locale keeps the English summary', async () => {
    expect(await insertReadMore(null)).toBe('Read more');
  });
});
