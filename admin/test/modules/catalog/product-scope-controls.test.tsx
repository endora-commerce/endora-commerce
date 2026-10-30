import { StrictMode, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { ProductScopes } from '@endora-commerce/contracts';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 / T087 (US1–US3, US10; FR-012, FR-013, FR-023, FR-030, FR-040, FR-042, FR-100) —
 * the product editor's scope controls: status per channel and channel × language with
 * "use inherited", the publication window and the audience rule per channel, and the
 * order rules (minimum, returnable) per channel. Every write goes through
 * `PATCH /api/v1/admin/catalog/products/:id/scopes` with only the keys that changed.
 *
 * Rendered inside `<StrictMode>` with the catalogue's real `en` and `pl` bundles, so a key
 * missing in either file fails here rather than in production.
 *
 * The process time zone is pinned to UTC+1 (`Etc/GMT-1` — POSIX inverts the sign) for the
 * whole file: `datetime-local` shows and reads the operator's local time (FR-023), so a
 * window assertion means something only under a known zone.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(() => Promise.resolve({})),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { ProductScopeControls } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductScopeControls'
);
const { ProductOrderRulesCard } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductOrderRulesCard'
);
const { isoToLocalInput, localInputToIso } = await import(
  '../../../../packages/modules/catalog/src/admin/lib/product-scope-drafts'
);

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const ORG_W = '00000000-0000-4000-8000-00000000e001';
const PRODUCT_PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;
const SCOPES_PATH = `${PRODUCT_PATH}/scopes`;
const CONTEXT_PATH = `${PRODUCT_PATH}/scope-context`;

const CHANNELS = [
  { id: B2B, code: 'b2b', name: 'B2B', languages: ['de', 'en'], isDefault: true },
  { id: B2C, code: 'b2c', name: 'B2C', languages: ['pl'], isDefault: false },
];

function scopesFixture(): ProductScopes {
  return {
    global: {
      status: 'active',
      publishFrom: null,
      publishUntil: null,
      visibility: 'public',
      allowedOrganizationIds: [],
      minOrderQuantity: 10,
      returnable: true,
    },
    channels: [
      {
        channelId: B2B,
        isMember: true,
        languages: ['de', 'en'],
        status: null,
        window: null,
        audience: null,
        minOrderQuantity: null,
        returnable: null,
        languageStatuses: [
          { languageCode: 'de', status: 'inactive', orphaned: false },
          { languageCode: 'fr', status: 'inactive', orphaned: true },
        ],
        orphaned: false,
      },
      {
        channelId: B2C,
        isMember: true,
        languages: ['pl'],
        status: 'inactive',
        window: { from: '2026-12-01T07:00:00.000Z', until: null },
        audience: {
          visibility: 'organization_restricted',
          allowedOrganizationIds: [ORG_W],
          nonMemberOrganizationIds: [ORG_W],
        },
        minOrderQuantity: 1,
        returnable: false,
        languageStatuses: [],
        orphaned: false,
      },
    ],
    // Owner decision U1 — the names come with the scopes answer.
    organizations: [{ id: ORG_W, name: 'Westfield Ltd' }],
  };
}

function primeGets(scopes: ProductScopes = scopesFixture()): void {
  getSpy.mockImplementation((path: string) => {
    if (path === SCOPES_PATH) return Promise.resolve({ data: scopes });
    if (path === CONTEXT_PATH) {
      return Promise.resolve({
        data: {
          productId: PRODUCT_ID,
          channels: CHANNELS,
          languagesUnion: ['de', 'en', 'pl'],
          primaryAdminLanguage: 'en',
          preference: null,
        },
      });
    }
    if (path === PRODUCT_PATH) {
      return Promise.resolve({
        data: { id: PRODUCT_ID, type: 'simple', minOrderQuantity: 10, returnable: true },
      });
    }
    if (path.startsWith('/api/v1/admin/organizations')) {
      return Promise.resolve({ data: [], pagination: { cursor: null, hasMore: false, limit: 20 } });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function patchAnswers(scopes: ProductScopes, warnings: unknown[] = []): void {
  patchSpy.mockResolvedValue({ data: scopes, warnings });
}

function wrap(
  ui: ReactElement,
  options: { permissions?: readonly string[]; language?: 'en' | 'pl' } = {},
): ReactElement {
  const language = options.language ?? 'en';
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <TranslationProvider language={language} initialBundle={{ catalog }}>
        {withSession(ui, {
          session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
        })}
      </TranslationProvider>
    </StrictMode>
  );
}

function controls(activeChannelId: string | null, globalStatus?: 'active' | 'inactive'): ReactElement {
  return (
    <ProductScopeControls
      productId={PRODUCT_ID}
      channels={CHANNELS}
      activeChannelId={activeChannelId}
      {...(globalStatus ? { globalStatus } : {})}
    />
  );
}

let previousTz: string | undefined;
beforeAll(() => {
  previousTz = process.env.TZ;
  process.env.TZ = 'Etc/GMT-1';
});
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  primeGets();
});
afterEach(() => vi.clearAllMocks());

describe('local time ↔ ISO for datetime-local (FR-023, US2 #4)', () => {
  it('an operator at UTC+1 entering 08:00 stores 07:00 UTC; one at UTC+2 sees 09:00', () => {
    process.env.TZ = 'Etc/GMT-1';
    expect(localInputToIso('2026-12-01T08:00')).toEqual({ ok: true, value: '2026-12-01T07:00:00.000Z' });
    process.env.TZ = 'Etc/GMT-2';
    expect(isoToLocalInput('2026-12-01T07:00:00.000Z')).toBe('2026-12-01T09:00');
    process.env.TZ = 'Etc/GMT-1';
    expect(isoToLocalInput('2026-12-01T07:00:00.000Z')).toBe('2026-12-01T08:00');
  });

  it('reads an empty field as an open side and refuses a malformed one', () => {
    expect(localInputToIso('')).toEqual({ ok: true, value: null });
    expect(localInputToIso('  ')).toEqual({ ok: true, value: null });
    expect(localInputToIso('1 December')).toEqual({ ok: false });
    expect(isoToLocalInput(null)).toBe('');
  });
});

describe('ProductScopeControls — status per channel and channel × language (US1, FR-012, FR-040)', () => {
  it('asks for a channel when Global is selected and renders no control', async () => {
    render(wrap(controls(null)));
    expect(
      await screen.findByText(
        'Choose a sales channel above to set its status, publication window and audience.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows the inherited channel status and its source, and saves an override as the only key', async () => {
    patchAnswers(scopesFixture());
    render(wrap(controls(B2B)));
    const user = userEvent.setup();

    const channelStatus = await screen.findByRole('combobox', { name: 'Status in B2B' });
    expect(channelStatus).toHaveValue('');
    expect(within(channelStatus).getByRole('option', { name: 'Use inherited (Active)' })).toBeInTheDocument();
    // The source (FR-040) is the select's description, so it is read with the value.
    expect(channelStatus).toHaveAccessibleDescription('Inherited from global: Active');

    await user.selectOptions(channelStatus, 'inactive');
    expect(channelStatus).toHaveAccessibleDescription('Set for this channel');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(SCOPES_PATH, {
      channels: [{ channelId: B2B, status: 'inactive' }],
    });
    await screen.findByText('Channel availability saved.');
  });

  it('lists every channel language; "use inherited" on an override sends null for that language only', async () => {
    patchAnswers(scopesFixture());
    render(wrap(controls(B2B)));
    const user = userEvent.setup();

    const de = await screen.findByRole('combobox', { name: 'Status in B2B · DE' });
    const en = screen.getByRole('combobox', { name: 'Status in B2B · EN' });
    expect(de).toHaveValue('inactive');
    expect(de).toHaveAccessibleDescription('Set for this language');
    expect(en).toHaveValue('');
    // The language row inherits from the channel row, which inherits from global.
    expect(within(en).getByRole('option', { name: 'Use inherited (Active)' })).toBeInTheDocument();

    await user.selectOptions(de, '');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(SCOPES_PATH, {
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'de', status: null }] }],
    });
  });

  it('offers Active and Inactive only, plus "use inherited" — no Draft at any scope (FR-010)', async () => {
    render(wrap(controls(B2B)));
    const channel = await screen.findByRole('combobox', { name: 'Status in B2B' });
    const language = screen.getByRole('combobox', { name: 'Status in B2B · DE' });
    for (const select of [channel, language]) {
      expect(within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual([
        '',
        'active',
        'inactive',
      ]);
    }
    expect(document.body.textContent).not.toMatch(/draft/i);
  });

  it('shows the channel row as the source of an inheriting language once the channel is overridden', async () => {
    render(wrap(controls(B2B)));
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status in B2B' }), 'inactive');
    const en = screen.getByRole('combobox', { name: 'Status in B2B · EN' });
    expect(within(en).getByRole('option', { name: 'Use inherited (Inactive)' })).toBeInTheDocument();
    expect(en).toHaveAccessibleDescription('Inherited from B2B: Inactive');
  });

  it('marks an orphaned language setting as ignored and removes it with null (FR-015)', async () => {
    patchAnswers(scopesFixture());
    render(wrap(controls(B2B)));
    const user = userEvent.setup();

    expect(
      await screen.findByText('FR is no longer offered by this channel, so this setting is ignored.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove FR setting' }));
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(SCOPES_PATH, {
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'fr', status: null }] }],
    });
  });

  it('keeps an unsaved edit when the operator switches channel and back, and saves both channels in one request', async () => {
    patchAnswers(scopesFixture());
    const { rerender } = render(wrap(controls(B2B)));
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status in B2B' }), 'inactive');
    rerender(wrap(controls(B2C)));
    expect(await screen.findByText('Unsaved changes in: B2B')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status in B2C' }), 'active');
    rerender(wrap(controls(B2B)));
    expect(screen.getByRole('combobox', { name: 'Status in B2B' })).toHaveValue('inactive');

    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(SCOPES_PATH, {
      channels: [
        { channelId: B2B, status: 'inactive' },
        { channelId: B2C, status: 'active' },
      ],
    });
  });

  it('never warns about overrides when the global status changes (FR-013, A-9)', async () => {
    const { rerender } = render(wrap(controls(B2C, 'active')));
    await screen.findByRole('combobox', { name: 'Status in B2C' });
    const confirmSpy = vi.spyOn(window, 'confirm');

    rerender(wrap(controls(B2C, 'inactive')));
    // The B2C override is untouched and nothing asks about it.
    expect(screen.getByRole('combobox', { name: 'Status in B2C' })).toHaveValue('inactive');
    const pl = screen.getByRole('combobox', { name: 'Status in B2C · PL' });
    expect(within(pl).getByRole('option', { name: 'Use inherited (Inactive)' })).toBeInTheDocument();
    expect(screen.queryByText(/override/i)).toBeNull();
    // The only alert on screen is the audience warning the fixture carries (US3 #4).
    for (const alert of screen.queryAllByRole('alert')) {
      expect(alert.textContent ?? '').not.toMatch(/override/i);
    }
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(patchSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('ProductScopeControls — publication window per channel (US2, FR-023)', () => {
  it('shows an overriding window in local time', async () => {
    render(wrap(controls(B2C)));
    const override = await screen.findByRole('checkbox', { name: 'Set a window for this channel' });
    expect(override).toBeChecked();
    expect(screen.getByLabelText('Live from')).toHaveValue('2026-12-01T08:00');
    expect(screen.getByLabelText('Live until')).toHaveValue('');
  });

  it('sends a new channel window as ISO instants, the empty side open', async () => {
    patchAnswers(scopesFixture());
    render(wrap(controls(B2B)));
    const user = userEvent.setup();

    expect(await screen.findByText('Inherited from global: always live')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Set a window for this channel' }));
    fireEvent.change(screen.getByLabelText('Live until'), { target: { value: '2026-12-31T23:59' } });
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(SCOPES_PATH, {
      channels: [{ channelId: B2B, window: { from: null, until: '2026-12-31T22:59:00.000Z' } }],
    });
  });

  it('refuses a window that does not start before it ends, inline and without a request', async () => {
    render(wrap(controls(B2C)));
    const user = userEvent.setup();
    const until = await screen.findByLabelText('Live until');
    fireEvent.change(until, { target: { value: '2026-11-30T08:00' } });
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    const message = await screen.findByText('The start must be before the end.');
    expect(until).toHaveAttribute('aria-invalid', 'true');
    expect(until.getAttribute('aria-describedby')).toContain(message.id);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('"use inherited" removes the channel window with null', async () => {
    patchAnswers(scopesFixture());
    render(wrap(controls(B2C)));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Set a window for this channel' }));
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(SCOPES_PATH, { channels: [{ channelId: B2C, window: null }] });
  });
});

describe('ProductScopeControls — audience per channel (US3, FR-030)', () => {
  it('names the organizations that are not members of the channel (US3 #4)', async () => {
    render(wrap(controls(B2C)));
    expect(
      await screen.findByText(
        'Not members of B2C, so they will not see the product there: Westfield Ltd',
      ),
    ).toBeInTheDocument();
  });

  it('takes the names from the scopes answer and reads no organization itself (U1)', async () => {
    const scopes = scopesFixture();
    // An organization the answer could not name (deleted, unreadable) shows its short id.
    scopes.organizations = [];
    primeGets(scopes);
    render(wrap(controls(B2C)));
    expect(
      await screen.findByText(`Not members of B2C, so they will not see the product there: ${ORG_W.slice(0, 8)}`),
    ).toBeInTheDocument();
    const organizationReads = getSpy.mock.calls.filter(([path]) =>
      String(path).startsWith(`/api/v1/admin/organizations/${ORG_W}`),
    );
    expect(organizationReads).toEqual([]);
  });

  it('sends the whole rule as one value, with an empty list unless organization-restricted', async () => {
    patchAnswers(scopesFixture());
    render(wrap(controls(B2B)));
    const user = userEvent.setup();

    expect(await screen.findByText('Inherited from global: Everyone')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Set an audience for this channel' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Who can see it' }), 'logged_in_only');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(SCOPES_PATH, {
      channels: [{ channelId: B2B, audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] } }],
    });
  });

  it('offers the organization picker only for organization-restricted', async () => {
    render(wrap(controls(B2B)));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Set an audience for this channel' }));
    expect(screen.queryByRole('combobox', { name: 'Add organizations' })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Who can see it' }), 'organization_restricted');
    expect(screen.getByRole('combobox', { name: 'Add organizations' })).toBeInTheDocument();
  });

  it('shows the non-member warning the save answers with', async () => {
    const saved = scopesFixture();
    saved.channels[0]!.audience = {
      visibility: 'organization_restricted',
      allowedOrganizationIds: [ORG_W],
      nonMemberOrganizationIds: [ORG_W],
    };
    patchAnswers(saved, [{ kind: 'audience_non_members', channelId: B2B, organizationIds: [ORG_W] }]);
    render(wrap(controls(B2B)));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Set an audience for this channel' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Who can see it' }), 'logged_in_only');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));
    expect(
      await screen.findByText('Not members of B2B, so they will not see the product there: Westfield Ltd'),
    ).toBeInTheDocument();
  });
});

describe('ProductScopeControls — refusals and permissions', () => {
  it('translates a scope refusal, shows no error code and keeps the edit', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'SCOPE_INVALID',
          message: 'Product is not a member of the channel.',
          details: { channelId: B2B, reason: 'not_a_member' },
        },
      }),
    );
    render(wrap(controls(B2B)));
    const user = userEvent.setup();
    const status = await screen.findByRole('combobox', { name: 'Status in B2B' });
    await user.selectOptions(status, 'inactive');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    expect(
      await screen.findByText('The product is no longer in B2B. Reload the page to see its current channels.'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('SCOPE_INVALID');
    expect(status).toHaveValue('inactive');
  });

  it('translates a concurrent-write conflict and keeps the edit', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'VERSION_CONFLICT', message: 'Concurrent scope write.' },
      }),
    );
    render(wrap(controls(B2B)));
    const user = userEvent.setup();
    const status = await screen.findByRole('combobox', { name: 'Status in B2B' });
    await user.selectOptions(status, 'inactive');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    expect(
      await screen.findByText(
        'Someone else changed this product’s availability at the same time. Reload the page and apply your change again.',
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('VERSION_CONFLICT');
    expect(status).toHaveValue('inactive');
  });

  it('translates a repeated language refusal with the channel and language', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Language named twice.',
          details: { field: 'languageStatuses', channelId: B2B, languageCode: 'de' },
        },
      }),
    );
    render(wrap(controls(B2B)));
    const user = userEvent.setup();
    const de = await screen.findByRole('combobox', { name: 'Status in B2B · DE' });
    await user.selectOptions(de, 'active');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    expect(
      await screen.findByText('DE is set more than once for B2B. Reload the page and try again.'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('VALIDATION_FAILED');
  });

  it('explains a completeness refusal per channel and language, and saves nothing', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'SCOPE_INCOMPLETE',
          message: 'Missing values.',
          details: { pairs: [{ channelId: B2B, languageCode: 'de', missing: ['name', 'urlKey'] }] },
        },
      }),
    );
    render(wrap(controls(B2B)));
    const user = userEvent.setup();
    const de = await screen.findByRole('combobox', { name: 'Status in B2B · DE' });
    await user.selectOptions(de, 'active');
    await user.click(screen.getByRole('button', { name: 'Save availability' }));

    expect(
      await screen.findByText(
        'Not saved: the product cannot be switched on where values are missing. B2B · DE: name, URL key',
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('SCOPE_INCOMPLETE');
    expect(de).toHaveValue('active');
  });

  it('is read-only without catalog:write (FR-042)', async () => {
    render(wrap(controls(B2C), { permissions: ['catalog:read'] }));
    expect(await screen.findByRole('combobox', { name: 'Status in B2C' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Status in B2C · PL' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Set a window for this channel' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Set an audience for this channel' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save availability' })).toBeNull();
    expect(
      screen.getByText('You can view these settings. Changing them needs the permission to edit products.'),
    ).toBeInTheDocument();
  });

  it('shows a retry when the scopes cannot be loaded', async () => {
    getSpy.mockImplementation((path: string) =>
      path === SCOPES_PATH ? Promise.reject(new Error('down')) : Promise.resolve({ data: [] }),
    );
    render(wrap(controls(B2B)));
    expect(await screen.findByText('Could not load the channel availability.')).toBeInTheDocument();
    primeGets();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('combobox', { name: 'Status in B2B' })).toBeInTheDocument();
  });

  it('renders its labels in Polish', async () => {
    render(wrap(controls(B2B), { language: 'pl' }));
    expect(await screen.findByRole('combobox', { name: 'Status w B2B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapisz dostępność' })).toBeInTheDocument();
  });
});

describe('ProductOrderRulesCard — minimum and returnable per channel (US10, FR-100)', () => {
  function card(type = 'simple', permissions?: readonly string[]): ReactElement {
    return wrap(<ProductOrderRulesCard productId={PRODUCT_ID} productType={type} />, {
      ...(permissions ? { permissions } : {}),
    });
  }

  it('lists the member channels with their overrides and the inherited values', async () => {
    render(card());
    const b2bMinimum = await screen.findByRole('spinbutton', { name: 'Minimum order quantity in B2B' });
    expect(b2bMinimum).toHaveValue(null);
    expect(b2bMinimum).toHaveAttribute('placeholder', 'Inherited: 10');
    expect(screen.getByRole('spinbutton', { name: 'Minimum order quantity in B2C' })).toHaveValue(1);
    const b2bReturnable = screen.getByRole('combobox', { name: 'Returnable in B2B' });
    expect(b2bReturnable).toHaveValue('inherit');
    expect(within(b2bReturnable).getByRole('option', { name: 'Use inherited (returnable)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Returnable in B2C' })).toHaveValue('no');
  });

  it('saves only the changed channel fields in one request; an emptied minimum inherits', async () => {
    patchAnswers(scopesFixture());
    render(card());
    const user = userEvent.setup();

    const b2b = await screen.findByRole('spinbutton', { name: 'Minimum order quantity in B2B' });
    await user.type(b2b, '24');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Returnable in B2B' }), 'no');
    await user.clear(screen.getByRole('spinbutton', { name: 'Minimum order quantity in B2C' }));
    await user.click(screen.getByRole('button', { name: 'Save channel rules' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(SCOPES_PATH, {
      channels: [
        { channelId: B2B, minOrderQuantity: 24, returnable: false },
        { channelId: B2C, minOrderQuantity: null },
      ],
    });
    await screen.findByText('Channel rules saved.');
  });

  it('refuses an invalid channel minimum inline without a request', async () => {
    render(card());
    const user = userEvent.setup();
    const b2b = await screen.findByRole('spinbutton', { name: 'Minimum order quantity in B2B' });
    await user.type(b2b, '0');
    await user.click(screen.getByRole('button', { name: 'Save channel rules' }));
    const message = await screen.findByText('Enter a whole number from 1 to 1000000, or leave the field empty.');
    expect(b2b).toHaveAttribute('aria-invalid', 'true');
    expect(b2b.getAttribute('aria-describedby')).toContain(message.id);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('offers no channel minimum for a bundle (D5) but keeps returnable', async () => {
    render(card('bundle'));
    expect(await screen.findByRole('combobox', { name: 'Returnable in B2B' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Minimum order quantity in B2B' })).toBeNull();
  });

  it('is read-only without catalog:write', async () => {
    render(card('simple', ['catalog:read']));
    expect(await screen.findByRole('combobox', { name: 'Returnable in B2B' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Minimum order quantity in B2B' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save channel rules' })).toBeNull();
  });
});

/**
 * Final QA review Q-M5 (FR-013, A-9) — a global change never touches the overrides and
 * never warns about them: the overrides keep their values, the inheriting channels show
 * the new global value, nothing asks and nothing writes `…/scopes`. The global audience is
 * the page form's (its Save reloads the editor, which mounts these controls again); the
 * global order rules are the order-rules card's own.
 */
describe('a global change leaves the channel overrides alone and warns about nothing (Q-M5, FR-013, A-9)', () => {
  function expectNoOverrideWarning(): void {
    for (const alert of screen.queryAllByRole('alert')) {
      expect(alert.textContent ?? '').not.toMatch(/override/i);
    }
    expect(document.body.textContent ?? '').not.toMatch(/overrides? (will|would) be|remove (the )?overrides?/i);
  }

  it('a global audience change: the inheriting channel follows it, the overriding channel keeps its rule', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const first = render(wrap(controls(B2B)));
    expect(await screen.findByText('Inherited from global: Everyone')).toBeInTheDocument();
    first.unmount();

    // The page Save wrote the global audience; the editor reloads and mounts the controls again.
    const changed = scopesFixture();
    changed.global.visibility = 'logged_in_only';
    primeGets(changed);
    const second = render(wrap(controls(B2B)));
    expect(await screen.findByText('Inherited from global: Signed-in buyers only')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Set an audience for this channel' })).not.toBeChecked();
    expectNoOverrideWarning();
    second.unmount();

    render(wrap(controls(B2C)));
    const override = await screen.findByRole('checkbox', { name: 'Set an audience for this channel' });
    expect(override).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Who can see it' })).toHaveValue('organization_restricted');
    expect(screen.queryByText(/^Inherited from global:/)).toBeNull();
    expectNoOverrideWarning();

    expect(patchSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('a global minimum change writes the product only; the channel minimum and returnable overrides stay', async () => {
    patchSpy.mockResolvedValue({ data: {} });
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(wrap(<ProductOrderRulesCard productId={PRODUCT_ID} productType="simple" />));
    const user = userEvent.setup();
    const b2bMinimum = await screen.findByRole('spinbutton', { name: 'Minimum order quantity in B2B' });
    expect(b2bMinimum).toHaveAttribute('placeholder', 'Inherited: 10');

    const global = screen.getByRole('spinbutton', { name: 'Minimum order quantity (pcs)' });
    await user.clear(global);
    await user.type(global, '25');
    await user.click(screen.getByRole('button', { name: 'Save minimum' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(PRODUCT_PATH, { minOrderQuantity: 25 });
    expect(patchSpy).not.toHaveBeenCalledWith(SCOPES_PATH, expect.anything());
    // The inheriting channel follows the new global value; the overriding one keeps its own.
    await waitFor(() => expect(b2bMinimum).toHaveAttribute('placeholder', 'Inherited: 25'));
    expect(b2bMinimum).toHaveValue(null);
    expect(screen.getByRole('spinbutton', { name: 'Minimum order quantity in B2C' })).toHaveValue(1);
    expect(screen.getByRole('combobox', { name: 'Returnable in B2C' })).toHaveValue('no');
    expectNoOverrideWarning();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('a global returnable change writes the product only; the channel returnable override stays', async () => {
    patchSpy.mockResolvedValue({ data: {} });
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(wrap(<ProductOrderRulesCard productId={PRODUCT_ID} productType="simple" />));
    const user = userEvent.setup();
    const b2bReturnable = await screen.findByRole('combobox', { name: 'Returnable in B2B' });
    expect(within(b2bReturnable).getByRole('option', { name: 'Use inherited (returnable)' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Returnable' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(PRODUCT_PATH, { returnable: false });
    await waitFor(() =>
      expect(within(b2bReturnable).getByRole('option', { name: 'Use inherited (not returnable)' })).toBeInTheDocument(),
    );
    expect(b2bReturnable).toHaveValue('inherit');
    expect(screen.getByRole('combobox', { name: 'Returnable in B2C' })).toHaveValue('no');
    expect(screen.getByRole('spinbutton', { name: 'Minimum order quantity in B2C' })).toHaveValue(1);
    expectNoOverrideWarning();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
