import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import type {
  CommandHookPlanResponse,
  CommandOutboxListItem,
  CommandOutboxListResponse,
  CommandOutboxStatus,
  SupportedAdminLanguage,
} from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';

/**
 * `/platform/command-hooks` — `specs/176-command-hooks-outbox/` T061 (FR-041).
 *
 * Rendered over the **shipped** `core` bundles in both languages, so a missing
 * or untranslated key fails here rather than rendering its raw name. The API is
 * mocked at the module boundary; the failure-label resolution is the real one.
 */

let planAnswer: () => Promise<CommandHookPlanResponse>;
let listAnswer: (status: CommandOutboxStatus, cursor: string | null) => Promise<CommandOutboxListResponse>;
const retry = vi.fn<(id: string) => Promise<{ item: CommandOutboxListItem }>>();

vi.mock('../../../../packages/admin-shell/src/modules/platform/command-hooks-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../packages/admin-shell/src/modules/platform/command-hooks-api')>();
  return {
    ...actual,
    getCommandHookPlan: vi.fn(() => planAnswer()),
    listCommandOutbox: vi.fn((query: { status: CommandOutboxStatus; cursor?: string | null }) =>
      listAnswer(query.status, query.cursor ?? null),
    ),
    retryCommandOutboxEntry: (id: string) => retry(id),
  };
});

const { CommandHooksPage } = await import('../../../../packages/admin-shell/src/modules/platform/CommandHooksPage');

const CORE: Record<SupportedAdminLanguage, Record<string, string>> = {
  en: coreEn as Record<string, string>,
  pl: corePl as Record<string, string>,
} as Record<SupportedAdminLanguage, Record<string, string>>;

/** A hook module's own bundle: it translates the code its handler throws. */
const ACME: Record<SupportedAdminLanguage, Record<string, string>> = {
  en: { 'errors.ACME_ERP_DOWN': 'The ERP did not answer.' },
  pl: { 'errors.ACME_ERP_DOWN': 'ERP nie odpowiedział.' },
} as Record<SupportedAdminLanguage, Record<string, string>>;

function bundleFor(language: SupportedAdminLanguage): Bundle {
  return { core: CORE[language], acme_erp: ACME[language] };
}

function core(language: SupportedAdminLanguage, key: string): string {
  const value = CORE[language][key];
  if (value === undefined) throw new Error(`core bundle (${language}) has no "${key}"`);
  return value;
}

const PLAN: CommandHookPlanResponse = {
  actions: [
    { action: 'organization.create', objectType: 'organization', owner: 'organizations', phases: ['beforeCommit', 'afterCommit'] },
    { action: 'organization.register', objectType: 'organization', owner: 'organizations', phases: ['beforeCommit', 'afterCommit'] },
  ],
  items: [
    { action: 'organization.register', phase: 'beforeCommit', position: 1, module: 'acme_erp', id: 'write-erp-code', moduleEnabled: true },
    { action: 'organization.register', phase: 'beforeCommit', position: 2, module: 'acme_crm', id: 'check-crm', moduleEnabled: false },
    { action: 'organization.register', phase: 'afterCommit', position: null, module: 'acme_erp', id: 'notify-erp', moduleEnabled: true },
  ],
};

function row(overrides: Partial<CommandOutboxListItem>): CommandOutboxListItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    action: 'organization.register',
    objectType: 'organization',
    objectId: '00000000-0000-4000-8000-0000000000aa',
    organizationId: '00000000-0000-4000-8000-0000000000aa',
    hookModule: 'acme_erp',
    hookId: 'notify-erp',
    status: 'dead',
    attempts: 10,
    lastErrorCode: 'ACME_ERP_DOWN',
    lastErrorClass: 'HttpError',
    createdAt: '2026-11-12T10:00:00.000Z',
    availableAt: '2026-11-12T10:30:00.000Z',
    deadAt: '2026-11-12T11:00:00.000Z',
    ...overrides,
  };
}

const DEAD: CommandOutboxListItem[] = [
  row({ id: '00000000-0000-4000-8000-000000000001' }),
  row({ id: '00000000-0000-4000-8000-000000000002', lastErrorCode: 'hook-unregistered', lastErrorClass: null }),
  row({ id: '00000000-0000-4000-8000-000000000003', lastErrorCode: 'acme-quirk-7', lastErrorClass: 'AcmeError' }),
];

function renderPage(
  tab: 'plan' | 'outbox',
  options: { language?: SupportedAdminLanguage; permissions?: readonly string[] } = {},
): void {
  const language = options.language ?? 'en';
  const path = tab === 'plan' ? '/platform/command-hooks' : '/platform/command-hooks/outbox';
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <CommandHooksPage tab={tab} />
      </MemoryRouter>,
      {
        session: adminSession({
          permissions: options.permissions ?? [
            'platform.modules.read',
            'platform.command_outbox.read',
            'platform.command_outbox.manage',
          ],
          preferredLanguage: language,
        }),
        presence: modulePresence({}),
      },
    ),
    bundleFor(language),
    { language },
  );
}

beforeEach(() => {
  planAnswer = async () => PLAN;
  listAnswer = async (status) => ({ items: status === 'dead' ? DEAD : [], nextCursor: null });
  retry.mockReset();
});

describe.each(['en', 'pl'] as const)('CommandHooksPage, %s', (language) => {
  it('renders the execution plan: ordered beforeCommit hooks, unordered afterCommit handlers, live presence', async () => {
    renderPage('plan', { language });

    const register = await screen.findByRole('region', { name: 'organization.register' });
    const before = within(register).getByRole('list', { name: core(language, 'platform.commandHooks.plan.beforeCommit.title') });
    expect(before.tagName).toBe('OL');
    const beforeItems = within(before).getAllByRole('listitem');
    expect(beforeItems.map((item) => item.getAttribute('data-hook'))).toEqual(['acme_erp#write-erp-code', 'acme_crm#check-crm']);
    expect(within(beforeItems[1]!).getByText(core(language, 'platform.commandHooks.module.off'))).toBeTruthy();

    // afterCommit: an unordered list, and no position number anywhere in it.
    const after = within(register).getByRole('list', { name: core(language, 'platform.commandHooks.plan.afterCommit.title') });
    expect(after.tagName).toBe('UL');
    const [handler] = within(after).getAllByRole('listitem');
    expect(handler?.getAttribute('data-hook')).toBe('acme_erp#notify-erp');
    expect(handler?.textContent).not.toMatch(/\b1\b/);

    // A declared action nothing hooks says so, per offered phase.
    const create = screen.getByRole('region', { name: 'organization.create' });
    expect(within(create).getAllByText(core(language, 'platform.commandHooks.plan.noHooks'))).toHaveLength(2);

    expect(screen.getByRole('tab', { name: core(language, 'platform.commandHooks.tab.plan') }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: core(language, 'platform.commandHooks.tab.outbox') })).toBeTruthy();
  });

  it('lists dead rows with their failure translated by the hook module, then the platform, else raw', async () => {
    renderPage('outbox', { language });

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    // The hook module's own sentence for its own code.
    expect(within(rows[0]!).getByText(ACME[language]['errors.ACME_ERP_DOWN']!)).toBeTruthy();
    // The platform's sentence for a platform code.
    expect(within(rows[1]!).getByText(core(language, 'commandOutbox.failure.hook-unregistered'))).toBeTruthy();
    // Nobody translates it: the raw code, never an invented sentence.
    expect(within(rows[2]!).getAllByText('acme-quirk-7').length).toBeGreaterThan(0);
    expect(within(rows[2]!).getByText('AcmeError')).toBeTruthy();
    // The code is always shown beside its label.
    expect(within(rows[0]!).getByText('ACME_ERP_DOWN')).toBeTruthy();
    expect(screen.getByRole('tab', { name: core(language, 'platform.commandHooks.tab.outbox') }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('CommandHooksPage — outbox permissions and retry', () => {
  it('hides the retry control without platform.command_outbox.manage', async () => {
    renderPage('outbox', { permissions: ['platform.modules.read', 'platform.command_outbox.read'] });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('hides the outbox tab without platform.command_outbox.read', async () => {
    renderPage('plan', { permissions: ['platform.modules.read'] });
    await screen.findByRole('region', { name: 'organization.register' });
    expect(screen.queryByRole('tab', { name: core('en', 'platform.commandHooks.tab.outbox') })).toBeNull();
  });

  it('says the outbox is not available rather than fetching it without the permission', async () => {
    const fetched = vi.fn();
    listAnswer = async () => {
      fetched();
      return { items: [], nextCursor: null };
    };
    renderPage('outbox', { permissions: ['platform.modules.read'] });
    expect(await screen.findByText(core('en', 'platform.commandHooks.outbox.forbidden'))).toBeTruthy();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('retries a dead row, takes it off the dead list and announces it', async () => {
    retry.mockImplementation(async (id) => ({ item: row({ id, status: 'pending', attempts: 0, deadAt: null }) }));
    renderPage('outbox');
    const table = await screen.findByRole('table');
    const first = within(table).getAllByRole('row')[1]!;
    await userEvent.click(within(first).getByRole('button', { name: /retry/i }));

    expect(retry).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
    expect(await screen.findByText(core('en', 'platform.commandHooks.outbox.retried'))).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(2));
  });

  it('shows a refused retry and keeps the row', async () => {
    retry.mockImplementation(async () => {
      throw new ApiError(409, { error: { code: 'COMMAND_OUTBOX_NOT_DEAD', message: 'Only a failed delivery can be retried.' } });
    });
    renderPage('outbox');
    const table = await screen.findByRole('table');
    await userEvent.click(within(within(table).getAllByRole('row')[1]!).getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(/Only a failed delivery can be retried/)).toBeTruthy();
    expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(3);
  });

  it('filters by status and loads the next page through the cursor', async () => {
    const asked: Array<[CommandOutboxStatus, string | null]> = [];
    listAnswer = async (status, cursor) => {
      asked.push([status, cursor]);
      if (status !== 'pending') return { items: [], nextCursor: null };
      return cursor === null
        ? { items: [row({ id: '00000000-0000-4000-8000-0000000000p1', status: 'pending', deadAt: null })], nextCursor: '41' }
        : { items: [row({ id: '00000000-0000-4000-8000-0000000000p2', status: 'pending', deadAt: null })], nextCursor: null };
    };
    renderPage('outbox');
    expect(await screen.findByText(core('en', 'platform.commandHooks.outbox.empty.dead'))).toBeTruthy();

    await userEvent.selectOptions(
      screen.getByLabelText(core('en', 'platform.commandHooks.outbox.status.label')),
      'pending',
    );
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(1);
    // A pending row is not offered a retry: only a dead one is.
    expect(within(table).queryByRole('button', { name: /retry/i })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: core('en', 'platform.commandHooks.outbox.loadMore') }));
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(2));
    expect(asked).toEqual([
      ['dead', null],
      ['pending', null],
      ['pending', '41'],
    ]);
    expect(screen.queryByRole('button', { name: core('en', 'platform.commandHooks.outbox.loadMore') })).toBeNull();
  });
});

describe('CommandHooksPage — loading, empty and error states', () => {
  it('announces loading, then an empty plan', async () => {
    let release: (value: CommandHookPlanResponse) => void = () => undefined;
    planAnswer = () => new Promise((resolve) => (release = resolve));
    renderPage('plan');
    expect(screen.getByText(core('en', 'platform.commandHooks.plan.loading'))).toBeTruthy();
    release({ actions: [], items: [] });
    expect(await screen.findByText(core('en', 'platform.commandHooks.plan.empty'))).toBeTruthy();
  });

  it('shows the plan error', async () => {
    planAnswer = async () => {
      throw new ApiError(403, { error: { code: 'FORBIDDEN', message: 'Missing permission: platform.modules.read.' } });
    };
    renderPage('plan');
    expect(await screen.findByText(/Missing permission: platform\.modules\.read/)).toBeTruthy();
  });

  it('announces loading, then an empty outbox', async () => {
    let release: (value: CommandOutboxListResponse) => void = () => undefined;
    listAnswer = () => new Promise((resolve) => (release = resolve));
    renderPage('outbox');
    expect(await screen.findByText(core('en', 'platform.commandHooks.outbox.loading'))).toBeTruthy();
    release({ items: [], nextCursor: null });
    expect(await screen.findByText(core('en', 'platform.commandHooks.outbox.empty.dead'))).toBeTruthy();
  });

  it('shows the outbox error', async () => {
    listAnswer = async () => {
      throw new ApiError(500, { error: { code: 'INTERNAL', message: 'The outbox could not be read.' } });
    };
    renderPage('outbox');
    expect(await screen.findByText(/The outbox could not be read/)).toBeTruthy();
  });
});
