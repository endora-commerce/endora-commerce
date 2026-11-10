import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-016, FR-039,
 * contracts/admin-panel-and-check.md §3) — the category tree's create and edit
 * forms embed the category's custom fields: the panel renders (its definitions
 * are `custom_fields:read`'s), the create sends its bag as `customFieldValues`
 * in `POST …/categories`, the edit sends it in the same `PATCH …/categories/:id`
 * as the rest of the form, and a `422 CUSTOM_FIELD_VALUE_INVALID` is said at the
 * field it names with the typed form kept open.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { CategoriesTree } = await import('../../../../packages/modules/catalog/src/admin/pages/CategoriesTree');
const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
);

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/catalog/i18n/en.json');
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const bundle = { catalog: en, core: coreEn };

const ROOT = '33333333-3333-4333-8333-333333333301';
const CATEGORIES_URL = '/api/v1/admin/catalog/categories';
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=category';
const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000c175',
  entityType: 'category',
  key: 'merch_note',
  label: { en: 'Merchandising note' },
  labelDefault: 'Merchandising note',
  valueType: 'text',
  required: false,
  audience: 'internal',
  sortOrder: 0,
  config: {},
  options: [],
  customerInput: [],
  adminAccess: 'edit',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderTree(permissions: readonly string[] = ['catalog:read', 'catalog:write', 'custom_fields:read']): void {
  renderWithSession(
    <MemoryRouter initialEntries={['/catalog/categories']}>
      <CategoriesTree />
    </MemoryRouter>,
    {
      session: adminSession({ permissions }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions: [],
      bundle,
    },
  );
}

async function openCreate(): Promise<void> {
  await screen.findByText('Furniture');
  fireEvent.click(screen.getByRole('button', { name: en['categories.action.newRoot']! }));
  fireEvent.change(screen.getByLabelText(en['categories.field.slug']!), { target: { value: 'lamps' } });
}

beforeEach(() => {
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url === CATEGORIES_URL) {
      return {
        data: [
          {
            id: ROOT,
            parentCategoryId: null,
            name: { 'en-US': 'Furniture' },
            slug: 'furniture',
            sortOrder: 0,
            isActive: true,
            customFieldValues: { merch_note: 'Bestseller' },
          },
        ],
      };
    }
    if (url === DEFINITIONS_URL) return { data: [DEFINITION] };
    throw new Error(`unexpected request: ${url}`);
  });
  postSpy.mockReset();
  patchSpy.mockReset();
});

describe('CategoriesTree — custom fields (feature 175)', () => {
  it('create: renders the category custom fields and sends their bag with the create', async () => {
    postSpy.mockResolvedValue({ data: { id: '00000000-0000-4000-8000-00000000c001' } });
    renderTree();
    await openCreate();
    fireEvent.change(await screen.findByLabelText('Merchandising note'), { target: { value: 'New in' } });
    fireEvent.click(screen.getByRole('button', { name: en['categories.action.create']! }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[0]).toBe(CATEGORIES_URL);
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({ slug: 'lamps', customFieldValues: { merch_note: 'New in' } });
  });

  it('create: says a refusal at the field it names and keeps the form open', async () => {
    postSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_VALUE_INVALID',
          message: 'One or more custom fields are invalid.',
          requestId: 'r',
          details: [{ path: 'merch_note', issue: 'Field "merch_note" is required.' }],
        },
      } as never),
    );
    renderTree();
    await openCreate();
    const input = await screen.findByLabelText('Merchandising note');
    fireEvent.click(screen.getByRole('button', { name: en['categories.action.create']! }));

    await waitFor(() => expect(screen.getByText('Field "merch_note" is required.')).toBeTruthy());
    expect(input.parentElement).toContainElement(screen.getByText('Field "merch_note" is required.'));
    expect((screen.getByLabelText(en['categories.field.slug']!) as HTMLInputElement).value).toBe('lamps');
  });

  it('edit: shows the stored values and sends the edited bag in the category PATCH', async () => {
    patchSpy.mockResolvedValue({ data: { id: ROOT } });
    renderTree();
    await screen.findByText('Furniture');
    fireEvent.click(screen.getByRole('button', { name: en['categories.action.edit']! }));
    const input = (await screen.findByLabelText('Merchandising note')) as HTMLInputElement;
    expect(input.value).toBe('Bestseller');
    fireEvent.change(input, { target: { value: 'Clearance' } });
    const form = input.closest('form') as HTMLFormElement;
    fireEvent.click(within(form).getByRole('button', { name: en['categories.action.save']! }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[0]).toBe(`${CATEGORIES_URL}/${ROOT}`);
    expect(patchSpy.mock.calls[0]?.[1]).toMatchObject({ slug: 'furniture', customFieldValues: { merch_note: 'Clearance' } });
  });

  it('neither asks for the definitions nor sends values without custom_fields:read', async () => {
    postSpy.mockResolvedValue({ data: { id: '00000000-0000-4000-8000-00000000c001' } });
    renderTree(['catalog:read', 'catalog:write']);
    await openCreate();
    fireEvent.click(screen.getByRole('button', { name: en['categories.action.create']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(DEFINITIONS_URL);
    expect(postSpy.mock.calls[0]?.[1]).not.toHaveProperty('customFieldValues');
  });
});
