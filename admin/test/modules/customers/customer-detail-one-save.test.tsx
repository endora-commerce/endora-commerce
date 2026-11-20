import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { AdminZoneContribution, AdminZoneProps } from '@endora-commerce/contracts';
import { useSaveParticipant, type SaveParticipantHandlers } from '@endora-commerce/admin-kit/lib';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { answerConfirm } from '../../helpers/confirm-dialog';

/**
 * Feature 180, WP-8 — the customer detail gets one Save
 * (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §3; US9, OQ-9 = A;
 * FR-060, FR-061, FR-062).
 *
 * The host part is the customer's custom fields (`PATCH …/customers/:id/custom-fields`),
 * blocking. The two zone participants are test-only contributions to `customer.detail.after`,
 * keyed as the two real panels are (`ordering-defaults`, `price-negotiation`): the real panels
 * become participants in their own modules (WP-7), and this file's subject is the host. Every
 * write lands in one ordered log, so "custom fields first, then the panels in zone order" is the
 * order of that log.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();
const putSpy = vi.fn();
const postSpy = vi.fn();
const writes: string[] = [];

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => {
        writes.push(`POST ${String(args[0])}`);
        return postSpy(...args);
      },
      put: (...args: unknown[]) => {
        writes.push(`PUT ${String(args[0])}`);
        return putSpy(...args);
      },
      patch: (...args: unknown[]) => {
        writes.push(`PATCH ${String(args[0])}`);
        return patchSpy(...args);
      },
      delete: vi.fn(),
    },
  };
});

// The history panels each read their own data; none is under test here.
vi.mock('../../../../packages/modules/customers/src/admin/panels/HistoryPanels', () => ({
  OrdersPanel: () => null,
  QuoteRequestsPanel: () => null,
  CartsPanel: () => null,
}));

const { CustomerDetail } = await import('../../../../packages/modules/customers/src/admin/pages/CustomerDetail');
const { ApiError, apiClient } = await import('@endora-commerce/admin-kit/lib');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/customers/i18n/en.json');
const pl = read('../packages/modules/customers/i18n/pl.json');
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const bundle = { customers: en, core: coreEn };

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const DETAIL_URL = `/api/v1/admin/customers/${CUSTOMER_ID}`;
const CUSTOM_FIELDS_URL = `${DETAIL_URL}/custom-fields`;
const DEFAULTS_URL = '/test/ordering-defaults';
const NEGOTIATION_URL = '/test/price-negotiation';

const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d001',
  entityType: 'customer',
  key: 'loyalty_tier',
  label: { en: 'Loyalty tier' },
  labelDefault: 'Loyalty tier',
  valueType: 'text',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let stored: Record<string, unknown>;

function customer(): Record<string, unknown> {
  return {
    id: CUSTOMER_ID,
    email: 'buyer@test.com',
    firstName: 'Bea',
    lastName: 'Uyer',
    organizationId: null,
    organizationName: null,
    customerGroupId: null,
    customerGroupName: null,
    blocked: false,
    deleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
    block: null,
    deletion: null,
    customFieldValues: { ...stored },
  };
}

// ---------------------------------------------------------------------------
// The two test-only participants in `customer.detail.after`.
// ---------------------------------------------------------------------------

interface ValueDraft {
  readonly value: string;
}

function makePanel(spec: { key: string; label: string; url: string; loaded: ValueDraft }) {
  const handlers: SaveParticipantHandlers<ValueDraft> = {
    changeCount: (draft, baseline) => (draft.value === baseline.value ? 0 : 1),
    validate: async () => ({ fields: {} }),
    save: async (draft) => {
      await apiClient.put(spec.url, draft);
      return draft;
    },
  };
  return function Panel(props: AdminZoneProps<'customer.detail.after'>): ReactElement {
    const participant = useSaveParticipant(
      props.saveSession,
      { key: spec.key, label: spec.label, writable: true, loaded: spec.loaded },
      handlers,
    );
    return (
      <label>
        {spec.label}
        <input
          value={participant.draft?.value ?? ''}
          onChange={(event): void => participant.setDraft({ value: event.target.value })}
        />
      </label>
    );
  };
}

const DefaultsPanel = makePanel({ key: 'ordering-defaults', label: 'Ordering defaults', url: DEFAULTS_URL, loaded: { value: 'a' } });
const NegotiationPanel = makePanel({ key: 'price-negotiation', label: 'Price negotiation', url: NEGOTIATION_URL, loaded: { value: 'off' } });

const DEFAULTS: AdminZoneContribution = {
  zone: 'customer.detail.after',
  weight: 100,
  component: () => Promise.resolve({ default: DefaultsPanel }),
};
const NEGOTIATION: AdminZoneContribution = {
  zone: 'customer.detail.after',
  weight: 200,
  component: () => Promise.resolve({ default: NegotiationPanel }),
};

function renderDetail(options: { permissions?: readonly string[]; panels?: boolean } = {}): void {
  renderWithSession(
    <MemoryRouter initialEntries={[`/customers/${CUSTOMER_ID}`]}>
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetail />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: options.permissions ?? ['*'] }),
      presence: modulePresence({ present: ['customers', 'custom_fields', 'test_defaults', 'test_negotiation'] }),
      contributions:
        options.panels === false
          ? []
          : [
              { moduleId: 'test_defaults', contributions: { zones: [DEFAULTS] } },
              { moduleId: 'test_negotiation', contributions: { zones: [NEGOTIATION] } },
            ],
      bundle,
    },
  );
}

/** The page Save — the one in the page head. */
function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Save/ });
}

async function editTier(value: string): Promise<void> {
  const input = (await screen.findByLabelText('Loyalty tier')) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

async function editPanel(label: string, value: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
}

beforeEach(() => {
  writes.length = 0;
  stored = { loyalty_tier: 'gold' };
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url === DETAIL_URL) return { data: customer() };
    if (url === '/api/v1/admin/custom-fields/definitions?entityType=customer') return { data: [DEFINITION] };
    if (url === `${DETAIL_URL}/addresses`) return { data: { organization: [], personal: [] } };
    // The organization and customer-group pickers' option reads.
    return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
  });
  patchSpy.mockReset().mockImplementation(async (_url: string, body: Record<string, unknown>) => {
    stored = { ...stored, ...body };
    return { data: customer() };
  });
  putSpy.mockReset().mockResolvedValue({ data: {} });
  postSpy.mockReset().mockResolvedValue({ data: {} });
});
afterEach(() => cleanup());

describe('customer detail — one Save (feature 180, WP-8)', () => {
  it('offers one Save, in the page head, and no Save of the custom-fields panel', async () => {
    renderDetail();
    await screen.findByLabelText('Loyalty tier');
    await screen.findByLabelText('Ordering defaults');
    expect(saveButton()).toHaveTextContent(/^Save$/);
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(coreEn['saveSession.action.noChanges']!)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: coreEn['customFields.save']! })).toBeNull();
    expect(screen.getByRole('banner').contains(saveButton())).toBe(true);
  });

  it('a custom-field edit writes nothing until Save, then the host write runs and the screen re-reads', async () => {
    renderDetail();
    await editTier('silver');
    expect(patchSpy).not.toHaveBeenCalled();
    expect(saveButton()).toHaveTextContent('Save 1 change');

    fireEvent.click(saveButton());
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[0]).toBe(CUSTOM_FIELDS_URL);
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({ loyalty_tier: 'silver' });
    await waitFor(() => expect(getSpy.mock.calls.filter((call) => call[0] === DETAIL_URL)).toHaveLength(2));
    await waitFor(() => expect(saveButton()).toHaveTextContent(/^Save$/));
  });

  it('writes the custom fields first, then the two panels in zone order', async () => {
    renderDetail();
    await editPanel('Price negotiation', 'on');
    await editPanel('Ordering defaults', 'b');
    await editTier('silver');
    expect(saveButton()).toHaveTextContent('Save 3 changes');
    expect(putSpy).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    expect(writes).toEqual([`PATCH ${CUSTOM_FIELDS_URL}`, `PUT ${DEFAULTS_URL}`, `PUT ${NEGOTIATION_URL}`]);
    await waitFor(() => expect(saveButton()).toHaveTextContent(/^Save$/));
  });

  it('a refused custom-field write writes no panel and keeps every change staged', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_VALUE_INVALID',
          message: 'A custom field value is invalid.',
          requestId: 'r',
          details: [{ path: 'loyalty_tier', issue: 'Not a known tier.' }],
        },
      } as never),
    );
    renderDetail();
    await editTier('platinum');
    await editPanel('Ordering defaults', 'b');
    fireEvent.click(saveButton());

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Not a known tier.')).toBeInTheDocument();
    expect(putSpy).not.toHaveBeenCalled();
    expect(saveButton()).toHaveTextContent('Save 2 changes');
  });

  it('keeps the custom fields saved when a panel fails, and retries only the panel', async () => {
    putSpy.mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'The server failed.', requestId: 'r' } } as never),
    );
    renderDetail();
    await editTier('silver');
    await editPanel('Ordering defaults', 'b');
    fireEvent.click(saveButton());

    expect(await screen.findByText(coreEn['saveSession.summary.partial']!)).toBeInTheDocument();
    // The summary names the host part by its label: the custom fields saved, the panel did not.
    expect(
      screen.getByText(coreEn['saveSession.summary.saved']!.replace('{labels}', en['detail.save.hostPartLabel']!)),
    ).toBeInTheDocument();
    expect(patchSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveButton()).toHaveTextContent('Save 1 change'));

    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(2));
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it('asks the browser before the tab closes over an unsaved change', async () => {
    renderDetail();
    await editPanel('Ordering defaults', 'b');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows no Save without customers:manage and no writable panel', async () => {
    renderDetail({ permissions: ['customers:read'], panels: false });
    await screen.findByText(en['detail.info.title']!);
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  });
});

describe('customer detail — immediate actions stay immediate (feature 180, FR-061)', () => {
  it('labels each immediate section "Applies immediately"', async () => {
    renderDetail();
    await screen.findByLabelText('Loyalty tier');
    const badge = coreEn['saveSession.immediateBadge']!;
    // Each badge sits in its section's heading: the heading's text is the title, then the badge.
    // Issue #1517 — one immediate section now: the account, whose organization and group fields
    // apply at once. The account actions are the header's "More" menu.
    const headings = screen.getAllByText(badge).map((node) => node.parentElement?.textContent ?? '');
    expect(headings).toEqual([`${en['detail.info.title']!}${badge}`]);
    // The custom fields are not immediate: they save with the page.
    expect(within(screen.getByText(coreEn['customFields.title']!)).queryByText(badge)).toBeNull();
  });

  it('Block applies at once once confirmed, without Save, and keeps the staged changes', async () => {
    renderDetail();
    await editTier('silver');
    // Issue #1517 — Block is an entry of the header's "More" menu.
    await userEvent.click(screen.getByRole('button', { name: coreEn['common.action.more']! }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: en['detail.action.block']! }));
    // Issue #1471 — Block asks first; the answer, not the page Save, is what applies it.
    expect(postSpy).not.toHaveBeenCalled();
    await answerConfirm(true);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(writes).toEqual([`POST ${DETAIL_URL}/block`]);
    expect(patchSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(getSpy.mock.calls.filter((call) => call[0] === DETAIL_URL)).toHaveLength(2));
    expect(saveButton()).toHaveTextContent('Save 1 change');
    expect((screen.getByLabelText('Loyalty tier') as HTMLInputElement).value).toBe('silver');
  });
});

describe('customer detail — strings (feature 180, FR-080)', () => {
  it('ships the new strings in English and Polish', () => {
    for (const key of ['detail.save.hostPartLabel']) {
      expect(en[key]).toBeTruthy();
      expect(pl[key]).toBeTruthy();
    }
    expect(en['detail.save.hostPartLabel']).toBe('Customer');
  });
});
