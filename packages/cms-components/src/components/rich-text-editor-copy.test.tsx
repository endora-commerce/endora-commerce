// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_BUILDER_FIELD_TEXT, PageBuilderFieldTextProvider, type PageBuilderFieldTextKey } from '@endora-commerce/page-builder-core';
import { AnchorDialog, ImageDialog, LinkDialog, RichContentEditorField } from './RichContentEditorField.js';
import { InlineRichTextEditor } from './InlineRichTextEditor.js';
import { EditorLoading } from '../fields/editor-loading.js';

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
 * Issue #1680 (UX audit, follow-up to #1652) — every word of the rich-text
 * editors' toolbars and dialogs is the host's field text, as
 * `richText.fullscreen` has been since #1676, so the admin shows it in the
 * operator's language.
 *
 * Every key is answered as `«key»`; a template keeps its placeholders, so what
 * fills it shows. Anything with two letters in a row that is not inside `«…»`
 * is copy the host cannot translate — except the tokens below, which are not
 * words in any language.
 */
const translated = (key: PageBuilderFieldTextKey): string =>
  [`«${key}»`, ...(PAGE_BUILDER_FIELD_TEXT[key].match(/\{\w+\}/g) ?? [])].join(' ');

/** Units, example values and formats: the same in every language. */
const TOKENS = new Set(['px', 'em', 'https://…', '-0.125', '#1d4ed8']);

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
    root!.render(<PageBuilderFieldTextProvider resolve={translated}>{node}</PageBuilderFieldTextProvider>);
  });
  // The TipTap editor is created after the first render (`immediatelyRender: false`).
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
  return host;
}

/** Every visible or announced string under `scope`, the edited text and the icon names excepted. */
function strings(scope: ParentNode): string[] {
  const out: string[] = [];
  const skip = (node: Node): boolean => {
    const element = node instanceof Element ? node : node.parentElement;
    // The document being edited is the page's content, and an icon's name is the catalog's.
    return element?.closest('[contenteditable], [role="option"]') != null;
  };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!skip(node)) out.push((node.textContent ?? '').trim());
  }
  for (const element of scope.querySelectorAll('*')) {
    if (skip(element)) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = element.getAttribute(attribute);
      if (value !== null) out.push(value.trim());
    }
  }
  return out;
}

/** The strings no key produced. */
function untranslated(scope: ParentNode): string[] {
  return strings(scope).filter((value) => /\p{L}{2}/u.test(value) && !value.includes('«') && !TOKENS.has(value));
}

function button(scope: ParentNode, key: PageBuilderFieldTextKey): HTMLButtonElement {
  const found = scope.querySelector<HTMLButtonElement>(`button[aria-label="${translated(key)}"]`);
  if (!found) throw new Error(`no button «${key}»`);
  return found;
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.click();
  });
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]:last-of-type');
  if (!found) throw new Error('no dialog');
  return found;
}

describe('the rich-text editors\' copy is the host\'s (#1680)', () => {
  it('the rich-text toolbar', async () => {
    const host = await mount(<RichContentEditorField value={null} onChange={() => undefined} />);
    expect(host.querySelector('select')).not.toBeNull();
    expect(untranslated(host)).toEqual([]);
  });

  it('the rich-text editor shown read-only, with no content', async () => {
    const host = await mount(<RichContentEditorField value={null} onChange={() => undefined} readOnly />);
    expect(host.textContent).toContain('«richText.empty»');
    expect(untranslated(host)).toEqual([]);
  });

  it('the link dialog, with its button styles, from the rich-text toolbar', async () => {
    const host = await mount(<RichContentEditorField value={null} onChange={() => undefined} />);
    await press(button(host, 'richText.link'));
    const open = dialog();
    expect(open.querySelectorAll('option').length).toBeGreaterThan(1);
    expect(untranslated(open)).toEqual([]);
  });

  it('the link dialog, applying and removing', async () => {
    const host = await mount(
      <>
        <LinkDialog initialUrl="https://example.com" initialBlank={false} onApply={() => undefined} onCancel={() => undefined} />
        <LinkDialog initialUrl="" initialBlank={false} onApply={() => undefined} onCancel={() => undefined} />
      </>,
    );
    expect(host.ownerDocument.body.textContent).toContain('«richLink.apply»');
    expect(host.ownerDocument.body.textContent).toContain('«richLink.remove»');
    expect(untranslated(host.ownerDocument.body)).toEqual([]);
  });

  it('the heading anchor dialog, with and without an anchor', async () => {
    const host = await mount(
      <>
        <AnchorDialog initialAnchor="pricing" onApply={() => undefined} onCancel={() => undefined} />
        <AnchorDialog initialAnchor="" onApply={() => undefined} onCancel={() => undefined} />
      </>,
    );
    const body = host.ownerDocument.body;
    expect(body.textContent).toContain('«richAnchor.hint» pricing');
    expect(body.textContent).toContain('«richAnchor.none»');
    expect(body.textContent).toContain('«richAnchor.remove»');
    expect(untranslated(body)).toEqual([]);
  });

  it('the image dialog, inserting and editing', async () => {
    const host = await mount(
      <>
        <ImageDialog onApply={() => undefined} onCancel={() => undefined} />
        <ImageDialog initial={{ src: 'https://cdn.example.com/a.png', alt: '' }} onApply={() => undefined} onCancel={() => undefined} />
      </>,
    );
    const body = host.ownerDocument.body;
    expect(body.textContent).toContain('«richImage.insert»');
    expect(body.textContent).toContain('«richImage.edit»');
    expect(untranslated(body)).toEqual([]);
  });

  it('the inline toolbar', async () => {
    const host = await mount(<InlineRichTextEditor value="Hello" onChange={() => undefined} label="Title" />);
    // The toolbar is named by the field's label, which is the caller's.
    expect(untranslated(host).filter((value) => value !== 'Title')).toEqual([]);
  });

  it.each(['richText.link', 'inlineIcon.insert', 'emphasisColor.button'] as const)('the inline toolbar\'s %s dialog', async (key) => {
    const host = await mount(<InlineRichTextEditor value="Hello" onChange={() => undefined} label="Title" />);
    await press(button(host.querySelector('[role="toolbar"]')!, key));
    expect(untranslated(dialog())).toEqual([]);
  });

  it('a rich-text field while its editor loads', async () => {
    const host = await mount(<EditorLoading />);
    expect(host.textContent).toBe('«richText.loading»');
  });
});
