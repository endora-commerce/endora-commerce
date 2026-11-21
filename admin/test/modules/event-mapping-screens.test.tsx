import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { adminSession, modulePresence, renderWithSession } from '../helpers/render-with-session';
import { installOffsetParentShim } from '../helpers/layout-shim';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1537 (UX audit 2026-11-17, CONTENT-20) — Google Analytics custom
 * events, Meta Ads custom events and LinkedIn Ads conversion mappings are three
 * sibling screens that map a storefront action to an ad platform's event. They
 * had three interaction patterns: GA a raw table and Delete only in its editor,
 * Meta and LinkedIn a solid red Delete in every row. They now have one shape,
 * and this file asserts it once for all three:
 *
 *  - the list is the kit's `ListPage` — the storefront action, translated, is
 *    the row's link; the platform's identifier is code; the channel is named;
 *    the status is a word, not "✓" or "—";
 *  - row actions are one `RowActionMenu`: Edit, then Delete after a separator,
 *    confirmed in a dialog that runs the request;
 *  - an empty list is the kit's `EmptyState`, which then holds the one "New";
 *  - the editor's one Save is the submit of the kit's sticky bar, beside
 *    Cancel; Delete is in the header's "More" menu, away from Save, and asks
 *    first; an empty required field is refused at Save with its own message;
 *    Enabled is a switch; a refused save is said in the bar.
 */

installOffsetParentShim();

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CORE = read('../packages/modules/_i18n/i18n/en.json');
const CORE_PL = read('../packages/modules/_i18n/i18n/pl.json');
/** A `core` string as it ships; a missing key fails the test rather than matching `undefined`. */
const core = (key: string): string => {
  const value = CORE[key];
  if (value === undefined) throw new Error(`core has no ${key}`);
  return value;
};

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

const CHANNEL_ID = '00000000-0000-4000-8000-0000000c0001';
const CHANNELS = {
  items: [{ id: CHANNEL_ID, code: 'pl-b2b', name: { 'en-US': 'Poland B2B', 'pl-PL': 'Polska B2B' }, active: true }],
};
const ROW_ID = '00000000-0000-4000-8000-0000000e0001';

const ga = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  actionCatalogue: vi.fn(),
  listSalesChannels: vi.fn(),
}));
const meta = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listSalesChannels: vi.fn(),
}));
const linkedIn = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listSalesChannels: vi.fn(),
}));

vi.mock('../../../packages/modules/google_analytics/src/admin/api/google-analytics-client', () => ({
  googleAnalyticsClient: ga,
  listSalesChannels: () => ga.listSalesChannels(),
}));
vi.mock('../../../packages/modules/meta_ads/src/admin/api/meta-ads-client', () => ({
  metaAdsClient: meta,
  listSalesChannels: () => meta.listSalesChannels(),
}));
vi.mock('../../../packages/modules/linkedin_ads/src/admin/api/linkedin-ads-client', () => ({
  linkedInAdsClient: linkedIn,
  listSalesChannels: () => linkedIn.listSalesChannels(),
}));

const { default: GaList } = await import('../../../packages/modules/google_analytics/src/admin/pages/CustomEventsListPage');
const { default: GaEdit } = await import('../../../packages/modules/google_analytics/src/admin/pages/CustomEventEditPage');
const { default: MetaList } = await import('../../../packages/modules/meta_ads/src/admin/pages/CustomEventMappingsListPage');
const { default: MetaEdit } = await import('../../../packages/modules/meta_ads/src/admin/pages/CustomEventMappingEditPage');
const { default: LinkedInList } = await import(
  '../../../packages/modules/linkedin_ads/src/admin/pages/ConversionMappingsListPage'
);
const { default: LinkedInEdit } = await import(
  '../../../packages/modules/linkedin_ads/src/admin/pages/ConversionMappingEditPage'
);

type Client = Record<string, Mock>;

interface Subject {
  readonly module: 'google_analytics' | 'meta_ads' | 'linkedin_ads';
  readonly base: string;
  readonly prefix: 'customEvents' | 'mappings';
  readonly client: Client;
  readonly List: ComponentType;
  readonly Edit: ComponentType;
  /** The row the list and the editor read. */
  readonly row: Record<string, unknown>;
  /** The platform-side identifier the row shows as code. */
  readonly target: string;
  /** The bundle key of the storefront action's label. */
  readonly actionKey: string;
  /** The label key of the field a Save refuses while it is empty. */
  readonly requiredKey: string;
  /** What to type into it for a valid create. */
  readonly requiredValue: string;
}

const STAMP = { createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', version: 1 };

const SUBJECTS: readonly Subject[] = [
  {
    module: 'google_analytics',
    base: '/google-analytics',
    prefix: 'customEvents',
    client: ga,
    List: GaList,
    Edit: GaEdit,
    row: {
      id: ROW_ID,
      salesChannelCode: 'pl-b2b',
      eventName: 'cart_add',
      triggerAction: 'add_to_cart',
      buttonId: null,
      enabled: false,
      fields: [],
      ...STAMP,
    },
    target: 'cart_add',
    actionKey: 'customEvents.actions.add_to_cart',
    requiredKey: 'customEvents.eventName',
    requiredValue: 'cart_add',
  },
  {
    module: 'meta_ads',
    base: '/meta-ads',
    prefix: 'customEvents',
    client: meta,
    List: MetaList,
    Edit: MetaEdit,
    row: {
      id: ROW_ID,
      salesChannelId: CHANNEL_ID,
      triggerAction: 'add_to_cart',
      eventName: 'CartAdd',
      enabled: false,
      ...STAMP,
    },
    target: 'CartAdd',
    actionKey: 'customEvents.action.add_to_cart',
    requiredKey: 'customEvents.eventName',
    requiredValue: 'CartAdd',
  },
  {
    module: 'linkedin_ads',
    base: '/linkedin-ads',
    prefix: 'mappings',
    client: linkedIn,
    List: LinkedInList,
    Edit: LinkedInEdit,
    row: {
      id: ROW_ID,
      salesChannelId: CHANNEL_ID,
      triggerAction: 'add_to_cart',
      conversionId: '12345',
      conversionRuleUrn: null,
      enabled: false,
      ...STAMP,
    },
    target: '12345',
    actionKey: 'mappings.action.add_to_cart',
    requiredKey: 'mappings.conversionId',
    requiredValue: '12345',
  },
];

function bundleOf(subject: Subject): Record<string, string> {
  return read(`../packages/modules/${subject.module}/i18n/en.json`);
}

function mount(subject: Subject, path: string, permissions: readonly string[]): void {
  const { List, Edit } = subject;
  renderWithSession(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={subject.base} element={<List />} />
        <Route path={`${subject.base}/new`} element={<Edit />} />
        <Route path={`${subject.base}/:id`} element={<Edit />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions }),
      presence: modulePresence({ present: [subject.module] }),
      bundle: { [subject.module]: bundleOf(subject), core: CORE },
    },
  );
}

const writer = (subject: Subject): string[] => [`${subject.module}:read`, `${subject.module}:write`];

beforeEach(() => {
  for (const subject of SUBJECTS) {
    for (const fn of Object.values(subject.client)) fn.mockReset();
    subject.client.list!.mockResolvedValue([subject.row]);
    subject.client.get!.mockResolvedValue(subject.row);
    subject.client.create!.mockResolvedValue(subject.row);
    subject.client.update!.mockResolvedValue(subject.row);
    subject.client.remove!.mockResolvedValue(undefined);
    subject.client.listSalesChannels!.mockResolvedValue(CHANNELS);
  }
  ga.actionCatalogue.mockResolvedValue({
    contact_form_submitted: { static: null },
    place_order_clicked: { static: null },
    add_to_cart: { static: ['sku', 'name', 'price', 'quantity'] },
    add_to_quote_request: { static: ['sku', 'name', 'price', 'quantity'] },
    add_to_shopping_list: { static: ['sku', 'name', 'price', 'quantity'] },
    button_click_by_id: { static: null },
  });
});

describe.each(SUBJECTS)('$module — the shared event-mapping shape (#1537)', (subject) => {
  const T = bundleOf(subject);
  const k = (suffix: string): string => {
    const value = T[`${subject.prefix}.${suffix}`];
    if (value === undefined) throw new Error(`${subject.module} has no ${subject.prefix}.${suffix}`);
    return value;
  };
  const action = (): string => T[subject.actionKey]!;
  const menuName = (): string => fill(k('rowActions'), { action: action(), name: subject.target });

  it('ships every key it reads in English and Polish', () => {
    const pl = read(`../packages/modules/${subject.module}/i18n/pl.json`);
    for (const suffix of [
      'status',
      'statusEnabled',
      'statusDisabled',
      'count',
      'emptyBody',
      'emptyBodyReadOnly',
      'rowActions',
      'deleteConfirm.title',
      'deleteConfirm.message',
      'deleteConfirm.action',
      'deleteConfirm.failed',
    ]) {
      expect(T[`${subject.prefix}.${suffix}`], suffix).toBeTruthy();
      expect(pl[`${subject.prefix}.${suffix}`], suffix).toBeTruthy();
    }
    // The flat confirmation question is replaced by the titled dialog's keys.
    expect(T[`${subject.prefix}.deleteConfirm`]).toBeUndefined();
    expect(CORE_PL['common.action.edit']).toBeTruthy();
  });

  it('lists the storefront action as the link, the identifier as code, the channel by name, the status in words', async () => {
    mount(subject, subject.base, writer(subject));
    const link = await screen.findByRole('link', { name: action() });
    expect(link).toHaveAttribute('href', `${subject.base}/${ROW_ID}`);
    const row = link.closest('tr')!;
    expect(within(row).getByText(subject.target).tagName).toBe('CODE');
    expect(row).toHaveTextContent('Poland B2B');
    expect(row).toHaveTextContent(k('statusDisabled'));
    expect(row).not.toHaveTextContent('—');
    expect(screen.getByRole('status')).toHaveTextContent(fill(k('count'), { count: 1 }));
    expect(screen.getByRole('link', { name: k('new') })).toHaveAttribute('href', `${subject.base}/new`);
  });

  it('keeps the row actions in one menu — Edit, then a Delete that asks first — and no button in the row', async () => {
    mount(subject, subject.base, writer(subject));
    const trigger = await screen.findByRole('button', { name: menuName() });
    const row = trigger.closest('tr')!;
    expect(within(row).getAllByRole('button')).toEqual([trigger]);

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([core('common.action.edit'), k('delete')]);
    expect(items[1]!.previousElementSibling).toBe(within(menu).getByRole('separator'));

    await userEvent.click(items[1]!);
    const dialog = await screen.findByRole('dialog', { name: k('deleteConfirm.title') });
    expect(dialog).toHaveTextContent(subject.target);
    await userEvent.click(within(dialog).getByRole('button', { name: k('deleteConfirm.action') }));
    await waitFor(() => expect(subject.client.remove).toHaveBeenCalledWith(ROW_ID));
    await waitFor(() => expect(screen.queryByRole('link', { name: action() })).toBeNull());
  });

  it('keeps a failed delete in its dialog', async () => {
    subject.client.remove!.mockRejectedValue(new Error('offline'));
    mount(subject, subject.base, writer(subject));
    await userEvent.click(await screen.findByRole('button', { name: menuName() }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: k('delete') }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: k('deleteConfirm.action') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(k('deleteConfirm.failed'));
    expect(screen.getByRole('link', { name: action() })).toBeInTheDocument();
  });

  it('shows the kit empty state, which then holds the one "New"', async () => {
    subject.client.list!.mockResolvedValue([]);
    mount(subject, subject.base, writer(subject));
    const empty = await screen.findByText(k('emptyBody'));
    expect(empty.closest('[data-empty-state="no-data"]')).not.toBeNull();
    expect(screen.getAllByRole('link', { name: k('new') })).toHaveLength(1);
    await expectNoAxeViolations(document.body);
  });

  it('is read-only without the write code: no "New", no row menu, no link to the editor', async () => {
    mount(subject, subject.base, [`${subject.module}:read`]);
    expect(await screen.findByText(action())).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: k('new') })).toBeNull();
    expect(screen.queryByRole('link', { name: action() })).toBeNull();
    expect(screen.queryByRole('button', { name: menuName() })).toBeNull();
  });

  it('offers Retry when the list cannot be read', async () => {
    subject.client.list!.mockRejectedValueOnce(new Error('offline'));
    mount(subject, subject.base, writer(subject));
    await userEvent.click(await screen.findByRole('button', { name: core('common.action.retry') }));
    expect(await screen.findByRole('link', { name: action() })).toBeInTheDocument();
  });

  it('puts the one Save in the sticky bar beside Cancel, and Delete in the header menu, asking first', async () => {
    mount(subject, `${subject.base}/${ROW_ID}`, writer(subject));
    expect(await screen.findByDisplayValue(subject.target)).toBeInTheDocument();
    const bar = document.querySelector('[data-slot="sticky-form-actions"]') as HTMLElement;
    const save = within(bar).getByRole('button', { name: k('save') });
    expect(save).toHaveAttribute('type', 'submit');
    expect(within(bar).getByRole('link', { name: core('common.action.cancel') })).toHaveAttribute('href', subject.base);
    expect(within(bar).queryByRole('button', { name: k('delete') })).toBeNull();
    expect(screen.getByRole('switch', { name: k('enabled') })).toHaveAttribute('aria-checked', 'false');
    await expectNoAxeViolations(document.body);

    await userEvent.click(screen.getByRole('button', { name: core('common.action.more') }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: k('delete') }));
    const dialog = await screen.findByRole('dialog', { name: k('deleteConfirm.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: k('deleteConfirm.action') }));
    await waitFor(() => expect(subject.client.remove).toHaveBeenCalledWith(ROW_ID));
    expect(await screen.findByRole('link', { name: action() })).toBeInTheDocument();
  });

  it('refuses an empty required field at Save, with its own message, and sends nothing', async () => {
    mount(subject, `${subject.base}/new`, writer(subject));
    const field = await screen.findByLabelText(new RegExp(T[subject.requiredKey]!));
    expect(screen.queryByRole('button', { name: core('common.action.more') })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: k('save') }));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(subject.client.create).not.toHaveBeenCalled();

    await userEvent.type(field, subject.requiredValue);
    await userEvent.click(screen.getByRole('button', { name: k('save') }));
    await waitFor(() => expect(subject.client.create).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('link', { name: action() })).toBeInTheDocument();
  });

  it('says a refused save in the bar, beside Save, and stays on the editor', async () => {
    subject.client.update!.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'stale' } } as never),
    );
    mount(subject, `${subject.base}/${ROW_ID}`, writer(subject));
    await screen.findByDisplayValue(subject.target);
    await userEvent.click(screen.getByRole('button', { name: k('save') }));
    const bar = document.querySelector('[data-slot="sticky-form-actions"]') as HTMLElement;
    expect(await within(bar).findByRole('alert')).toHaveTextContent(T['error.versionConflict']!);
    expect(screen.getByDisplayValue(subject.target)).toBeInTheDocument();
  });
});
