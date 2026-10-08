import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * The category tree's way into the category content screen.
 *
 * Every row offers **Content**, a link to `/catalog/categories/:id/content` —
 * but only while something contributes an editor to that screen (Z15: counted,
 * not named). Offering it on a platform with no Page Builder would send the
 * operator to a screen whose only content is the sentence saying there is no
 * editor.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { CategoriesTree } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/CategoriesTree'
);

const CATEGORY_ID = '33333333-3333-4333-8333-333333333303';

const BUNDLE = passthroughBundle('catalog', [
  'categories.page.title',
  'categories.action.edit',
  'categories.action.content',
]);

const EDITOR_CONTRIBUTION = {
  moduleId: 'cms',
  contributions: {
    zones: [
      {
        zone: 'category.content.editor' as const,
        weight: 100,
        requiredPermission: 'cms.read',
        component: async () => ({ default: ((): null => null) as never }),
      },
    ],
  },
};

function renderTree(contributions: readonly (typeof EDITOR_CONTRIBUTION)[]): void {
  renderWithSession(
    <MemoryRouter initialEntries={['/catalog/categories']}>
      <CategoriesTree />
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions,
      bundle: BUNDLE,
    },
  );
}

describe('CategoriesTree — the Content link', () => {
  beforeEach(() => {
    getSpy.mockReset();
    getSpy.mockResolvedValue({
      data: [
        {
          id: CATEGORY_ID,
          parentCategoryId: null,
          name: { 'en-US': 'Hand tools' },
          slug: 'hand-tools',
          sortOrder: 0,
          isActive: true,
        },
      ],
    });
  });

  it('links each row to its content screen when an editor is contributed', async () => {
    renderTree([EDITOR_CONTRIBUTION]);
    const link = await waitFor(() =>
      screen.getByRole('link', { name: 'categories.action.content' }),
    );
    expect(link.getAttribute('href')).toBe(`/catalog/categories/${CATEGORY_ID}/content`);
  });

  it('offers no link when nothing contributes an editor', async () => {
    renderTree([]);
    // The row has to have rendered, or the absence proves nothing.
    await waitFor(() => expect(screen.getByText('Hand tools')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'categories.action.content' })).toBeNull();
  });
});
