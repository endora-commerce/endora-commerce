import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { withLocalStorage } from '../helpers/with-local-storage';
import { withViewportWidth } from '../helpers/with-viewport-width';
import {
  PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY,
  PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH,
  PageBuilderEditorLayout,
  usePageBuilderEditorSettingsPanel,
  type PageBuilderEditorSettingsPanel,
} from '../../../packages/page-builder-admin/src/chrome/PageBuilderEditorLayout';

/**
 * The shell every Page Builder editor shares — the CMS page, block and template
 * editors, the blog post and category editors, and the e-mail editors.
 *
 * The Page Builder is what an editor spends the session in, so it is the main
 * column; the metadata and scope cards are a secondary panel beside it that can
 * be put away. jsdom lays nothing out, so nothing here is about pixels: these
 * assert the things a layout is made of that markup can carry — which regions
 * exist and what they are called, the order the keyboard meets them in, what
 * lives inside the panel, and what the disclosure control says and does.
 */

const bundle = {
  core: {
    'pageBuilder.editorLayout.settings': 'Settings',
    'pageBuilder.editorLayout.builder': 'Page Builder',
    'pageBuilder.editorLayout.hideSettings': 'Hide settings',
    'pageBuilder.editorLayout.showSettings': 'Show settings',
  },
};

let panel: PageBuilderEditorSettingsPanel | null = null;

function Harness({ isNew = false }: { isNew?: boolean }): ReactElement {
  const settingsPanel = usePageBuilderEditorSettingsPanel(isNew);
  panel = settingsPanel;
  return (
    <PageBuilderEditorLayout
      settingsPanel={settingsPanel}
      header={<h1>Home page</h1>}
      settings={
        <>
          <label>
            Name
            <input data-testid="name-field" />
          </label>
          <div data-testid="scope-card">Scope</div>
        </>
      }
      canvasBar={<div data-testid="language-tabs">en-US</div>}
      builder={<button type="button">Canvas</button>}
    />
  );
}

function toggle(): HTMLElement {
  return screen.getByRole('button', { name: /settings/i });
}

/** `a` comes before `b` in document order — the order Tab meets them in. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Wide enough for the settings panel to be a column beside the builder. */
const WIDE = 1920;
/** A common laptop width, below the two-column breakpoint. */
const NARROW = 1440;

beforeEach(() => {
  withLocalStorage();
  withViewportWidth(WIDE);
  panel = null;
});

describe('PageBuilderEditorLayout — regions', () => {
  it('names the Page Builder and the settings panel as separate regions with headings', () => {
    renderWithI18n(<Harness />, bundle);

    const builder = screen.getByRole('region', { name: 'Page Builder' });
    const settings = screen.getByRole('complementary', { name: 'Settings' });

    expect(within(builder).getByRole('heading', { level: 2, name: 'Page Builder' })).toBeTruthy();
    expect(within(settings).getByRole('heading', { level: 2, name: 'Settings' })).toBeTruthy();
    expect(within(builder).getByRole('button', { name: 'Canvas' })).toBeTruthy();
  });

  it('keeps the metadata fields and the scope card inside the settings panel, not the builder', () => {
    renderWithI18n(<Harness />, bundle);

    const settings = screen.getByRole('complementary', { name: 'Settings' });
    const builder = screen.getByRole('region', { name: 'Page Builder' });

    expect(within(settings).getByTestId('name-field')).toBeTruthy();
    expect(within(settings).getByTestId('scope-card')).toBeTruthy();
    expect(within(builder).queryByTestId('name-field')).toBeNull();
    // Metadata first, scope below it — the order the cards are handed in.
    expect(precedes(screen.getByTestId('name-field'), screen.getByTestId('scope-card'))).toBe(true);
  });

  it('puts the language tabs with the builder they switch, outside the settings panel', () => {
    renderWithI18n(<Harness />, bundle);

    const settings = screen.getByRole('complementary', { name: 'Settings' });
    expect(within(settings).queryByTestId('language-tabs')).toBeNull();
    expect(
      precedes(screen.getByTestId('language-tabs'), screen.getByRole('button', { name: 'Canvas' })),
    ).toBe(true);
  });

  it('orders the page: header, the disclosure control, the panel it controls, then the builder', () => {
    renderWithI18n(<Harness />, bundle);

    const header = screen.getByRole('heading', { level: 1, name: 'Home page' });
    const settings = screen.getByRole('complementary', { name: 'Settings' });
    const builder = screen.getByRole('region', { name: 'Page Builder' });

    expect(precedes(header, toggle())).toBe(true);
    // A disclosure's content follows its control, and a dozen form fields come
    // before a canvas holding hundreds of tab stops rather than after it.
    expect(precedes(toggle(), settings)).toBe(true);
    expect(precedes(settings, builder)).toBe(true);
  });
});

describe('PageBuilderEditorLayout — putting the settings panel away', () => {
  it('starts open, and the control says so and points at the panel', () => {
    const { container } = renderWithI18n(<Harness />, bundle);

    const settings = screen.getByRole('complementary', { name: 'Settings' });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(settings.id);
    expect(settings.id).not.toBe('');
    expect(toggle().textContent).toContain('Hide settings');
    expect(toggle().getAttribute('type')).toBe('button');
    expect(container.querySelector('[data-settings-open="true"]')).not.toBeNull();
  });

  it('collapses on click: the panel leaves the accessibility tree, the builder stays', () => {
    const { container } = renderWithI18n(<Harness />, bundle);

    fireEvent.click(toggle());

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('Show settings');
    expect(screen.queryByRole('complementary', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Page Builder' })).toBeTruthy();
    expect(container.querySelector('[data-settings-open="false"]')).not.toBeNull();
  });

  it('keeps the fields mounted while collapsed, so what was typed is still there', () => {
    renderWithI18n(<Harness />, bundle);

    const field = screen.getByTestId('name-field') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'About us' } });
    fireEvent.click(toggle());

    const collapsed = screen.getByTestId('name-field') as HTMLInputElement;
    expect(collapsed).toBe(field);
    expect(collapsed.value).toBe('About us');
    expect(collapsed.closest('[hidden]')).not.toBeNull();

    fireEvent.click(toggle());
    expect((screen.getByTestId('name-field') as HTMLInputElement).value).toBe('About us');
    expect(screen.getByRole('complementary', { name: 'Settings' })).toBeTruthy();
  });

  it('is operable from the keyboard — a native button, not a clickable div', () => {
    renderWithI18n(<Harness />, bundle);
    expect(toggle().tagName).toBe('BUTTON');
    expect(toggle().hasAttribute('disabled')).toBe(false);
    expect(toggle().getAttribute('tabindex')).not.toBe('-1');
  });

  it('remembers the choice for the next editor that opens', () => {
    const first = renderWithI18n(<Harness />, bundle);
    fireEvent.click(toggle());
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
    first.unmount();

    renderWithI18n(<Harness />, bundle);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle());
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('1');
  });
});

describe('PageBuilderEditorLayout — the panel opens itself when it is needed', () => {
  it('opens for a new entity whatever was remembered: name and scope come before the canvas', () => {
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '0');

    renderWithI18n(<Harness isNew />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Settings' })).toBeTruthy();
    // Opening for a new entity is the screen's decision, not the operator's.
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });

  it('reopens when the same screen is reused for a new entity', () => {
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '0');
    const view = renderWithI18n(<Harness />, bundle);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    view.rerender(<Harness isNew />);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('reveal() opens a collapsed panel without overwriting the remembered choice', () => {
    renderWithI18n(<Harness />, bundle);
    fireEvent.click(toggle());
    expect(screen.queryByRole('complementary', { name: 'Settings' })).toBeNull();

    act(() => panel!.reveal());

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Settings' })).toBeTruthy();
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });
});

describe('PageBuilderEditorLayout — a refusal is shown with the panel it is about', () => {
  it('brings the top of the editor into view on reveal(): the message first, the fields under it', () => {
    // The refusal is announced in the header, above the panel. Scrolling the
    // panel alone into view — it can be two screens tall — pushes the message
    // that explains why it opened off the top.
    const scrolled: Array<{ element: Element; options: unknown }> = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown): void {
      scrolled.push({ element: this, options });
    };
    try {
      withViewportWidth(NARROW);
      renderWithI18n(<Harness />, bundle);

      act(() => panel?.reveal());

      expect(scrolled).toHaveLength(1);
      const target = scrolled[0]!.element;
      expect(target.contains(screen.getByRole('heading', { level: 1, name: 'Home page' }))).toBe(true);
      expect(target.contains(screen.getByRole('complementary', { name: 'Settings' }))).toBe(true);
      expect(scrolled[0]!.options).toEqual({ block: 'start' });
      // Clear of the sticky top bar, so the header is not scrolled under it.
      expect(target.className).toMatch(/scroll-mt-/);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not scroll when the operator toggles the panel themselves', () => {
    const calls: unknown[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options?: unknown): void {
      calls.push(options);
    };
    try {
      renderWithI18n(<Harness />, bundle);
      fireEvent.click(toggle());
      fireEvent.click(toggle());
      expect(calls).toHaveLength(0);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('PageBuilderEditorLayout — the default follows the room there is', () => {
  it('starts collapsed where the panel would sit above the canvas, so the builder is on the first screen', () => {
    withViewportWidth(NARROW);
    renderWithI18n(<Harness />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('Show settings');
    expect(screen.queryByRole('complementary', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Canvas' })).toBeTruthy();
  });

  it('does not treat the old 1536px breakpoint as room enough', () => {
    expect(PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH).toBeGreaterThan(1536);
    withViewportWidth(1536);
    renderWithI18n(<Harness />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('starts open exactly at the two-column width', () => {
    withViewportWidth(PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH);
    renderWithI18n(<Harness />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('lets a remembered choice win over the width, both ways', () => {
    withViewportWidth(NARROW);
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '1');
    const first = renderWithI18n(<Harness />, bundle);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    first.unmount();

    withViewportWidth(WIDE);
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '0');
    renderWithI18n(<Harness />, bundle);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('still opens for a new entity on a narrow screen: name and scope come before the canvas', () => {
    withViewportWidth(NARROW);
    renderWithI18n(<Harness isNew />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('still opens on reveal() on a narrow screen, without recording a choice', () => {
    withViewportWidth(NARROW);
    renderWithI18n(<Harness />, bundle);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    act(() => panel?.reveal());

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('places the panel beside the builder only from the two-column width', () => {
    const { container } = renderWithI18n(<Harness />, bundle);
    const grid = container.querySelector('[data-settings-open="true"]');

    expect(grid?.className).toContain(`min-[${PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH}px]:grid-cols-`);
    expect(grid?.className).not.toContain('2xl:');
  });
});

/**
 * Issue #1511 (UX audit CONTENT-01) — below the two-column width the settings
 * used to be a two-column wall of cards **above** the canvas, pushing the main
 * task a screen down (Serial Position). Now the canvas keeps its row at every
 * width and the open panel is a sheet laid over its inline end; and at every
 * width the groups sit in **one** panel rather than one card each (Common
 * Region). jsdom lays nothing out, so these read the markup a layout is made of.
 */
describe('PageBuilderEditorLayout — the settings are a sheet over the canvas, not a block above it', () => {
  it('never gives the open panel a row of its own above the canvas', () => {
    withViewportWidth(NARROW);
    const { container } = renderWithI18n(<Harness isNew />, bundle);
    const grid = container.querySelector('[data-settings-open="true"]')!;
    const settings = screen.getByRole('complementary', { name: 'Settings' });
    const builder = screen.getByRole('region', { name: 'Page Builder' });

    // No single-column stack, no balanced card columns ahead of the canvas.
    expect(grid.className).not.toMatch(/(^|\s)grid-cols-1(\s|$)/);
    expect(settings.innerHTML).not.toContain('columns-2');
    // The sheet and the canvas share the canvas's row; the sheet is laid over it.
    expect(builder.className).toMatch(/(^|\s)row-start-2(\s|$)/);
    expect(settings.className).toMatch(/max-\[1799px\]:row-start-2/);
    expect(settings.className).toMatch(/max-\[1799px\]:justify-self-end/);
    expect(settings.className).toMatch(/max-\[1799px\]:z-/);
    // …and becomes a column beside it again from the two-column width.
    expect(settings.className).toContain(`min-[${PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH}px]:col-start-3`);
  });

  it('keeps the canvas the same width whether the panel is open or not, below the two-column width', () => {
    withViewportWidth(NARROW);
    renderWithI18n(<Harness isNew />, bundle);
    const open = screen.getByRole('region', { name: 'Page Builder' }).className;
    fireEvent.click(toggle());
    const closed = screen.getByRole('region', { name: 'Page Builder' }).className;
    const narrowClasses = (classes: string): string[] =>
      classes.split(/\s+/).filter((c) => !c.startsWith('min-['));
    expect(narrowClasses(open)).toEqual(narrowClasses(closed));
  });

  it('renders the groups inside one titled panel, not one card per group', () => {
    renderWithI18n(<Harness />, bundle);
    const settings = screen.getByRole('complementary', { name: 'Settings' });
    const cards = settings.querySelectorAll('[data-slot="card"]');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.contains(screen.getByTestId('name-field'))).toBe(true);
    expect(cards[0]!.contains(screen.getByTestId('scope-card'))).toBe(true);
    // The panel's title is shown, not only announced: the sheet needs a name on screen.
    const heading = within(settings).getByRole('heading', { level: 2, name: 'Settings' });
    expect(heading.className).not.toContain('sr-only');
  });

  it('closes the sheet on Escape and hands focus back to the control that opened it', () => {
    withViewportWidth(NARROW);
    renderWithI18n(<Harness />, bundle);
    fireEvent.click(toggle());
    const field = screen.getByTestId('name-field');
    field.focus();

    fireEvent.keyDown(field, { key: 'Escape' });

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });

  it('leaves Escape to a control in the sheet that answered it first (a listbox, a combobox)', () => {
    withViewportWidth(NARROW);
    renderWithI18n(<Harness isNew />, bundle);
    const field = screen.getByTestId('name-field');
    field.addEventListener('keydown', (event) => event.preventDefault());

    fireEvent.keyDown(field, { key: 'Escape' });

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('does not close the column on Escape where it sits beside the canvas', () => {
    withViewportWidth(WIDE);
    renderWithI18n(<Harness />, bundle);
    fireEvent.keyDown(screen.getByTestId('name-field'), { key: 'Escape' });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });
});

describe('PageBuilderEditorLayout — one remembered choice for every Page Builder editor', () => {
  it('still reads the slot the CMS editors have written since they got the panel', () => {
    // Renaming the slot would silently reset every operator who already chose.
    expect(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY).toBe('b2b-admin.cms-editor.settings-panel');
  });
});

describe('PageBuilderEditorLayout — a screen may name its own canvas', () => {
  it('labels the builder region with what the screen composes there', () => {
    function Described(): ReactElement {
      const settingsPanel = usePageBuilderEditorSettingsPanel(false);
      return (
        <PageBuilderEditorLayout
          settingsPanel={settingsPanel}
          header={<h1>Guides</h1>}
          settings={<div>Scope</div>}
          builderLabel="Description"
          builder={<button type="button">Canvas</button>}
        />
      );
    }
    renderWithI18n(<Described />, bundle);

    const builder = screen.getByRole('region', { name: 'Description' });
    expect(within(builder).getByRole('heading', { level: 2, name: 'Description' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Page Builder' })).toBeNull();
  });
});

describe('PageBuilderEditorLayout — a screen with nothing to put away', () => {
  function CanvasOnly(): ReactElement {
    return (
      <PageBuilderEditorLayout
        header={<h1>Order confirmation</h1>}
        canvasBar={
          <label>
            Subject
            <input data-testid="subject-field" />
          </label>
        }
        builder={<button type="button">Canvas</button>}
      />
    );
  }

  it('renders the builder region and the canvas bar without a settings panel or its control', () => {
    renderWithI18n(<CanvasOnly />, bundle);

    expect(screen.getByRole('region', { name: 'Page Builder' })).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    expect(
      precedes(screen.getByTestId('subject-field'), screen.getByRole('button', { name: 'Canvas' })),
    ).toBe(true);
    // The canvas bar is not part of the canvas: it is what the canvas is edited under.
    expect(
      within(screen.getByRole('region', { name: 'Page Builder' })).queryByTestId('subject-field'),
    ).toBeNull();
  });
});

describe('PageBuilderEditorLayout — an entity that has no canvas yet', () => {
  function NoCanvas(): ReactElement {
    const settingsPanel = usePageBuilderEditorSettingsPanel(true);
    return (
      <PageBuilderEditorLayout
        settingsPanel={settingsPanel}
        header={<h1>New blog post</h1>}
        canvasBar={<div data-testid="language-tabs">en-US</div>}
        settings={
          <label>
            Name
            <input data-testid="name-field" />
          </label>
        }
        builder={null}
      />
    );
  }

  it('makes the settings the page: a named region, always showing, with no control to hide it', () => {
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '0');
    withViewportWidth(NARROW);
    renderWithI18n(<NoCanvas />, bundle);

    const settings = screen.getByRole('region', { name: 'Settings' });
    expect(within(settings).getByTestId('name-field')).toBeTruthy();
    expect(screen.getByTestId('name-field').closest('[hidden]')).toBeNull();
    // Nothing to give the room to, so nothing to collapse.
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Page Builder' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('keeps the language tabs, which the per-language fields still follow', () => {
    renderWithI18n(<NoCanvas />, bundle);
    expect(precedes(screen.getByTestId('language-tabs'), screen.getByTestId('name-field'))).toBe(true);
  });

  it('does not take the full editor width: a form is not a canvas', () => {
    const { container } = renderWithI18n(<NoCanvas />, bundle);
    expect(container.querySelector('.b2b-page--wide')).toBeNull();
    expect(container.querySelector('.b2b-page')).not.toBeNull();
  });
});

/**
 * Issue #1446 (DS-13) / #1461 (CONTENT-02) — `dirty` arms the kit's unsaved-changes
 * guard over the whole editor: a link out of it asks Save / Discard / Stay.
 */
describe('PageBuilderEditorLayout — unsaved changes', () => {
  const guardBundle = {
    core: {
      ...bundle.core,
      'form.unsavedChanges.title': 'Unsaved changes',
      'form.unsavedChanges.body': 'Save or discard?',
      'form.unsavedChanges.save': 'Save and continue',
      'form.unsavedChanges.saving': 'Saving…',
      'form.unsavedChanges.discard': 'Discard changes',
      'form.unsavedChanges.stay': 'Stay here',
    },
  };

  function DirtyHarness({ dirty, onDiscard }: { dirty: boolean; onDiscard?: () => void }): ReactElement {
    return (
      <>
        <a href="/cms/pages">Back to pages</a>
        <PageBuilderEditorLayout
          header={<h1>Home page</h1>}
          builder={<button type="button">Canvas</button>}
          dirty={dirty}
          onSave={async () => true}
          onDiscard={onDiscard}
        />
      </>
    );
  }

  it('asks before a link leaves a dirty editor', () => {
    renderWithI18n(<DirtyHarness dirty />, guardBundle);
    fireEvent.click(screen.getByRole('link', { name: 'Back to pages' }));
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
    expect(within(dialog).getByRole('button', { name: 'Save and continue' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Discard changes' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay here' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks nothing while the editor is clean', () => {
    renderWithI18n(<DirtyHarness dirty={false} />, guardBundle);
    let preventedByGuard: boolean | null = null;
    const probe = (e: MouseEvent): void => {
      preventedByGuard = e.defaultPrevented;
      e.preventDefault(); // jsdom does not navigate; keep it from trying
    };
    document.addEventListener('click', probe);
    fireEvent.click(screen.getByRole('link', { name: 'Back to pages' }));
    document.removeEventListener('click', probe);
    expect(preventedByGuard).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
