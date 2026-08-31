import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 062 (T031) — Admin API-keys page: typed scope catalog, distributor
 * binding section, expiry, and the binding/expiry list columns.
 *
 * The empty i18n bundle makes `t()` resolve to the `core.<key>` placeholder,
 * so assertions query by key rather than locale copy. Pickers and the API
 * client are mocked; the tests drive the form exactly like an operator would
 * and assert the B1–B5 inline validation mirrors plus the create payload.
 *
 * **Two seams moved with the screen** (feature 091, Phase 4, the plan's batch
 * 6). The component is `@endora-commerce/mod-api-keys`' now, so it is reached
 * through the **contribution** — the published seam an operator's browser also
 * takes — rather than through a path into `admin/src` that no longer exists; a
 * relative reach into the package's `src/` would evaluate its source beside its
 * `dist`, which is D-149's duplication and is silent in a frontend. And the
 * three pickers plus `apiClient` are the kit's, so the mocks key on
 * `@endora-commerce/admin-kit/{lib,components}` instead of on `@/`. `lib` is
 * spread over `vi.importActual` because the screen also takes `formatDateTime`
 * from it, and a bare factory would delete every binding it does not name.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const deleteSpy = vi.fn();

const customerPickerProps = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    ApiError: class MockApiError extends Error {
      envelope = { error: { message: 'mock' } };
    },
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<
    typeof import('@endora-commerce/admin-kit/components')
  >('@endora-commerce/admin-kit/components');
  return {
    ...actual,
    OrganizationPicker: (props: {
      value: string | null;
      onChange: (id: string | null) => void;
    }) => (
      <input
        aria-label="mock-org-picker"
        value={props.value ?? ''}
        onChange={(e): void => props.onChange(e.target.value === '' ? null : e.target.value)}
      />
    ),
    SalesChannelPicker: (props: {
      value: string | null;
      onChange: (id: string | null) => void;
    }) => (
      <input
        aria-label="mock-channel-picker"
        value={props.value ?? ''}
        onChange={(e): void => props.onChange(e.target.value === '' ? null : e.target.value)}
      />
    ),
    CustomerPicker: (props: {
      value: string | null;
      onChange: (id: string | null) => void;
      organizationId?: string;
      disabled?: boolean;
    }) => {
      customerPickerProps(props);
      return (
        <input
          aria-label="mock-customer-picker"
          disabled={props.disabled ?? false}
          value={props.value ?? ''}
          onChange={(e): void => props.onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    },
  };
});

/**
 * The screen, taken from the module's own contribution — the route declaration
 * is what the admin renders, so loading its factory is the same code path an
 * operator's browser takes.
 */
const { contributions } = await import('@endora-commerce/mod-api-keys/admin');
const ApiKeysPage = (await contributions.routes![0]!.component())
  .default as () => ReactNode;

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

function boundKey(): Record<string, unknown> {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Distributor ACME',
    lastFour: 'ab12',
    scopes: ['catalog:read', 'orders:write'],
    status: 'active',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    organizationId: ORG_ID,
    salesChannelId: CHANNEL_ID,
    customerAccountId: ACCOUNT_ID,
    expiresAt: '2027-01-01T00:00:00.000Z',
  };
}

function unboundKey(): Record<string, unknown> {
  return {
    ...boundKey(),
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'PIM sync',
    scopes: ['catalog:write'],
    organizationId: null,
    salesChannelId: null,
    customerAccountId: null,
    expiresAt: null,
  };
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  deleteSpy.mockReset();
  customerPickerProps.mockClear();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/api-keys') return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/organizations/')) {
      return Promise.resolve({ data: { name: 'ACME Sp. z o.o.' } });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('ApiKeysPage — typed scope catalog (T031)', () => {
  it('renders exactly the contract scope enum, without integrations:manage', async () => {
    renderWithI18n(<ApiKeysPage />, {});
    await screen.findByText('core.apiKeys.create.title');

    for (const scope of ['catalog:read', 'catalog:write', 'orders:read', 'orders:write']) {
      expect(screen.getByText(scope)).toBeInTheDocument();
    }
    expect(screen.queryByText('integrations:manage')).not.toBeInTheDocument();
    // The two-key-modes helper text is present.
    expect(screen.getByText('core.apiKeys.create.modesHelp')).toBeInTheDocument();
  });
});

describe('ApiKeysPage — binding validation mirrors (B1–B5)', () => {
  it('B1: an orders scope requires a complete binding before submit', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ApiKeysPage />, {});
    await screen.findByText('core.apiKeys.create.title');

    await user.type(screen.getByLabelText('core.apiKeys.create.nameLabel'), 'Distributor');
    await user.click(screen.getByRole('checkbox', { name: 'orders:write' }));

    expect(screen.getByText('core.apiKeys.validation.bindingRequiredForOrders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'core.apiKeys.create.submit' })).toBeDisabled();

    await user.type(screen.getByLabelText('mock-org-picker'), ORG_ID);
    await user.type(screen.getByLabelText('mock-channel-picker'), CHANNEL_ID);
    await user.type(screen.getByLabelText('mock-customer-picker'), ACCOUNT_ID);

    expect(
      screen.queryByText('core.apiKeys.validation.bindingRequiredForOrders'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'core.apiKeys.create.submit' })).toBeEnabled();
  });

  it('B2: catalog:write is refused on a bound key', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ApiKeysPage />, {});
    await screen.findByText('core.apiKeys.create.title');

    await user.type(screen.getByLabelText('core.apiKeys.create.nameLabel'), 'Bad combo');
    await user.click(screen.getByRole('checkbox', { name: 'catalog:write' }));
    await user.type(screen.getByLabelText('mock-org-picker'), ORG_ID);

    expect(screen.getByText('core.apiKeys.validation.catalogWriteBound')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'core.apiKeys.create.submit' })).toBeDisabled();
  });

  it('partial binding (all-or-none) blocks submit', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ApiKeysPage />, {});
    await screen.findByText('core.apiKeys.create.title');

    await user.type(screen.getByLabelText('core.apiKeys.create.nameLabel'), 'Partial');
    await user.click(screen.getByRole('checkbox', { name: 'catalog:read' }));
    await user.type(screen.getByLabelText('mock-org-picker'), ORG_ID);

    expect(screen.getByText('core.apiKeys.validation.bindingIncomplete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'core.apiKeys.create.submit' })).toBeDisabled();
  });

  it('B5: a past expiry is refused inline', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ApiKeysPage />, {});
    await screen.findByText('core.apiKeys.create.title');

    await user.type(screen.getByLabelText('core.apiKeys.create.nameLabel'), 'Expired');
    await user.click(screen.getByRole('checkbox', { name: 'catalog:read' }));
    const expiry = screen.getByLabelText('core.apiKeys.create.expiresLabel');
    await user.type(expiry, '2020-01-01T00:00');

    expect(screen.getByText('core.apiKeys.validation.expiryFuture')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'core.apiKeys.create.submit' })).toBeDisabled();
  });
});

describe('ApiKeysPage — create payload + service-account org filter (B3)', () => {
  it('filters the customer picker by the chosen organization and posts binding + expiry', async () => {
    postSpy.mockResolvedValue({
      data: { apiKey: boundKey(), bearerToken: 'sk_live_test_token' },
    });
    const user = userEvent.setup();
    renderWithI18n(<ApiKeysPage />, {});
    await screen.findByText('core.apiKeys.create.title');

    // Service-account picker is disabled until an organization is chosen.
    expect(screen.getByLabelText('mock-customer-picker')).toBeDisabled();

    await user.type(screen.getByLabelText('core.apiKeys.create.nameLabel'), 'Distributor ACME');
    await user.click(screen.getByRole('checkbox', { name: 'catalog:read' }));
    await user.click(screen.getByRole('checkbox', { name: 'orders:write' }));
    await user.type(screen.getByLabelText('mock-org-picker'), ORG_ID);

    // B3 by construction: the picker only searches within the bound org.
    await waitFor(() => {
      expect(customerPickerProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ organizationId: ORG_ID, disabled: false }),
      );
    });

    await user.type(screen.getByLabelText('mock-channel-picker'), CHANNEL_ID);
    await user.type(screen.getByLabelText('mock-customer-picker'), ACCOUNT_ID);
    await user.type(screen.getByLabelText('core.apiKeys.create.expiresLabel'), '2030-06-15T12:00');

    await user.click(screen.getByRole('button', { name: 'core.apiKeys.create.submit' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [path, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/v1/admin/api-keys');
    expect(body).toEqual({
      name: 'Distributor ACME',
      scopes: ['catalog:read', 'orders:write'],
      binding: {
        organizationId: ORG_ID,
        salesChannelId: CHANNEL_ID,
        customerAccountId: ACCOUNT_ID,
      },
      expiresAt: new Date('2030-06-15T12:00').toISOString(),
    });

    // Token revealed once.
    expect(await screen.findByDisplayValue('sk_live_test_token')).toBeInTheDocument();
  });

  it('creates a legacy unbound key without binding or expiry fields', async () => {
    postSpy.mockResolvedValue({
      data: { apiKey: unboundKey(), bearerToken: 'sk_live_unbound' },
    });
    const user = userEvent.setup();
    renderWithI18n(<ApiKeysPage />, {});
    await screen.findByText('core.apiKeys.create.title');

    await user.type(screen.getByLabelText('core.apiKeys.create.nameLabel'), 'PIM sync');
    await user.click(screen.getByRole('checkbox', { name: 'catalog:write' }));
    await user.click(screen.getByRole('button', { name: 'core.apiKeys.create.submit' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toEqual({ name: 'PIM sync', scopes: ['catalog:write'] });
  });
});

describe('ApiKeysPage — binding + expiry list columns', () => {
  it('shows the bound organization and expiry, and marks unbound keys', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/api-keys') {
        return Promise.resolve({ data: [boundKey(), unboundKey()] });
      }
      if (path.startsWith('/api/v1/admin/organizations/')) {
        return Promise.resolve({ data: { name: 'ACME Sp. z o.o.' } });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });

    renderWithI18n(<ApiKeysPage />, {});

    expect(await screen.findByText('core.apiKeys.column.binding')).toBeInTheDocument();
    expect(screen.getByText('core.apiKeys.column.expires')).toBeInTheDocument();
    // Bound row: best-effort org-name resolution.
    expect(await screen.findByText('ACME Sp. z o.o.')).toBeInTheDocument();
    // Unbound row: explicit unbound marker.
    expect(screen.getByText('core.apiKeys.binding.unbound')).toBeInTheDocument();
  });
});
