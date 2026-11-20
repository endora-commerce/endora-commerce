import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { orphanLabels } from '../../helpers/orphan-labels';
import { withLocalStorage } from '../../helpers/with-local-storage';
import { withViewportWidth } from '../../helpers/with-viewport-width';
import { PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY } from '../../../../packages/page-builder-admin/src/chrome/PageBuilderEditorLayout';
import { PageEditor } from '../../../../packages/modules/cms/src/admin/editors/PageEditor';
import { BlockEditor } from '../../../../packages/modules/cms/src/admin/editors/BlockEditor';
import { TemplateEditor } from '../../../../packages/modules/cms/src/admin/editors/TemplateEditor';

/**
 * The three CMS editors, each in the shared shell.
 *
 * `page-builder-admin/page-builder-editor-layout.test.tsx` holds the shell on
 * its own — it is `@endora-commerce/page-builder-admin`'s now, shared with the
 * blog and e-mail editors, and its copy is `core`'s. This file is
 * about the three screens that fill it: that each one really hands its metadata
 * card and the scope picker to the settings panel and its canvas to the builder
 * region, and that a save the operator cannot complete without the panel opens
 * the panel — a collapsed panel must never be where a validation error hides.
 *
 * The canvas is stubbed: Puck needs an iframe and a layout engine, and nothing
 * here is about what is inside it.
 */
vi.mock('../../../../packages/modules/cms/src/admin/components/PageBuilderEditor', () => ({
  // Issue #1461 — the stub can emit a canvas change: an edit, or a reseed equal to what is stored.
  PageBuilderEditor: ({ onChange }: { onChange?: (data: unknown) => void }): ReactElement => (
    <div data-testid="canvas-stub">
      canvas
      <button type="button" onClick={() => onChange?.({ root: { props: {} }, content: [{ type: 'Hero', props: { id: 'h1' } }] })}>
        edit-canvas
      </button>
      <button type="button" onClick={() => onChange?.({ root: { props: {} }, content: [] })}>
        reseed-canvas
      </button>
    </div>
  ),
}));

function bundleOf(pkg: string, language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/${pkg}/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const en = bundleOf('cms', 'en');
const pl = bundleOf('cms', 'pl');
/** The shell reads the synthetic `core` scope, which `_i18n`'s bundle is served under. */
const coreEn = bundleOf('_i18n', 'en');

/** The shipped `core` copy of the unsaved-changes guard (issue #1461). */
function ux(key: string): string {
  const value = coreEn[`form.unsavedChanges.${key}`];
  if (!value) throw new Error(`_i18n/i18n/en.json carries no "form.unsavedChanges.${key}"`);
  return value;
}
const corePl = bundleOf('_i18n', 'pl');

/** The shipped English copy of the shared shell. */
function shell(key: string): string {
  const value = coreEn[`pageBuilder.editorLayout.${key}`];
  if (!value) throw new Error(`_i18n/i18n/en.json carries no "pageBuilder.editorLayout.${key}"`);
  return value;
}

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
  /** The metadata card's text fields, by the label each must be named by (#1465). */
  labelledFields: string[];
}

const screens: Screen[] = [
  {
    name: 'PageEditor',
    path: '/cms/pages',
    element: <PageEditor />,
    metadataTitle: copy('pageEditor.metadata'),
    missingChannel: copy('pageEditor.errors.selectChannel'),
    labelledFields: [copy('fields.name'), copy('fields.slug'), copy('fields.description')],
  },
  {
    name: 'BlockEditor',
    path: '/cms/blocks',
    element: <BlockEditor />,
    metadataTitle: copy('blockEditor.metadata'),
    missingChannel: copy('blockEditor.errors.selectChannel'),
    labelledFields: [copy('fields.name'), copy('fields.code'), copy('fields.description')],
  },
  {
    name: 'TemplateEditor',
    path: '/cms/templates',
    element: <TemplateEditor />,
    metadataTitle: copy('templateEditor.metadata'),
    missingChannel: copy('templateEditor.errors.selectChannel'),
    labelledFields: [copy('fields.name'), copy('fields.code'), copy('fields.description')],
  },
];

function renderEditor(screenUnderTest: Screen, id: string): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[`${screenUnderTest.path}/${id}`]}>
      <Routes>
        <Route path={`${screenUnderTest.path}/:id`} element={screenUnderTest.element} />
      </Routes>
    </MemoryRouter>,
    { cms: en, core: coreEn },
  );
}

beforeEach(() => {
  withLocalStorage();
  // Wide enough for the panel to start open; the width default has its own tests.
  withViewportWidth(1920);
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
  it('names each metadata field by the label above it (#1465)', () => {
    renderEditor(screenUnderTest, 'new');
    const settings = screen.getByRole('complementary', { name: shell('settings') });
    for (const label of screenUnderTest.labelledFields) {
      expect(within(settings).getByRole('textbox', { name: label })).toBeInTheDocument();
    }
    // The metadata card: its title sits in the card's header (CardTitle → CardHeader → Card).
    const metadataCard = within(settings).getByText(screenUnderTest.metadataTitle).parentElement!.parentElement!;
    expect(within(metadataCard).getByRole('textbox', { name: screenUnderTest.labelledFields[0]! })).toBeInTheDocument();
    expect(orphanLabels(metadataCard)).toEqual([]);
    if (screenUnderTest.name === 'PageEditor') {
      expect(within(settings).getByRole('combobox', { name: copy('fields.status') })).toBeDisabled();
      // The public address under the slug describes it.
      expect(within(settings).getByRole('textbox', { name: copy('fields.slug') })).toHaveAccessibleDescription(
        new RegExp(copy('pageEditor.publicAddress')),
      );
    }
  });

  it('hands the metadata card and the scope picker to the settings panel, metadata first', async () => {
    renderEditor(screenUnderTest, 'new');

    const settings = screen.getByRole('complementary', { name: shell('settings') });
    const metadata = within(settings).getByText(screenUnderTest.metadataTitle);
    // The scope picker is the kit's; its channel row is what proves it mounted here.
    const scope = await within(settings).findByText(/Web store/);

    expect(
      Boolean(metadata.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it('hands the canvas to the builder region and nothing else to it', () => {
    renderEditor(screenUnderTest, 'new');

    const builder = screen.getByRole('region', { name: shell('builder') });
    expect(within(builder).getByTestId('canvas-stub')).toBeTruthy();
    expect(within(builder).queryByText(screenUnderTest.metadataTitle)).toBeNull();
  });

  it('keeps the save action outside both regions, so collapsing the panel cannot take it away', () => {
    renderEditor(screenUnderTest, 'new');

    const save = screen.getByRole('button', { name: copy('common.save') });
    expect(save.closest('aside')).toBeNull();
    expect(save.closest('section')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: shell('hideSettings') }));
    expect(screen.getByRole('button', { name: copy('common.save') })).toBeTruthy();
  });

  it('reopens a collapsed panel when a save is refused over a field that lives in it', async () => {
    renderEditor(screenUnderTest, 'new');

    fireEvent.click(screen.getByRole('button', { name: shell('hideSettings') }));
    expect(screen.queryByRole('complementary', { name: shell('settings') })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    expect((await screen.findByRole('alert')).textContent).toContain(screenUnderTest.missingChannel);
    expect(screen.getByRole('complementary', { name: shell('settings') })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: shell('hideSettings') })
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('reopens a collapsed panel when the server refuses the save', async () => {
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '0');
    vi.spyOn(apiClient, 'patch').mockRejectedValue(new Error('Code is already taken'));
    renderEditor(screenUnderTest, 'entity-1');

    // An existing entity honours the remembered choice.
    await screen.findByRole('heading', { level: 1, name: 'Stored entity' });
    expect(screen.queryByRole('complementary', { name: shell('settings') })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Code is already taken');
    });
    expect(screen.getByRole('complementary', { name: shell('settings') })).toBeTruthy();
    // Opened by the screen, not chosen by the operator: the preference stands.
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });
});

describe('the shell copy ships in both languages, in the bundle every consumer loads', () => {
  const keys = ['settings', 'builder', 'hideSettings', 'showSettings'];

  it.each(keys)('pageBuilder.editorLayout.%s', (key) => {
    expect(coreEn[`pageBuilder.editorLayout.${key}`]).toBeTruthy();
    expect(corePl[`pageBuilder.editorLayout.${key}`]).toBeTruthy();
  });

  it('is translated, not copied, where Polish has its own words', () => {
    for (const key of ['settings', 'hideSettings', 'showSettings']) {
      expect(corePl[`pageBuilder.editorLayout.${key}`]).not.toBe(shell(key));
    }
  });

  it.each(keys)('left `cms` when the shell did: editorLayout.%s has one home', (key) => {
    // Two statements of one string drift; blog and the e-mail editors never loaded this one.
    expect(en[`editorLayout.${key}`]).toBeUndefined();
    expect(pl[`editorLayout.${key}`]).toBeUndefined();
  });
});

/**
 * Feature 163 (T081; spec US8, FR-030–FR-032): the page editor's breadcrumb
 * settings — the parent page, "Show breadcrumbs" and the scheme. The parent
 * picker is the kit's `CmsPagePicker`; it leaves out the page itself and its
 * descendants, while the `cms_page.update` Command stays the authority.
 */
describe('PageEditor breadcrumb settings (feature 163)', () => {
  const tree = [
    { id: 'entity-2', name: 'Edited page', slug: 'edited', status: 'published', parentPageId: 'root-1' },
    { id: 'child-1', name: 'Child page', slug: 'child', status: 'published', parentPageId: 'entity-2' },
    { id: 'grandchild-1', name: 'Grandchild page', slug: 'grandchild', status: 'draft', parentPageId: 'child-1' },
    { id: 'root-1', name: 'Client zone', slug: 'client-zone', status: 'published', parentPageId: null },
    { id: 'other-1', name: 'Other page', slug: 'other', status: 'published', parentPageId: null },
  ];
  const edited = {
    ...stored,
    id: 'entity-2',
    name: 'Edited page',
    slug: 'edited',
    parentPageId: 'root-1',
    breadcrumbsVisible: true,
    breadcrumbsScheme: 'muted',
    shareImageAssetId: null,
  };

  beforeEach(() => {
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/sales-channels?')) {
        return Promise.resolve({ items: [channel], page: 1, pageSize: 100, total: 1 } as never);
      }
      if (path.startsWith('/api/v1/admin/sales-channels/')) {
        return Promise.resolve({ ...channel, languages: ['en-US', 'pl-PL'] } as never);
      }
      if (path === '/api/v1/admin/cms/pages/entity-2') return Promise.resolve({ data: edited } as never);
      if (path === '/api/v1/admin/cms/pages/root-1') {
        return Promise.resolve({ data: { ...stored, id: 'root-1', name: 'Client zone' } } as never);
      }
      if (path === '/api/v1/admin/cms/pages/reserved-segments') {
        return Promise.resolve({ data: { segments: [] } } as never);
      }
      if (path.startsWith('/api/v1/admin/cms/pages')) {
        return Promise.resolve({ data: tree, nextCursor: null } as never);
      }
      return Promise.reject(new Error(`unstubbed read: ${path}`));
    });
  });

  function renderEdited(): void {
    renderWithI18n(
      <MemoryRouter initialEntries={['/cms/pages/entity-2']}>
        <Routes>
          <Route path="/cms/pages/:id" element={<PageEditor />} />
        </Routes>
      </MemoryRouter>,
      { cms: en, core: coreEn },
    );
  }

  it('shows the stored parent, visibility and scheme, and saves all three', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: edited } as never);
    renderEdited();
    await screen.findByRole('heading', { level: 1, name: 'Edited page' });

    const settings = screen.getByRole('complementary', { name: shell('settings') });
    expect(within(settings).getByText(copy('pageEditor.breadcrumbs.title'))).toBeTruthy();
    const parent = within(settings).getByRole('combobox', { name: copy('pageEditor.breadcrumbs.parent') });
    await waitFor(() => expect((parent as HTMLInputElement).value).toBe('Client zone'));

    const visible = within(settings).getByRole('checkbox', { name: copy('pageEditor.breadcrumbs.visible') });
    expect((visible as HTMLInputElement).checked).toBe(true);
    const scheme = within(settings).getByLabelText(copy('pageEditor.breadcrumbs.scheme'));
    expect((scheme as HTMLSelectElement).value).toBe('muted');

    fireEvent.click(visible);
    fireEvent.change(scheme, { target: { value: 'dark' } });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toMatchObject({
      parentPageId: 'root-1',
      breadcrumbsVisible: false,
      breadcrumbsScheme: 'dark',
    });
  });

  // R21H (T355): the trail over the first section, off by default (a stored page without the field reads off).
  it('shows "Show the breadcrumbs over the first section" off and saves it on', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: edited } as never);
    renderEdited();
    await screen.findByRole('heading', { level: 1, name: 'Edited page' });

    const settings = screen.getByRole('complementary', { name: shell('settings') });
    const overlay = within(settings).getByRole('checkbox', { name: copy('pageEditor.breadcrumbs.overlay') });
    expect((overlay as HTMLInputElement).checked).toBe(false);
    expect(within(settings).getByText(copy('pageEditor.breadcrumbs.overlayHelp'))).toBeTruthy();
    fireEvent.click(overlay);
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toMatchObject({ breadcrumbsOverlay: true });
  });

  it('offers neither the page itself nor its descendants as its parent', async () => {
    renderEdited();
    await screen.findByRole('heading', { level: 1, name: 'Edited page' });

    const parent = screen.getByRole('combobox', { name: copy('pageEditor.breadcrumbs.parent') });
    fireEvent.click(parent);

    expect(await screen.findByRole('option', { name: /Other page/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Client zone/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Edited page/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /^Child page/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Grandchild page/ })).toBeNull();
  });

  /**
   * Feature 163 (T084; spec US9, FR-033): the page's sharing image, through the
   * kit's asset picker. Cleared, it is saved as `null` and the deployment
   * default applies.
   */
  it('shows the stored sharing image and saves it, and saves null once cleared', async () => {
    const withImage = { ...edited, shareImageAssetId: '00000000-0000-4000-8000-0000000000a1' };
    const read = apiClient.get as unknown as { getMockImplementation(): ((path: string) => Promise<unknown>) | undefined };
    const fallback = read.getMockImplementation()!;
    vi.spyOn(apiClient, 'get').mockImplementation(((path: string) => {
      if (path === '/api/v1/admin/cms/pages/entity-2') return Promise.resolve({ data: withImage });
      if (path === `/api/v1/admin/assets/${withImage.shareImageAssetId}`) {
        return Promise.resolve({ data: { id: withImage.shareImageAssetId, label: 'Launch banner', filename: 'banner.png' } });
      }
      return fallback(path);
    }) as never);
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: withImage } as never);
    renderEdited();
    await screen.findByRole('heading', { level: 1, name: 'Edited page' });

    const settings = screen.getByRole('complementary', { name: shell('settings') });
    expect(within(settings).getByText(copy('pageEditor.share.title'))).toBeTruthy();
    const field = within(settings).getByRole('textbox', { name: copy('pageEditor.share.image') });
    await waitFor(() => expect((field as HTMLInputElement).value).toBe('Launch banner'));

    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![1]).toMatchObject({ shareImageAssetId: withImage.shareImageAssetId });

    fireEvent.click(within(settings).getByRole('button', { name: copy('pageEditor.share.clear') }));
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1]![1]).toMatchObject({ shareImageAssetId: null });
  });

  it('ships every sharing-image label in both languages, translated', () => {
    for (const key of [
      'pageEditor.share.title',
      'pageEditor.share.image',
      'pageEditor.share.placeholder',
      'pageEditor.share.help',
      'pageEditor.share.choose',
      'pageEditor.share.change',
      'pageEditor.share.clear',
    ]) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
      expect(pl[key], key).not.toBe(en[key]);
    }
  });

  /**
   * Feature 163 R19D (T286): "Include the parent's path in the address". Off,
   * the address is the flat slug, as for every page stored before the option;
   * on, the editor shows the address under the parent's path and saves the
   * option.
   */
  it('shows the address under the parent path once the page includes it, and saves the option', async () => {
    const read = apiClient.get as unknown as { getMockImplementation(): ((path: string) => Promise<unknown>) | undefined };
    const fallback = read.getMockImplementation()!;
    vi.spyOn(apiClient, 'get').mockImplementation(((path: string) => {
      if (path === '/api/v1/admin/cms/pages/root-1') {
        return Promise.resolve({
          data: { ...stored, id: 'root-1', name: 'Client zone', slug: 'client-zone', parentPageId: null, parentPathInUrl: false },
        });
      }
      return fallback(path);
    }) as never);
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: edited } as never);
    renderEdited();
    await screen.findByRole('heading', { level: 1, name: 'Edited page' });

    const settings = screen.getByRole('complementary', { name: shell('settings') });
    // R24: the page's own address, and the active language's, which inherits it.
    expect(within(settings).getAllByText('/edited')).toHaveLength(2);
    const nested = within(settings).getByRole('checkbox', { name: copy('pageEditor.parentPathInUrl') });
    expect((nested as HTMLInputElement).checked).toBe(false);

    fireEvent.click(nested);
    expect(await within(settings).findAllByText('/client-zone/edited')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toMatchObject({ parentPageId: 'root-1', parentPathInUrl: true });
  });

  it('ships every breadcrumb label in both languages, translated', () => {
    const keys = [
      'pageEditor.parentPathInUrl',
      'pageEditor.parentPathInUrlHelp',
      'pageEditor.breadcrumbs.title',
      'pageEditor.breadcrumbs.parent',
      'pageEditor.breadcrumbs.parentHelp',
      'pageEditor.breadcrumbs.parentPlaceholder',
      'pageEditor.breadcrumbs.visible',
      'pageEditor.breadcrumbs.scheme',
      'pageEditor.breadcrumbs.scheme.light',
      'pageEditor.breadcrumbs.scheme.muted',
      'pageEditor.breadcrumbs.scheme.dark',
    ];
    for (const key of keys) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
      expect(pl[key], key).not.toBe(en[key]);
    }
  });
});

/**
 * Feature 163 R24 (issue #521): a page's name, slug and description per
 * language, beside its meta fields. The card edits the language the canvas
 * shows; an empty field inherits the page's own value, which it shows as the
 * placeholder, and the address preview follows the language's slug.
 */
describe('PageEditor language version (feature 163, R24)', () => {
  const translated = {
    ...stored,
    id: 'entity-3',
    name: 'Edited page',
    slug: 'edited',
    description: 'Base description',
    languages: ['en-US', 'pl-PL'],
    parentPageId: null,
    parentPathInUrl: false,
    translations: { 'pl-PL': { name: 'Strona', slug: 'strona' } },
    meta: { 'en-US': { title: 'EN title' }, 'pl-PL': { title: 'PL title', description: 'PL description' } },
  };

  beforeEach(() => {
    const read = apiClient.get as unknown as { getMockImplementation(): ((path: string) => Promise<unknown>) | undefined };
    const fallback = read.getMockImplementation()!;
    vi.spyOn(apiClient, 'get').mockImplementation(((path: string) => {
      if (path === '/api/v1/admin/cms/pages/entity-3') return Promise.resolve({ data: translated });
      if (path.startsWith('/api/v1/admin/cms/pages?') || path === '/api/v1/admin/cms/pages') {
        return Promise.resolve({ data: [], nextCursor: null });
      }
      return fallback(path);
    }) as never);
  });

  function renderTranslated(): void {
    renderWithI18n(
      <MemoryRouter initialEntries={['/cms/pages/entity-3']}>
        <Routes>
          <Route path="/cms/pages/:id" element={<PageEditor />} />
        </Routes>
      </MemoryRouter>,
      { cms: en, core: coreEn },
    );
  }

  const label = (key: string, language: string) => copy(key).replace('{language}', language);

  it('edits the language the canvas shows, inheriting the page fields, and saves every language', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: translated } as never);
    renderTranslated();
    await screen.findByRole('heading', { level: 1, name: 'Edited page' });
    const settings = screen.getByRole('complementary', { name: shell('settings') });
    expect(within(settings).getByText(copy('pageEditor.languageVersion.title'))).toBeTruthy();

    // en-US, the first language, overrides nothing: its fields are empty and show what they inherit.
    const enName = within(settings).getByLabelText(label('pageEditor.languageVersion.name', 'en-US')) as HTMLInputElement;
    expect(enName.value).toBe('');
    expect(enName.placeholder).toBe('Edited page');
    expect((within(settings).getByLabelText(label('pageEditor.languageVersion.description', 'en-US')) as HTMLTextAreaElement).placeholder).toBe(
      'Base description',
    );
    expect((within(settings).getByLabelText(label('pageEditor.languageVersion.metaTitle', 'en-US')) as HTMLInputElement).value).toBe('EN title');

    fireEvent.click(within(settings).getByRole('tab', { name: 'pl-PL' }));
    const plSlug = within(settings).getByLabelText(label('pageEditor.languageVersion.slug', 'pl-PL')) as HTMLInputElement;
    expect((within(settings).getByLabelText(label('pageEditor.languageVersion.name', 'pl-PL')) as HTMLInputElement).value).toBe('Strona');
    expect(plSlug.value).toBe('strona');
    expect(plSlug.placeholder).toBe('edited');
    expect(within(settings).getByText('/strona')).toBeTruthy();
    expect((within(settings).getByLabelText(label('pageEditor.languageVersion.metaTitle', 'pl-PL')) as HTMLInputElement).value).toBe('PL title');

    fireEvent.change(plSlug, { target: { value: 'Nowa-Strona' } });
    expect(within(settings).getByText('/nowa-strona')).toBeTruthy();
    fireEvent.change(within(settings).getByLabelText(label('pageEditor.languageVersion.description', 'pl-PL')), {
      target: { value: 'Opis' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toMatchObject({
      name: 'Edited page',
      slug: 'edited',
      translations: { 'pl-PL': { name: 'Strona', slug: 'nowa-strona', description: 'Opis' } },
      meta: { 'en-US': { title: 'EN title' }, 'pl-PL': { title: 'PL title', description: 'PL description' } },
    });
  });

  it('derives a language slug from its name until the slug is edited', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: translated } as never);
    renderTranslated();
    await screen.findByRole('heading', { level: 1, name: 'Edited page' });
    const settings = screen.getByRole('complementary', { name: shell('settings') });

    fireEvent.change(within(settings).getByLabelText(label('pageEditor.languageVersion.name', 'en-US')), {
      target: { value: 'About the company' },
    });
    expect((within(settings).getByLabelText(label('pageEditor.languageVersion.slug', 'en-US')) as HTMLInputElement).value).toBe(
      'about-the-company',
    );
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect((patch.mock.calls[0]![1] as { translations: unknown }).translations).toEqual({
      'en-US': { name: 'About the company', slug: 'about-the-company' },
      'pl-PL': { name: 'Strona', slug: 'strona' },
    });
  });

  it('ships every language-version label in both languages, translated', () => {
    for (const key of [
      'pageEditor.languageVersion.title',
      'pageEditor.languageVersion.help',
      'pageEditor.languageVersion.name',
      'pageEditor.languageVersion.slug',
      'pageEditor.languageVersion.description',
      'pageEditor.languageVersion.metaTitle',
      'pageEditor.languageVersion.metaDescription',
      'pageEditor.languageVersion.metaKeywords',
      'pageEditor.pageFieldsHelp',
    ]) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
      expect(pl[key], key).not.toBe(en[key]);
    }
  });
});

/**
 * Issue #1461 (UX audit CONTENT-02) — every CMS editor compares its draft with
 * the last saved version and, while they differ, says so beside Save and asks
 * Save / Discard / Stay before a link (Back, the sidebar) takes the operator away.
 */
describe.each(screens)('$name — unsaved changes', (screenUnderTest) => {
  function renderWithList(): void {
    renderWithI18n(
      <MemoryRouter initialEntries={[`${screenUnderTest.path}/entity-1`]}>
        <Routes>
          <Route path={`${screenUnderTest.path}/:id`} element={screenUnderTest.element} />
          <Route path={screenUnderTest.path} element={<p>List screen</p>} />
        </Routes>
      </MemoryRouter>,
      { cms: en, core: coreEn },
    );
  }

  async function loaded(): Promise<void> {
    await screen.findByRole('heading', { level: 1, name: 'Stored entity' });
  }

  function nameField(): HTMLInputElement {
    const settings = screen.getByRole('complementary', { name: shell('settings') });
    return within(settings).getAllByRole('textbox')[0] as HTMLInputElement;
  }

  it('is clean as loaded, and a canvas reseed equal to what is stored is not an edit', async () => {
    renderWithList();
    await loaded();
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'reseed-canvas' }));
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe('');
    fireEvent.click(screen.getByRole('link', { name: copy('common.back') }));
    expect(await screen.findByText('List screen')).toBeTruthy();
  });

  it('Back is the page header\'s back link above the title, not one more button beside Save (#1494)', async () => {
    renderWithList();
    await loaded();
    const back = screen.getByRole('link', { name: copy('common.back') });
    const heading = screen.getByRole('heading', { level: 1, name: 'Stored entity' });
    // Before the title in document order, and not styled as a button.
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back.closest('header')?.contains(heading)).toBe(true);
    expect(back.className).not.toMatch(/\bborder\b/);
  });

  it('a metadata edit shows the hint; Back asks, Stay keeps the edit', async () => {
    renderWithList();
    await loaded();
    fireEvent.change(nameField(), { target: { value: 'Renamed' } });
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe(ux('hint'));
    fireEvent.click(screen.getByRole('link', { name: copy('common.back') }));
    const dialog = screen.getByRole('dialog', { name: ux('title') });
    fireEvent.click(within(dialog).getByRole('button', { name: ux('stay') }));
    expect(screen.queryByText('List screen')).toBeNull();
    expect(nameField().value).toBe('Renamed');
  });

  it('a canvas edit is unsaved too, and Discard leaves for where the link pointed', async () => {
    renderWithList();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'edit-canvas' }));
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe(ux('hint'));
    fireEvent.click(screen.getByRole('link', { name: copy('common.back') }));
    fireEvent.click(screen.getByRole('button', { name: ux('discard') }));
    expect(await screen.findByText('List screen')).toBeTruthy();
  });
});
