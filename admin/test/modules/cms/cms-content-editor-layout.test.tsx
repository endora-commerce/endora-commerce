import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { withLocalStorage } from '../../helpers/with-local-storage';
import { withViewportWidth } from '../../helpers/with-viewport-width';
import {
  CMS_EDITOR_SETTINGS_STORAGE_KEY,
  CMS_EDITOR_TWO_COLUMN_MIN_WIDTH,
  CmsContentEditorLayout,
  useCmsEditorSettingsPanel,
  type CmsEditorSettingsPanel,
} from '../../../../packages/modules/cms/src/admin/components/CmsContentEditorLayout';

/**
 * The shell the CMS page, block and template editors share.
 *
 * The Page Builder is what an editor spends the session in, so it is the main
 * column; the metadata and scope cards are a secondary panel beside it that can
 * be put away. jsdom lays nothing out, so nothing here is about pixels: these
 * assert the things a layout is made of that markup can carry — which regions
 * exist and what they are called, the order the keyboard meets them in, what
 * lives inside the panel, and what the disclosure control says and does.
 */

const bundle = {
  cms: {
    'editorLayout.settings': 'Settings',
    'editorLayout.builder': 'Page Builder',
    'editorLayout.hideSettings': 'Hide settings',
    'editorLayout.showSettings': 'Show settings',
  },
};

let panel: CmsEditorSettingsPanel | null = null;

function Harness({ isNew = false }: { isNew?: boolean }): ReactElement {
  const settingsPanel = useCmsEditorSettingsPanel(isNew);
  panel = settingsPanel;
  return (
    <CmsContentEditorLayout
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
      languageTabs={<div data-testid="language-tabs">en-US</div>}
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

describe('CmsContentEditorLayout — regions', () => {
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

describe('CmsContentEditorLayout — putting the settings panel away', () => {
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
    expect(window.localStorage.getItem(CMS_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
    first.unmount();

    renderWithI18n(<Harness />, bundle);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle());
    expect(window.localStorage.getItem(CMS_EDITOR_SETTINGS_STORAGE_KEY)).toBe('1');
  });
});

describe('CmsContentEditorLayout — the panel opens itself when it is needed', () => {
  it('opens for a new entity whatever was remembered: name and scope come before the canvas', () => {
    window.localStorage.setItem(CMS_EDITOR_SETTINGS_STORAGE_KEY, '0');

    renderWithI18n(<Harness isNew />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Settings' })).toBeTruthy();
    // Opening for a new entity is the screen's decision, not the operator's.
    expect(window.localStorage.getItem(CMS_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });

  it('reopens when the same screen is reused for a new entity', () => {
    window.localStorage.setItem(CMS_EDITOR_SETTINGS_STORAGE_KEY, '0');
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
    expect(window.localStorage.getItem(CMS_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });
});

describe('CmsContentEditorLayout — the default follows the room there is', () => {
  it('starts collapsed where the panel would sit above the canvas, so the builder is on the first screen', () => {
    withViewportWidth(NARROW);
    renderWithI18n(<Harness />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('Show settings');
    expect(screen.queryByRole('complementary', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Canvas' })).toBeTruthy();
  });

  it('does not treat the old 1536px breakpoint as room enough', () => {
    expect(CMS_EDITOR_TWO_COLUMN_MIN_WIDTH).toBeGreaterThan(1536);
    withViewportWidth(1536);
    renderWithI18n(<Harness />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('starts open exactly at the two-column width', () => {
    withViewportWidth(CMS_EDITOR_TWO_COLUMN_MIN_WIDTH);
    renderWithI18n(<Harness />, bundle);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('lets a remembered choice win over the width, both ways', () => {
    withViewportWidth(NARROW);
    window.localStorage.setItem(CMS_EDITOR_SETTINGS_STORAGE_KEY, '1');
    const first = renderWithI18n(<Harness />, bundle);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    first.unmount();

    withViewportWidth(WIDE);
    window.localStorage.setItem(CMS_EDITOR_SETTINGS_STORAGE_KEY, '0');
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
    expect(window.localStorage.getItem(CMS_EDITOR_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('places the panel beside the builder only from the two-column width', () => {
    const { container } = renderWithI18n(<Harness />, bundle);
    const grid = container.querySelector('[data-settings-open="true"]');

    expect(grid?.className).toContain(`min-[${CMS_EDITOR_TWO_COLUMN_MIN_WIDTH}px]:grid-cols-`);
    expect(grid?.className).not.toContain('2xl:');
  });
});
