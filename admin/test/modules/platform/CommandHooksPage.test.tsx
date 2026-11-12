import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
import lifecycleEn from '../../../../packages/platform/src/lifecycle/i18n/en.json';
import lifecyclePl from '../../../../packages/platform/src/lifecycle/i18n/pl.json';

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

/** The module list the plan names modules from; tolerant, so a refusal only drops the names. */
let modulesAnswer: () => Promise<{ modules: Array<{ id: string; name: string }> }>;
vi.mock('../../../../packages/admin-shell/src/modules/platform/api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../packages/admin-shell/src/modules/platform/api')>();
  return { ...actual, listModules: vi.fn(() => modulesAnswer()) };
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

const LIFECYCLE: Record<SupportedAdminLanguage, Record<string, string>> = {
  en: lifecycleEn as Record<string, string>,
  pl: lifecyclePl as Record<string, string>,
} as Record<SupportedAdminLanguage, Record<string, string>>;

function bundleFor(language: SupportedAdminLanguage): Bundle {
  return { core: CORE[language], acme_erp: ACME[language], _lifecycle: LIFECYCLE[language] };
}

/** Where the router is, so a redirect is observable. */
function LocationProbe(): React.ReactElement {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
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
        <Routes>
          <Route path="/platform/command-hooks" element={<CommandHooksPage tab="plan" />} />
          <Route path="/platform/command-hooks/outbox" element={<CommandHooksPage tab="outbox" />} />
        </Routes>
        <LocationProbe />
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
  modulesAnswer = async () => ({ modules: [{ id: 'acme_erp', name: 'Acme ERP' }] });
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

  it('shows a failed retry and keeps the row', async () => {
    retry.mockImplementation(async () => {
      throw new ApiError(503, { error: { code: 'MODULE_DISABLED', message: 'The outbox is not available right now.' } });
    });
    renderPage('outbox');
    const table = await screen.findByRole('table');
    await userEvent.click(within(within(table).getAllByRole('row')[1]!).getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(/The outbox is not available right now/)).toBeTruthy();
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

// ---------------------------------------------------------------------------
// T065 designer review and the architect rulings on #1080
// ---------------------------------------------------------------------------

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1);
}

describe('CommandHooksPage — retry keeps the keyboard user in place (review 1–3)', () => {
  it('keeps the pressed Retry focusable while it runs, then focuses the next row’s Retry', async () => {
    let release: () => void = () => undefined;
    retry.mockImplementation(
      (id) =>
        new Promise((resolve) => {
          release = () => resolve({ item: row({ id, status: 'pending', attempts: 0, deadAt: null }) });
        }),
    );
    renderPage('outbox');
    await screen.findByRole('table');
    const first = within(bodyRows()[0]!).getByRole('button', { name: /retry/i });
    first.focus();
    await userEvent.click(first);
    // Busy, not disabled: a disabled button drops focus to <body> (WCAG 2.4.3).
    expect((first as HTMLButtonElement).disabled).toBe(false);
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(first.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(first);
    release();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const next = within(bodyRows()[0]!).getByRole('button', { name: /retry/i });
    await waitFor(() => expect(document.activeElement).toBe(next));
  });

  it('focuses the previous row’s Retry when the last row is retried', async () => {
    retry.mockImplementation(async (id) => ({ item: row({ id, status: 'pending', attempts: 0, deadAt: null }) }));
    renderPage('outbox');
    await screen.findByRole('table');
    await userEvent.click(within(bodyRows()[2]!).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await waitFor(() =>
      expect(document.activeElement).toBe(within(bodyRows()[1]!).getByRole('button', { name: /retry/i })),
    );
  });

  it('focuses the empty state when the only row is retried', async () => {
    listAnswer = async (status) => ({ items: status === 'dead' ? [DEAD[0]!] : [], nextCursor: null });
    retry.mockImplementation(async (id) => ({ item: row({ id, status: 'pending', attempts: 0, deadAt: null }) }));
    renderPage('outbox');
    await screen.findByRole('table');
    await userEvent.click(within(bodyRows()[0]!).getByRole('button', { name: /retry/i }));
    const empty = await screen.findByText(core('en', 'platform.commandHooks.outbox.empty.dead'));
    await waitFor(() => expect(document.activeElement).toBe(empty));
  });

  it('treats 409 COMMAND_OUTBOX_NOT_DEAD as an outcome: the row leaves the list, the sentence is announced, no error alert', async () => {
    retry.mockImplementation(async () => {
      throw new ApiError(409, {
        error: { code: 'COMMAND_OUTBOX_NOT_DEAD', message: 'Only a failed delivery can be retried.' },
      });
    });
    renderPage('outbox');
    await screen.findByRole('table');
    await userEvent.click(within(bodyRows()[0]!).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(screen.getByRole('status').textContent).toBe('Only a failed delivery can be retried.');
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(bodyRows()[0]!).getByRole('button', { name: /retry/i })),
    );
  });

  it('shows a failed retry by the envelope’s sentence, not "CODE: message" (review 4)', async () => {
    retry.mockImplementation(async () => {
      throw new ApiError(500, { error: { code: 'INTERNAL', message: 'Something broke.' } });
    });
    renderPage('outbox');
    await screen.findByRole('table');
    await userEvent.click(within(bodyRows()[0]!).getByRole('button', { name: /retry/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Something broke.');
    expect(bodyRows()).toHaveLength(3);
  });
});

describe('CommandHooksPage — the outbox list (review 5–11, ruling 4)', () => {
  it('announces how many deliveries it shows, and clears a retry notice on a status change', async () => {
    retry.mockImplementation(async (id) => ({ item: row({ id, status: 'pending', attempts: 0, deadAt: null }) }));
    renderPage('outbox');
    await screen.findByRole('table');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        core('en', 'platform.commandHooks.outbox.count').replace('{count}', '3'),
      ),
    );
    await userEvent.click(within(bodyRows()[0]!).getByRole('button', { name: /retry/i }));
    await screen.findByText(core('en', 'platform.commandHooks.outbox.retried'));
    await userEvent.selectOptions(screen.getByLabelText(core('en', 'platform.commandHooks.outbox.status.label')), 'pending');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        core('en', 'platform.commandHooks.outbox.count').replace('{count}', '0'),
      ),
    );
  });

  it('shows no date column beyond Created for in-flight rows', async () => {
    listAnswer = async (status) => ({
      items: status === 'in_flight' ? [row({ status: 'in_flight', deadAt: null })] : [],
      nextCursor: null,
    });
    renderPage('outbox');
    await screen.findByText(core('en', 'platform.commandHooks.outbox.empty.dead'));
    await userEvent.selectOptions(screen.getByLabelText(core('en', 'platform.commandHooks.outbox.status.label')), 'in_flight');
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toContain(core('en', 'platform.commandHooks.outbox.column.created'));
    expect(headers).not.toContain(core('en', 'platform.commandHooks.outbox.column.availableAt'));
    expect(headers).not.toContain(core('en', 'platform.commandHooks.outbox.column.deadAt'));
  });

  it('captions the table with its status', async () => {
    renderPage('outbox');
    const table = await screen.findByRole('table');
    expect(table.querySelector('caption')?.textContent).toBe(
      core('en', 'platform.commandHooks.outbox.caption').replace('{status}', core('en', 'platform.commandHooks.outbox.status.dead')),
    );
  });

  it('tells a reader without .manage why there is no Retry', async () => {
    renderPage('outbox', { permissions: ['platform.modules.read', 'platform.command_outbox.read'] });
    await screen.findByRole('table');
    expect(
      screen.getByText(
        core('en', 'platform.commandHooks.outbox.manageHint').replace(
          '{permission}',
          LIFECYCLE.en['adminRoles.permission.platform.command_outbox.manage']!,
        ),
      ),
    ).toBeTruthy();
  });

  it('offers Try again on a failed load', async () => {
    let calls = 0;
    listAnswer = async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(500, { error: { code: 'INTERNAL', message: 'The outbox could not be read.' } });
      return { items: DEAD, nextCursor: null };
    };
    renderPage('outbox');
    await screen.findByText('The outbox could not be read.');
    await userEvent.click(screen.getByRole('button', { name: core('en', 'platform.commandHooks.tryAgain') }));
    await screen.findByRole('table');
    expect(bodyRows()).toHaveLength(3);
  });

  it('keeps Load more focusable while busy, shows its failure beside it, and focuses the first new row', async () => {
    let second: 'fail' | 'ok' = 'fail';
    listAnswer = async (status, cursor) => {
      if (status !== 'dead') return { items: [], nextCursor: null };
      if (cursor === null) return { items: [DEAD[0]!], nextCursor: '41' };
      if (second === 'fail') throw new ApiError(500, { error: { code: 'INTERNAL', message: 'Page two failed.' } });
      return { items: [DEAD[1]!], nextCursor: null };
    };
    renderPage('outbox');
    await screen.findByRole('table');
    const more = screen.getByRole('button', { name: core('en', 'platform.commandHooks.outbox.loadMore') });
    await userEvent.click(more);
    expect(await screen.findByText('Page two failed.')).toBeTruthy();
    // Inline, not the page-level alert above the table.
    expect(screen.getByText('Page two failed.').closest('[data-load-more]')).not.toBeNull();
    second = 'ok';
    await userEvent.click(screen.getByRole('button', { name: core('en', 'platform.commandHooks.outbox.loadMore') }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await waitFor(() => expect(document.activeElement).toBe(bodyRows()[1]));
    expect(screen.queryByText('Page two failed.')).toBeNull();
    expect(screen.getByText(core('en', 'platform.commandHooks.outbox.end'))).toBeTruthy();
  });
});

describe('CommandHooksPage — reachability (ruling 2) and the plan (review 13, 15, 19, 20)', () => {
  it('sends an outbox-only operator from the plan to the outbox, with no tab strip', async () => {
    renderPage('plan', { permissions: ['platform.command_outbox.read'] });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/platform/command-hooks/outbox'));
    await screen.findByRole('table');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('links back to the plan from the outbox refusal, with no tab strip', async () => {
    renderPage('outbox', { permissions: ['platform.modules.read'] });
    await screen.findByText(core('en', 'platform.commandHooks.outbox.forbidden'));
    const link = screen.getByRole('link', { name: core('en', 'platform.commandHooks.outbox.backToPlan') });
    expect(link.getAttribute('href')).toBe('/platform/command-hooks');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('numbers beforeCommit hooks by their position, and names a module beside its id', async () => {
    planAnswer = async () => ({
      ...PLAN,
      items: [
        { action: 'organization.register', phase: 'beforeCommit', position: 2, module: 'acme_crm', id: 'check-crm', moduleEnabled: false },
        { action: 'organization.register', phase: 'beforeCommit', position: 1, module: 'acme_erp', id: 'write-erp-code', moduleEnabled: true },
      ],
    });
    renderPage('plan');
    const register = await screen.findByRole('region', { name: 'organization.register' });
    const items = within(within(register).getAllByRole('list')[0]!).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('value'))).toEqual(['1', '2']);
    expect(items[0]?.getAttribute('data-hook')).toBe('acme_erp#write-erp-code');
    await waitFor(() => expect(within(items[0]!).getByText('Acme ERP')).toBeTruthy());
  });

  it('offers Try again when the plan fails to load', async () => {
    let calls = 0;
    planAnswer = async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(500, { error: { code: 'INTERNAL', message: 'The plan could not be read.' } });
      return PLAN;
    };
    renderPage('plan');
    await screen.findByText('The plan could not be read.');
    await userEvent.click(screen.getByRole('button', { name: core('en', 'platform.commandHooks.tryAgain') }));
    expect(await screen.findByRole('region', { name: 'organization.register' })).toBeTruthy();
  });
});
