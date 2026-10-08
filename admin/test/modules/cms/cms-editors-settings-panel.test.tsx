import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { withLocalStorage } from '../../helpers/with-local-storage';
import { CMS_EDITOR_SETTINGS_STORAGE_KEY } from '../../../../packages/modules/cms/src/admin/components/CmsContentEditorLayout';
import { PageEditor } from '../../../../packages/modules/cms/src/admin/editors/PageEditor';
import { BlockEditor } from '../../../../packages/modules/cms/src/admin/editors/BlockEditor';
import { TemplateEditor } from '../../../../packages/modules/cms/src/admin/editors/TemplateEditor';

/**
 * The three CMS editors, each in the shared shell.
 *
 * `cms-content-editor-layout.test.tsx` holds the shell on its own. This file is
 * about the three screens that fill it: that each one really hands its metadata
 * card and the scope picker to the settings panel and its canvas to the builder
 * region, and that a save the operator cannot complete without the panel opens
 * the panel — a collapsed panel must never be where a validation error hides.
 *
 * The canvas is stubbed: Puck needs an iframe and a layout engine, and nothing
 * here is about what is inside it.
 */
vi.mock('../../../../packages/modules/cms/src/admin/components/PageBuilderEditor', () => ({
  PageBuilderEditor: (): ReactElement => <div data-testid="canvas-stub">canvas</div>,
}));

function bundleOf(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/cms/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const en = bundleOf('en');
const pl = bundleOf('pl');

/** The shipped English copy for `key` — a missing key fails here, by name. */
function copy(key: string): string {
  const value = en[key];
  if (!value) throw new Error(`cms/i18n/en.json carries no "${key}"`);
  return value;
}

const channel = {
  id: 'channel-1',
  code: 'web',
  name: { 'en-US': 'Web store' },
  active: true,
  defaultLanguage: 'en-US',
};

const stored = {
  id: 'entity-1',
  name: 'Stored entity',
  slug: 'stored-entity',
  code: 'stored-entity',
  status: 'draft',
  active: true,
  description: null,
  metaTitle: null,
  metaDescription: null,
  metaKeywords: null,
  salesChannelIds: ['channel-1'],
  languages: ['en-US'],
  version: 1,
  content: { languages: {} },
};

interface Screen {
  name: string;
  path: string;
  element: ReactElement;
  metadataTitle: string;
  missingChannel: string;
}

const screens: Screen[] = [
  {
    name: 'PageEditor',
    path: '/cms/pages',
    element: <PageEditor />,
    metadataTitle: copy('pageEditor.metadata'),
    missingChannel: copy('pageEditor.errors.selectChannel'),
  },
  {
    name: 'BlockEditor',
    path: '/cms/blocks',
    element: <BlockEditor />,
    metadataTitle: copy('blockEditor.metadata'),
    missingChannel: copy('blockEditor.errors.selectChannel'),
  },
  {
    name: 'TemplateEditor',
    path: '/cms/templates',
    element: <TemplateEditor />,
    metadataTitle: copy('templateEditor.metadata'),
    missingChannel: copy('templateEditor.errors.selectChannel'),
  },
];

function renderEditor(screenUnderTest: Screen, id: string): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[`${screenUnderTest.path}/${id}`]}>
      <Routes>
        <Route path={`${screenUnderTest.path}/:id`} element={screenUnderTest.element} />
      </Routes>
    </MemoryRouter>,
    { cms: en },
  );
}

beforeEach(() => {
  withLocalStorage();
  vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels?')) {
      return Promise.resolve({ items: [channel], page: 1, pageSize: 100, total: 1 } as never);
    }
    if (path.startsWith('/api/v1/admin/sales-channels/')) {
      return Promise.resolve({ ...channel, languages: ['en-US', 'pl-PL'] } as never);
    }
    if (/\/api\/v1\/admin\/cms\/(pages|blocks|templates)\/entity-1$/.test(path)) {
      return Promise.resolve({ data: stored } as never);
    }
    if (path === '/api/v1/admin/cms/pages/reserved-segments') {
      return Promise.resolve({ data: { segments: [] } } as never);
    }
    return Promise.reject(new Error(`unstubbed read: ${path}`));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(screens)('$name in the shared editor shell', (screenUnderTest) => {
  it('hands the metadata card and the scope picker to the settings panel, metadata first', async () => {
    renderEditor(screenUnderTest, 'new');

    const settings = screen.getByRole('complementary', { name: copy('editorLayout.settings') });
    const metadata = within(settings).getByText(screenUnderTest.metadataTitle);
    // The scope picker is the kit's; its channel row is what proves it mounted here.
    const scope = await within(settings).findByText(/Web store/);

    expect(
      Boolean(metadata.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it('hands the canvas to the builder region and nothing else to it', () => {
    renderEditor(screenUnderTest, 'new');

    const builder = screen.getByRole('region', { name: copy('editorLayout.builder') });
    expect(within(builder).getByTestId('canvas-stub')).toBeTruthy();
    expect(within(builder).queryByText(screenUnderTest.metadataTitle)).toBeNull();
  });

  it('keeps the save action outside both regions, so collapsing the panel cannot take it away', () => {
    renderEditor(screenUnderTest, 'new');

    const save = screen.getByRole('button', { name: copy('common.save') });
    expect(save.closest('aside')).toBeNull();
    expect(save.closest('section')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy('editorLayout.hideSettings') }));
    expect(screen.getByRole('button', { name: copy('common.save') })).toBeTruthy();
  });

  it('reopens a collapsed panel when a save is refused over a field that lives in it', async () => {
    renderEditor(screenUnderTest, 'new');

    fireEvent.click(screen.getByRole('button', { name: copy('editorLayout.hideSettings') }));
    expect(screen.queryByRole('complementary', { name: copy('editorLayout.settings') })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    expect((await screen.findByRole('alert')).textContent).toContain(screenUnderTest.missingChannel);
    expect(screen.getByRole('complementary', { name: copy('editorLayout.settings') })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: copy('editorLayout.hideSettings') })
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('reopens a collapsed panel when the server refuses the save', async () => {
    window.localStorage.setItem(CMS_EDITOR_SETTINGS_STORAGE_KEY, '0');
    vi.spyOn(apiClient, 'patch').mockRejectedValue(new Error('Code is already taken'));
    renderEditor(screenUnderTest, 'entity-1');

    // An existing entity honours the remembered choice.
    await screen.findByRole('heading', { level: 1, name: 'Stored entity' });
    expect(screen.queryByRole('complementary', { name: copy('editorLayout.settings') })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Code is already taken');
    });
    expect(screen.getByRole('complementary', { name: copy('editorLayout.settings') })).toBeTruthy();
    // Opened by the screen, not chosen by the operator: the preference stands.
    expect(window.localStorage.getItem(CMS_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });
});

describe('the shell copy ships in both languages', () => {
  it.each([
    'editorLayout.settings',
    'editorLayout.builder',
    'editorLayout.hideSettings',
    'editorLayout.showSettings',
  ])('%s', (key) => {
    expect(en[key]).toBeTruthy();
    expect(pl[key]).toBeTruthy();
  });

  it('is translated, not copied, where Polish has its own words', () => {
    expect(pl['editorLayout.settings']).not.toBe(copy('editorLayout.settings'));
    expect(pl['editorLayout.hideSettings']).not.toBe(copy('editorLayout.hideSettings'));
    expect(pl['editorLayout.showSettings']).not.toBe(copy('editorLayout.showSettings'));
  });
});
