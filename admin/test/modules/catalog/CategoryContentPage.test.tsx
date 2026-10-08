import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * The category content screen — where an operator authors the Page Builder
 * document a category's storefront page renders.
 *
 * ## What the host owns, and what it does not
 *
 * `catalog` owns the document: it loads the per-language envelope, holds the
 * draft, and saves it with one `PUT`. It does **not** own a Page Builder — the
 * canvas is whatever contributes to the `category.content.editor` zone, which
 * on a composed platform is `cms`. So the subject here is the host's half:
 * which document it hands the zone, what it sends back to the API, and what it
 * shows when nobody contributes an editor at all (`cms` switched off or not
 * installed), which is a state `catalog` must survive because it is
 * `nonDeactivatable` and `cms` is not.
 *
 * The contribution is a stub that reports an edit when asked; `cms`' real
 * declaration is asserted against the shipped package in
 * `admin/test/modules/cms/category-content-zone.test.tsx`.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { CategoryContentPage } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/CategoryContentPage'
);

const CATEGORY_ID = '33333333-3333-4333-8333-333333333303';

const tree = (marker: string): Record<string, unknown> => ({
  root: { props: {} },
  content: [{ type: 'cms.RichContent', props: { id: marker, html: `<p>${marker}</p>` } }],
});

const PASSTHROUGH = passthroughBundle('catalog', [
  'categoryContent.page.description',
  'categoryContent.action.back',
  'categoryContent.action.save',
  'categoryContent.action.saving',
  'categoryContent.success.save',
  'categoryContent.error.load',
  'categoryContent.error.save',
  'categoryContent.loading',
  'categoryContent.editor.title',
  'categoryContent.noEditor.title',
  'categoryContent.noEditor.description',
  'categoryContent.readOnly',
]);
// The one key with a parameter, spelled as a template so the interpolation is
// what the assertion reads.
const BUNDLE = {
  catalog: { ...PASSTHROUGH['catalog'], 'categoryContent.page.title': 'Content of {name}' },
};

/**
 * A contribution standing in for a Page Builder: it prints the document it was
 * handed and the language it was handed it for, and reports an edit on click.
 */
function EditorStub({
  language,
  data,
  onChange,
}: AdminZoneProps<'category.content.editor'>): React.ReactNode {
  return (
    <div data-testid="editor-stub">
      <span data-testid="editor-language">{language}</span>
      <span data-testid="editor-data">{JSON.stringify(data)}</span>
      <button type="button" onClick={(): void => onChange(tree(`edited-${language}`))}>
        stub-edit
      </button>
    </div>
  );
}

const EDITOR_CONTRIBUTION = {
  moduleId: 'cms',
  contributions: {
    zones: [
      {
        zone: 'category.content.editor' as const,
        weight: 100,
        requiredPermission: 'cms.read',
        component: async () => ({ default: EditorStub as never }),
      },
    ],
  },
};

function renderPage(options: {
  readonly contributions?: readonly (typeof EDITOR_CONTRIBUTION)[];
  readonly permissions?: readonly string[];
  readonly absent?: readonly string[];
}): void {
  renderWithSession(
    <MemoryRouter initialEntries={[`/catalog/categories/${CATEGORY_ID}/content`]}>
      <Routes>
        <Route path="/catalog/categories/:id/content" element={<CategoryContentPage />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: [...(options.permissions ?? ['*'])] }),
      presence: modulePresence({
        present: everyDeclaredModule().filter((id) => !(options.absent ?? []).includes(id)),
        absent: [...(options.absent ?? [])],
      }),
      contributions: options.contributions ?? [EDITOR_CONTRIBUTION],
      bundle: BUNDLE,
    },
  );
}

function stubApi(content: { languages: Record<string, unknown> } | null): void {
  getSpy.mockImplementation(async (path: string) => {
    if (path.endsWith(`/categories/${CATEGORY_ID}/content`)) {
      return { data: { categoryId: CATEGORY_ID, content } };
    }
    if (path.endsWith('/catalog/categories')) {
      return {
        data: [
          {
            id: CATEGORY_ID,
            parentCategoryId: null,
            name: { 'en-US': 'Hand tools', 'pl-PL': 'Narzędzia ręczne' },
            slug: 'hand-tools',
            sortOrder: 0,
            isActive: true,
          },
        ],
      };
    }
    return { data: [] };
  });
  putSpy.mockImplementation(async (_path: string, body: { content: unknown }) => ({
    data: { categoryId: CATEGORY_ID, content: body.content },
  }));
}

describe('CategoryContentPage', () => {
  beforeEach(() => {
    getSpy.mockReset();
    putSpy.mockReset();
  });

  it('hands the editor the stored document of the active language', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en'), 'pl-PL': tree('stored-pl') } });
    renderPage({});

    await waitFor(() => expect(screen.getByTestId('editor-language').textContent).toBe('en-US'));
    expect(screen.getByTestId('editor-data').textContent).toContain('stored-en');
    // The heading names the category, in the operator's language.
    expect(screen.getByText('Content of Hand tools')).toBeTruthy();
  });

  it('offers the languages the category is named in and switches the document with the tab', async () => {
    stubApi({ languages: { 'pl-PL': tree('stored-pl') } });
    renderPage({});

    await waitFor(() => expect(screen.getByRole('tab', { name: 'pl-PL' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'en-US' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'pl-PL' }));
    await waitFor(() => expect(screen.getByTestId('editor-language').textContent).toBe('pl-PL'));
    expect(screen.getByTestId('editor-data').textContent).toContain('stored-pl');
  });

  it('offers a language that only the stored content carries', async () => {
    stubApi({ languages: { 'de-DE': tree('stored-de') } });
    renderPage({});
    await waitFor(() => expect(screen.getByRole('tab', { name: 'de-DE' })).toBeTruthy());
  });

  it('saves the whole envelope: the edited language and every language it did not touch', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en'), 'pl-PL': tree('stored-pl') } });
    renderPage({});

    await waitFor(() => expect(screen.getByText('stub-edit')).toBeTruthy());
    fireEvent.click(screen.getByText('stub-edit'));
    fireEvent.click(screen.getByRole('button', { name: 'categoryContent.action.save' }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy).toHaveBeenCalledWith(`/api/v1/admin/catalog/categories/${CATEGORY_ID}/content`, {
      content: { languages: { 'en-US': tree('edited-en-US'), 'pl-PL': tree('stored-pl') } },
    });
    await waitFor(() => expect(screen.getByText('categoryContent.success.save')).toBeTruthy());
  });

  it('keeps an unsaved edit when the operator visits another language and comes back', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en'), 'pl-PL': tree('stored-pl') } });
    renderPage({});

    await waitFor(() => expect(screen.getByText('stub-edit')).toBeTruthy());
    fireEvent.click(screen.getByText('stub-edit'));
    fireEvent.click(screen.getByRole('tab', { name: 'pl-PL' }));
    await waitFor(() => expect(screen.getByTestId('editor-language').textContent).toBe('pl-PL'));
    fireEvent.click(screen.getByRole('tab', { name: 'en-US' }));

    await waitFor(() => expect(screen.getByTestId('editor-language').textContent).toBe('en-US'));
    expect(screen.getByTestId('editor-data').textContent).toContain('edited-en-US');
  });

  it('does not offer Save until something was edited', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({});

    await waitFor(() => expect(screen.getByText('stub-edit')).toBeTruthy());
    const save = screen.getByRole('button', { name: 'categoryContent.action.save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('stub-edit'));
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows no Save to an operator who may read the catalog and not write it', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({ permissions: ['catalog:read', 'cms.read'] });

    await waitFor(() => expect(screen.getByTestId('editor-stub')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'categoryContent.action.save' })).toBeNull();
    expect(screen.getByText('categoryContent.readOnly')).toBeTruthy();
  });

  it('explains itself, and offers no editor, when nothing contributes a Page Builder', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({ contributions: [] });

    await waitFor(() => expect(screen.getByText('categoryContent.noEditor.title')).toBeTruthy());
    expect(screen.queryByTestId('editor-stub')).toBeNull();
    expect(screen.queryByRole('button', { name: 'categoryContent.action.save' })).toBeNull();
  });

  it('treats a switched-off contributor exactly like a missing one', async () => {
    stubApi({ languages: { 'en-US': tree('stored-en') } });
    renderPage({ absent: ['cms'] });

    await waitFor(() => expect(screen.getByText('categoryContent.noEditor.title')).toBeTruthy());
    expect(screen.queryByTestId('editor-stub')).toBeNull();
  });

  it('reports a failed load instead of an empty editor', async () => {
    getSpy.mockRejectedValue(new Error('boom'));
    renderPage({});
    await waitFor(() => expect(screen.getByText('categoryContent.error.load')).toBeTruthy());
    expect(screen.queryByTestId('editor-stub')).toBeNull();
  });

  it('names no Page Builder owner in its own source', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/catalog/src/admin/pages/CategoryContentPage.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/mod-cms|module:\s*'cms'|@puckeditor/);
  });
});
