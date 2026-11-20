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
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1517 (UX audit 2026-11-17, SALES-22) — the customer detail stacked eleven
 * cards: account information, an *Actions* card, one card per single picker
 * (organization, customer group), addresses, every zone contribution, custom
 * fields, three history cards and a danger zone. It is now two tabs of one card —
 * **Profile** (the account, its organization and group as fields, addresses,
 * the zone's panels, custom fields) and **Activity** (orders, quote requests,
 * carts) — and the account actions are one "More" menu in the header (Hick,
 * Common Region, Prägnanz).
 */

installOffsetParentShim();

const getSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { CustomerDetail } = await import('../../../../packages/modules/customers/src/admin/pages/CustomerDetail');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/customers/i18n/en.json');
const pl = read('../packages/modules/customers/i18n/pl.json');
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const bundle = { customers: en, core: coreEn };
const T = (key: string): string => {
  const value = en[key];
  if (value === undefined) throw new Error(`missing customers key ${key}`);
  return value;
};

const CUSTOMER_ID = '00000000-0000-4000-8000-000000001517';
const DETAIL_URL = `/api/v1/admin/customers/${CUSTOMER_ID}`;

let state: { blocked: boolean; deleted: boolean };

function customer(): Record<string, unknown> {
  return {
    id: CUSTOMER_ID,
    email: 'ola@buyer.test',
    firstName: 'Ola',
    lastName: 'Kowal',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    organizationName: 'Kowal Sp. z o.o.',
    customerGroupId: null,
    customerGroupName: null,
    blocked: state.blocked,
    deleted: state.deleted,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
    preferredLanguage: null,
    block: null,
    deletion: null,
    customFieldValues: {},
  };
}

// A test-only participant of `customer.detail.after`, so the Profile tab's
// unsaved marker and its kept draft are observable.
const handlers: SaveParticipantHandlers<{ value: string }> = {
  changeCount: (draft, baseline) => (draft.value === baseline.value ? 0 : 1),
  validate: async () => ({ fields: {} }),
  save: async (draft) => draft,
};
// One reference: the participant reads a new `loaded` as a new baseline.
const LOADED = { value: 'a' };
function DefaultsPanel(props: AdminZoneProps<'customer.detail.after'>): ReactElement {
  const participant = useSaveParticipant(
    props.saveSession,
    { key: 'ordering-defaults', label: 'Ordering defaults', writable: true, loaded: LOADED },
    handlers,
  );
  return (
    <label>
      Ordering defaults
      <input
        value={participant.draft?.value ?? ''}
        onChange={(event): void => participant.setDraft({ value: event.target.value })}
      />
    </label>
  );
}
const DEFAULTS: AdminZoneContribution = {
  zone: 'customer.detail.after',
  weight: 100,
  component: () => Promise.resolve({ default: DefaultsPanel }),
};

function renderDetail(initialEntry = `/customers/${CUSTOMER_ID}`): void {
  renderWithSession(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetail />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['customers', 'test_defaults'] }),
      contributions: [{ moduleId: 'test_defaults', contributions: { zones: [DEFAULTS] } }],
      bundle,
    },
  );
}

async function tabs(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('tablist', { name: T('detail.tabs.label') });
  return within(list).getAllByRole('tab');
}

async function openMore(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: coreEn['common.action.more']! }));
  return screen.findByRole('menu');
}

const entryNames = (menu: HTMLElement): Array<string | undefined> =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.trim());

beforeEach(() => {
  state = { blocked: false, deleted: false };
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url === DETAIL_URL) return { data: customer() };
    if (url === `${DETAIL_URL}/addresses`) return { data: { organization: [], personal: [] } };
    if (url === `${DETAIL_URL}/carts`) return { data: { current: null, abandoned: [] } };
    // Custom-field definitions, the pickers' options, the history lists.
    return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
  });
  postSpy.mockReset().mockResolvedValue({ data: {} });
  putSpy.mockReset().mockResolvedValue({ data: {} });
});
afterEach(() => cleanup());

describe('customer detail — two tabs instead of eleven cards (#1517)', () => {
  it('opens on Profile: the account, its organization and group as fields, the zone panels', async () => {
    renderDetail();
    const [profile, activity, ...rest] = await tabs();
    expect(rest).toEqual([]);
    expect(profile).toHaveTextContent(T('detail.tabs.profile'));
    expect(activity).toHaveTextContent(T('detail.tabs.activity'));
    expect(profile).toHaveAttribute('aria-selected', 'true');

    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { name: new RegExp(T('detail.info.title')) })).toBeInTheDocument();
    expect(within(panel).getByRole('combobox', { name: T('detail.field.organization') })).toBeInTheDocument();
    expect(within(panel).getByRole('combobox', { name: T('detail.field.group') })).toBeInTheDocument();
    expect(await within(panel).findByLabelText('Ordering defaults')).toBeInTheDocument();
    // No card per picker, no Actions card, no danger-zone card, no history on this tab.
    expect(screen.queryByRole('heading', { name: /^Actions/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: T('detail.orders.title') })).toBeNull();
  });

  it('says once, on the account section, that the organization and the group apply at once', async () => {
    renderDetail();
    await tabs();
    const badge = coreEn['saveSession.immediateBadge']!;
    const headings = screen.getAllByText(badge).map((node) => node.closest('section')?.querySelector('h2')?.textContent);
    expect(headings).toEqual([T('detail.info.title')]);
  });

  it('keeps Set off until a group other than the current one is picked', async () => {
    renderDetail();
    await tabs();
    const apply = screen.getByRole('button', { name: T('detail.group.set') });
    // Nothing picked that differs from the current group: nothing to apply.
    expect(apply).toBeDisabled();
  });

  it('Activity holds the orders, the quote requests and the carts', async () => {
    const user = userEvent.setup();
    renderDetail();
    const [, activity] = await tabs();
    await user.click(activity!);
    expect(activity).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    for (const key of ['detail.orders.title', 'detail.rfqs.title', 'detail.carts.title']) {
      expect(within(panel).getByRole('heading', { name: T(key) })).toBeInTheDocument();
    }
    expect(within(panel).queryByRole('heading', { name: new RegExp(T('detail.info.title')) })).toBeNull();
  });

  it('opens on Activity from ?tab=activity', async () => {
    renderDetail(`/customers/${CUSTOMER_ID}?tab=activity`);
    const [, activity] = await tabs();
    expect(activity).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps an unsaved panel draft across tabs and marks the Profile tab while it is unsaved', async () => {
    const user = userEvent.setup();
    renderDetail();
    fireEvent.change(await screen.findByLabelText('Ordering defaults'), { target: { value: 'b' } });
    const [profile, activity] = await tabs();
    await waitFor(() => expect(profile).toHaveAccessibleName(new RegExp(T('detail.tabs.unsaved'))));
    await user.click(activity!);
    await user.click(profile!);
    expect((screen.getByLabelText('Ordering defaults') as HTMLInputElement).value).toBe('b');
    expect(screen.getByRole('button', { name: /^Save/ })).toHaveTextContent('Save 1 change');
  });
  it('passes axe on both tabs', async () => {
    const user = userEvent.setup();
    renderDetail();
    const [, activity] = await tabs();
    await screen.findByLabelText('Ordering defaults');
    await expectNoAxeViolations(document.body);
    await user.click(activity!);
    await screen.findByRole('heading', { name: T('detail.carts.title') });
    await expectNoAxeViolations(document.body);
  });
});

describe('customer detail — account actions are one "More" menu (#1517)', () => {
  it('lists the account actions, Delete last and set apart', async () => {
    const user = userEvent.setup();
    renderDetail();
    const menu = await openMore(user);
    expect(entryNames(menu)).toEqual([
      T('detail.action.block'),
      T('detail.action.passwordReset'),
      T('detail.action.resetMfa'),
      T('detail.action.impersonate'),
      T('detail.action.delete'),
    ]);
    const del = within(menu).getByRole('menuitem', { name: T('detail.action.delete') });
    expect(del.previousElementSibling).toBe(within(menu).getByRole('separator'));
    expect(del.className).toContain('text-destructive');
  });

  it('a blocked customer shows Unblock beside "More", and Block is gone from the menu', async () => {
    state.blocked = true;
    const user = userEvent.setup();
    renderDetail();
    expect(await screen.findByRole('button', { name: T('detail.action.unblock') })).toBeInTheDocument();
    const menu = await openMore(user);
    expect(entryNames(menu)).not.toContain(T('detail.action.block'));
  });

  it('a deleted customer offers Restore and nothing that acts on a live account', async () => {
    state.deleted = true;
    renderDetail();
    expect(await screen.findByRole('button', { name: T('detail.action.restore') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: coreEn['common.action.more']! })).toBeNull();
    // Not a row of disabled buttons either (Hick): the account actions are simply absent.
    for (const key of ['detail.action.block', 'detail.action.passwordReset', 'detail.action.impersonate', 'detail.action.delete']) {
      expect(screen.queryByRole('button', { name: T(key) })).toBeNull();
    }
  });

  it('says beside the header that the password-reset e-mail went out', async () => {
    const user = userEvent.setup();
    renderDetail();
    const menu = await openMore(user);
    await user.click(within(menu).getByRole('menuitem', { name: T('detail.action.passwordReset') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_URL}/password-reset`, {}),
    );
    const group = document.querySelector<HTMLElement>('[data-slot="detail-header-actions"]')!;
    expect(await within(group).findByText(T('detail.done.passwordReset'))).toBeInTheDocument();
  });
});

describe('customer detail — strings (#1517)', () => {
  it('ships the new strings in English and Polish', () => {
    for (const key of [
      'detail.tabs.label',
      'detail.tabs.profile',
      'detail.tabs.activity',
      'detail.tabs.unsaved',
      'detail.done.passwordReset',
      'detail.done.block',
      'detail.done.unblock',
      'detail.done.resetMfa',
      'detail.done.delete',
      'detail.done.restore',
    ]) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
  });

  it('drops the strings of the cards it removed', () => {
    for (const key of ['detail.actions.title', 'detail.dangerZone.title', 'detail.dangerZone.hint', 'detail.org.title', 'detail.group.title']) {
      expect(en[key], key).toBeUndefined();
      expect(pl[key], key).toBeUndefined();
    }
  });
});
