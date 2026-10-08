import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { withLocalStorage } from '../../helpers/with-local-storage';
import { withViewportWidth } from '../../helpers/with-viewport-width';
import { PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY } from '../../../../packages/page-builder-admin/src/chrome/PageBuilderEditorLayout';
import { BlogPostEditor } from '../../../../packages/modules/blog/src/admin/pages/BlogPostEditor';
import { BlogCategoryEditor } from '../../../../packages/modules/blog/src/admin/pages/BlogCategoryEditor';

/**
 * The blog post and blog category editors in the shell the CMS editors use.
 *
 * `page-builder-admin/page-builder-editor-layout.test.tsx` holds the shell on
 * its own. This file is about the two blog screens that fill it, and about the
 * two things that make them different from a CMS editor:
 *
 * - **a new post or category has no canvas.** Content cannot be authored until
 *   the entity exists, so there is nothing to give the room to and the fields
 *   are the page — no panel, no control to hide them;
 * - **they used to save in pieces.** "Save metadata" sat at the bottom of the
 *   form and "Save content" over the canvas. A save button inside a panel that
 *   collapses is a save button that can disappear, so there is one save, in the
 *   header, and it sends the same two requests the two buttons sent.
 *
 * The canvas is stubbed: Puck needs an iframe and a layout engine. The stub
 * carries one button so a test can say "the operator changed the canvas".
 */
const canvasEdit = { root: { props: {} }, content: [{ type: 'Heading', props: { id: 'h-1' } }] };

vi.mock('@endora-commerce/mod-cms/admin-ui', () => ({
  PageBuilderEditor: ({
    onChange,
    contentKey,
  }: {
    onChange: (data: unknown) => void;
    contentKey?: string;
  }): ReactElement => (
    <div data-testid="canvas-stub" data-content-key={contentKey ?? ''}>
      <button type="button" onClick={() => onChange(canvasEdit)}>
        edit canvas
      </button>
    </div>
  ),
}));

function bundleOf(pkg: string, language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/${pkg}/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const en = bundleOf('blog', 'en');
const pl = bundleOf('blog', 'pl');
const core = bundleOf('_i18n', 'en');

function copy(key: string, params: Record<string, string> = {}): string {
  const value = en[key];
  if (!value) throw new Error(`blog/i18n/en.json carries no "${key}"`);
  return Object.entries(params).reduce((text, [k, v]) => text.replace(`{${k}}`, v), value);
}

function shell(key: string): string {
  const value = core[`pageBuilder.editorLayout.${key}`];
  if (!value) throw new Error(`_i18n/i18n/en.json carries no "pageBuilder.editorLayout.${key}"`);
  return value;
}

const channel = {
  id: 'channel-1',
  code: 'web',
  name: { 'en-US': 'Web store' },
  active: true,
  defaultLanguage: 'en-US',
};

const storedPost = {
  id: 'entity-1',
  name: { 'en-US': 'Stored entity' },
  slug: 'stored-entity',
  active: true,
  status: 'draft',
  publishedAt: null,
  description: null,
  metaTitle: { 'en-US': 'Stored meta title' },
  metaDescription: null,
  metaKeywords: null,
  meta: null,
  content: { schema_version: 1, languages: {} },
  version: 3,
  salesChannelIds: ['channel-1'],
  languages: ['en-US', 'pl-PL'],
  categoryIds: [],
  tags: [],
  relatedPostIds: [],
  relatedProductIds: [],
};

const storedCategory = {
  id: 'entity-1',
  parentId: null,
  position: 0,
  name: { 'en-US': 'Stored entity' },
  slug: 'stored-entity',
  enabled: true,
  isSystem: false,
  metaTitle: { 'en-US': 'Stored meta title' },
  metaDescription: null,
  metaKeywords: null,
  description: null,
  mainImageAssetId: null,
  version: 3,
  salesChannelIds: ['channel-1'],
  languages: ['en-US', 'pl-PL'],
};

interface Screen {
  name: string;
  path: string;
  element: ReactElement;
  detailPath: RegExp;
  stored: Record<string, unknown>;
  /** The request that carries the canvas, relative to the entity. */
  contentPath: string;
  builderLabel: string;
  newTitle: string;
}

const screens: Screen[] = [
  {
    name: 'BlogPostEditor',
    path: '/blog/posts',
    element: <BlogPostEditor />,
    detailPath: /\/api\/v1\/admin\/blog\/posts\/entity-1$/,
    stored: storedPost,
    contentPath: '/api/v1/admin/blog/posts/entity-1/content',
    builderLabel: copy('postEditor.contentTitle', { language: 'en-US' }),
    newTitle: copy('postEditor.title.new'),
  },
  {
    name: 'BlogCategoryEditor',
    path: '/blog/categories',
    element: <BlogCategoryEditor />,
    detailPath: /\/api\/v1\/admin\/blog\/categories\/entity-1$/,
    stored: storedCategory,
    contentPath: '/api/v1/admin/blog/categories/entity-1/description',
    builderLabel: copy('categoryEditor.descriptionTitle', { language: 'en-US' }),
    newTitle: copy('categoryEditor.title.new'),
  },
];

function renderEditor(screenUnderTest: Screen, id: string): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[`${screenUnderTest.path}/${id}`]}>
      <Routes>
        <Route path={`${screenUnderTest.path}/:id`} element={screenUnderTest.element} />
      </Routes>
    </MemoryRouter>,
    { blog: en, core },
  );
}

async function loaded(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Stored entity' });
  await screen.findByTestId('canvas-stub');
}

function settingsPanel(): HTMLElement {
  return screen.getByRole('complementary', { name: shell('settings') });
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText(copy('fields.namePerLanguage'), { selector: 'input' }) as HTMLInputElement;
}

function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: copy('common.save') });
}

let patch: ReturnType<typeof vi.spyOn>;
let put: ReturnType<typeof vi.spyOn>;

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
    for (const s of screens) {
      if (s.detailPath.test(path)) return Promise.resolve({ data: s.stored } as never);
    }
    // The tag, related-post and related-product pickers list what they offer.
    return Promise.resolve({
      data: [],
      pagination: { page: 1, perPage: 50, totalPages: 1, totalItems: 0 },
    } as never);
  });
  patch = vi.spyOn(apiClient, 'patch').mockImplementation((path: string) => {
    const s = screens.find((candidate) => candidate.detailPath.test(path));
    return Promise.resolve({ data: { ...s?.stored, version: 4 } } as never);
  });
  put = vi.spyOn(apiClient, 'put').mockImplementation((path: string) => {
    const s = screens.find((candidate) => path.startsWith(candidate.path.replace('/blog', '/api/v1/admin/blog')));
    return Promise.resolve({ data: { ...s?.stored, version: 5 } } as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(screens)('$name in the shared editor shell', (screenUnderTest) => {
  it('hands the fields and the scope picker to the settings panel and the canvas to the builder', async () => {
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();

    const settings = settingsPanel();
    expect(within(settings).getByText(copy('sections.metadata'))).toBeTruthy();
    expect(within(settings).getByText(copy('sections.seo'))).toBeTruthy();
    expect(await within(settings).findByText(/Web store/)).toBeTruthy();
    expect(settings.contains(nameField())).toBe(true);
    expect(nameField().value).toBe('Stored entity');

    // The region is named after what is composed in it, not after the tool.
    const builder = screen.getByRole('region', { name: screenUnderTest.builderLabel });
    expect(within(builder).getByTestId('canvas-stub')).toBeTruthy();
    expect(builder.contains(nameField())).toBe(false);
  });

  it('groups the panel: what the entity is, where it shows, how it is found', async () => {
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();

    const settings = settingsPanel();
    const metadata = within(settings).getByText(copy('sections.metadata'));
    const scope = await within(settings).findByText(/Web store/);
    const seo = within(settings).getByText(copy('sections.seo'));
    const follows = (a: Element, b: Element): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(metadata, scope)).toBe(true);
    expect(follows(scope, seo)).toBe(true);
    // The meta fields are their own group, not a tail on the name and slug.
    const seoCard = seo.closest('[data-settings-group]');
    expect(seoCard).not.toBeNull();
    expect(
      within(seoCard as HTMLElement).getByLabelText(copy('fields.metaTitlePerLanguage')),
    ).toBeTruthy();
    expect((seoCard as HTMLElement).contains(nameField())).toBe(false);
  });

  it('keeps the language tabs with the canvas they switch, and re-seeds the canvas per language', async () => {
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();

    const tab = screen.getByRole('tab', { name: 'pl-PL' });
    expect(settingsPanel().contains(tab)).toBe(false);
    expect(screen.getByTestId('canvas-stub').getAttribute('data-content-key')).toBe('entity-1:en-US');

    fireEvent.click(tab);

    await waitFor(() => {
      expect(screen.getByTestId('canvas-stub').getAttribute('data-content-key')).toBe('entity-1:pl-PL');
    });
  });

  it('starts with the panel put away on a laptop, the canvas and the save action still there', async () => {
    withViewportWidth(1440);
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();

    expect(screen.queryByRole('complementary', { name: shell('settings') })).toBeNull();
    expect(
      screen.getByRole('button', { name: shell('showSettings') }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.getByTestId('canvas-stub')).toBeTruthy();
    expect(saveButton().closest('aside')).toBeNull();
    expect(saveButton().closest('section')).toBeNull();
  });

  it('shares the remembered choice with every other Page Builder editor', async () => {
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: shell('hideSettings') }));

    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });

  it('saves the fields and an edited canvas with one action, in the two requests there always were', async () => {
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'edit canvas' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledTimes(1);
    const [patchPath, patchBody] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(screenUnderTest.detailPath.test(patchPath)).toBe(true);
    expect(patchBody).toMatchObject({
      name: { 'en-US': 'Stored entity' },
      slug: 'stored-entity',
      salesChannelIds: ['channel-1'],
      languages: ['en-US', 'pl-PL'],
      version: 3,
    });

    const [putPath, putBody] = put.mock.calls[0] as [string, Record<string, unknown>];
    expect(putPath).toBe(screenUnderTest.contentPath);
    // The canvas request carries the version the fields request answered with.
    expect(putBody.version).toBe(4);
    expect(JSON.stringify(putBody)).toContain('"en-US":{"root":{"props":{}},"content":[{"type":"Heading"');
    // Announced, not only shown: a polite live region that was there before the text.
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(copy('messages.saved'));
    });
  });

  it('does not rewrite a canvas nobody touched', async () => {
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();

    fireEvent.click(saveButton());

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    await screen.findByText(copy('messages.saved'));
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses a save without a name, says why, and opens the panel the name lives in', async () => {
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '0');
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();
    expect(screen.queryByRole('complementary', { name: shell('settings') })).toBeNull();

    // The panel is hidden, not unmounted: the field is there to be emptied.
    fireEvent.change(
      screen.getByLabelText(copy('fields.namePerLanguage'), { selector: 'input' }),
      { target: { value: '  ' } },
    );
    fireEvent.click(saveButton());

    expect((await screen.findByRole('alert')).textContent).toContain(copy('validation.nameRequired'));
    expect(settingsPanel()).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    // The field says it too, and points at the sentence that says why.
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(nameField().getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    expect(screen.getByRole('alert').id).not.toBe('');
    // Opened by the screen, not chosen by the operator: the preference stands.
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });

  it('reopens a collapsed panel when the server refuses the save', async () => {
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '0');
    patch.mockRejectedValue(new Error('Slug is already taken'));
    renderEditor(screenUnderTest, 'entity-1');
    await loaded();

    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Slug is already taken');
    });
    expect(settingsPanel()).toBeTruthy();
    expect(window.localStorage.getItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY)).toBe('0');
  });

  it('for a new entity shows the fields as the page: no canvas yet, so nothing to collapse', async () => {
    window.localStorage.setItem(PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY, '0');
    withViewportWidth(1440);
    renderEditor(screenUnderTest, 'new');

    expect(screen.getByRole('heading', { level: 1, name: screenUnderTest.newTitle })).toBeTruthy();
    const settings = screen.getByRole('region', { name: shell('settings') });
    expect(settings.contains(nameField())).toBe(true);
    expect(await within(settings).findByText(/Web store/)).toBeTruthy();
    expect(screen.queryByTestId('canvas-stub')).toBeNull();
    expect(screen.queryByRole('button', { name: shell('showSettings') })).toBeNull();
    expect(screen.queryByRole('button', { name: shell('hideSettings') })).toBeNull();
    // One primary action, where the save action is on an existing entity.
    const create = screen.getByRole('button', { name: copy('common.create') });
    expect(create.closest('section')).toBeNull();
  });

  it('for a new entity refuses a create without a sales channel and names the reason', async () => {
    renderEditor(screenUnderTest, 'new');
    const post = vi.spyOn(apiClient, 'post');

    fireEvent.change(nameField(), { target: { value: 'Guides' } });
    fireEvent.change(screen.getByLabelText(copy('fields.slug'), { selector: 'input' }), {
      target: { value: 'guides' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy('common.create') }));

    expect((await screen.findByRole('alert')).textContent).toContain(copy('validation.selectChannel'));
    expect(post).not.toHaveBeenCalled();
  });
});

describe('BlogPostEditor — publishing is not a setting', () => {
  it('keeps Publish in the header, reachable with the panel put away', async () => {
    withViewportWidth(1440);
    renderEditor(screens[0]!, 'entity-1');
    await loaded();

    const publish = screen.getByRole('button', { name: copy('common.publish') });
    expect(publish.closest('aside')).toBeNull();
    expect(publish.closest('[hidden]')).toBeNull();
    // A draft cannot be unpublished, so the header does not offer it.
    expect(screen.queryByRole('button', { name: copy('common.unpublish') })).toBeNull();
  });

  it('shows the status beside the canvas, not only inside the panel', async () => {
    withViewportWidth(1440);
    renderEditor(screens[0]!, 'entity-1');
    await loaded();

    const visible = screen
      .getAllByText(copy('status.draft'))
      .filter((node) => node.closest('[hidden]') === null);
    expect(visible.length).toBeGreaterThan(0);
  });

  it('puts the rare, hard-to-undo Archive in the panel, away from Save', async () => {
    renderEditor(screens[0]!, 'entity-1');
    await loaded();

    const archive = screen.getByRole('button', { name: copy('common.archive') });
    expect(settingsPanel().contains(archive)).toBe(true);
  });

  it('gives tags and related content a place in the panel', async () => {
    renderEditor(screens[0]!, 'entity-1');
    await loaded();

    const settings = settingsPanel();
    expect(within(settings).getByText(copy('sections.tags'))).toBeTruthy();
    expect(within(settings).getByText(copy('sections.relatedPosts'))).toBeTruthy();
    expect(within(settings).getByText(copy('sections.relatedProducts'))).toBeTruthy();
  });
});

describe('the blog editor copy ships in both languages', () => {
  it.each([
    'common.save',
    'common.saveAndExit',
    'sections.seo',
    'postEditor.content',
    'categoryEditor.descriptionLabel',
    'categoryEditor.description.new',
    'validation.nameRequired',
    'validation.slugInvalid',
    'validation.selectChannel',
    'validation.selectLanguage',
  ])('%s', (key) => {
    expect(en[key]).toBeTruthy();
    expect(pl[key]).toBeTruthy();
  });

  it('is translated, not copied', () => {
    expect(pl['validation.nameRequired']).not.toBe(en['validation.nameRequired']);
    expect(pl['common.saveAndExit']).not.toBe(en['common.saveAndExit']);
  });
});
