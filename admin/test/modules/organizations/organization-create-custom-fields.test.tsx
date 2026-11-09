import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrganizationSalesChannelOptionsResponse } from '@endora-commerce/contracts';
import { adminSession, renderWithSession } from '../../helpers/render-with-session';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-018, FR-039,
 * contracts/admin-panel-and-check.md §3) — *New organization* embeds the
 * Organization's custom fields: the panel renders (its definitions are
 * `custom_fields:read`'s), its bag travels as `customFieldValues` in the create
 * request, and a `422 CUSTOM_FIELD_VALUE_INVALID` is said at the field it names.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrganizationCreate } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationCreate'
);
const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
);

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/organizations/i18n/en.json');
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const bundle = { organizations: en, core: coreEn };

const RETAIL = '00000000-0000-4000-8000-00000000c001';
const OPTIONS: OrganizationSalesChannelOptionsResponse = {
  data: [{ id: RETAIL, code: 'retail', name: { 'en-US': 'Retail' }, active: true, systemDefault: true }],
};
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=organization';
const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d175',
  entityType: 'organization',
  key: 'account_manager',
  label: { en: 'Account manager' },
  labelDefault: 'Account manager',
  valueType: 'text',
  required: true,
  audience: 'internal',
  sortOrder: 0,
  config: {},
  options: [],
  customerInput: [],
  adminAccess: 'edit',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderCreate(permissions: readonly string[] = ['customers:manage', 'custom_fields:read']) {
  return renderWithSession(
    <MemoryRouter initialEntries={['/organizations/new']}>
      <Routes>
        <Route path="/organizations/new" element={<OrganizationCreate />} />
        <Route path="/organizations/:id" element={<p>detail page</p>} />
      </Routes>
    </MemoryRouter>,
    { session: adminSession({ permissions }), bundle },
  );
}

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function fillRequired(): Promise<void> {
  await waitFor(() => screen.getByRole('checkbox', { name: /Retail/ }));
  fill(en['create.field.name']!, 'Acme Trade');
  fill(en['create.field.taxId']!, 'PL5260001246');
  fill(en['create.field.street']!, 'ul. Prosta 1');
  fill(en['create.field.postalCode']!, '00-001');
  fill(en['create.field.city']!, 'Warszawa');
  fill(en['create.field.country']!, 'pl');
}

beforeEach(() => {
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/organizations/sales-channel-options') return OPTIONS;
    if (url === DEFINITIONS_URL) return { data: [DEFINITION] };
    throw new Error(`unexpected request: ${url}`);
  });
  postSpy.mockReset();
});

describe('OrganizationCreate — custom fields (feature 175)', () => {
  it('renders the Organization custom fields and sends their bag with the create', async () => {
    postSpy.mockResolvedValue({ data: { id: '00000000-0000-4000-8000-00000000d001' } });
    renderCreate();
    await fillRequired();
    fill('Account manager *', 'Ada');
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({ customFieldValues: { account_manager: 'Ada' } });
  });

  it('says a refusal at the field it names', async () => {
    postSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_VALUE_INVALID',
          message: 'One or more custom fields are invalid.',
          requestId: 'r',
          details: [{ path: 'account_manager', issue: 'Field "account_manager" is required.' }],
        },
      } as never),
    );
    renderCreate();
    await fillRequired();
    await screen.findByLabelText('Account manager *');
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));

    const input = await screen.findByLabelText('Account manager *');
    await waitFor(() => expect(screen.getByText('Field "account_manager" is required.')).toBeTruthy());
    expect(input.parentElement).toContainElement(screen.getByText('Field "account_manager" is required.'));
    expect(screen.queryByText('detail page')).toBeNull();
  });

  it('neither asks for the definitions nor shows the panel without custom_fields:read', async () => {
    postSpy.mockResolvedValue({ data: { id: '00000000-0000-4000-8000-00000000d001' } });
    renderCreate(['customers:manage']);
    await fillRequired();
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(DEFINITIONS_URL);
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).not.toHaveProperty('customFieldValues');
  });
});
