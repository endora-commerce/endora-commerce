import { useCallback, type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { RecordHistoryEntry } from '@endora-commerce/contracts';
import {
  CursorPagination,
  RecordHistory,
  recordHistoryChanges,
  useRecordHistory,
  type RecordHistoryCopy,
  type RecordHistoryPageShape,
} from '@endora-commerce/admin-kit/components';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, withSession } from '../helpers/render-with-session';

/**
 * A record's change history and the cursor pager, promoted from CRM into the
 * kit (`specs/163-projects-and-tasks/` research R-17; T099). The history knows
 * no record: what an entry is called, what a field is called and how a value
 * reads are **injected** — CRM's `OpportunityHistory`, Projects' and Tasks'
 * histories each pass their own.
 */

const CORE: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function core(key: string, params: Record<string, string | number> = {}): string {
  const template = CORE[key];
  if (template === undefined) throw new Error(`the shipped core bundle has no key "${key}"`);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

function entry(n: number, overrides: Partial<RecordHistoryEntry> = {}): RecordHistoryEntry {
  return {
    id: `entry-${n}`,
    actedAt: '2026-10-05T10:00:00.000Z',
    action: 'project.update',
    actor: { kind: 'admin', id: 'a1', name: 'Ada Min' },
    before: { title: `Title ${n - 1}`, version: n - 1 },
    after: { title: `Title ${n}`, version: n },
    references: [],
    ...overrides,
  };
}

const loadPage = vi.fn<(cursor: string | null) => Promise<RecordHistoryPageShape<RecordHistoryEntry>>>();

beforeEach(() => {
  loadPage.mockReset();
});

const COPY = {
  hint: 'Everything done to this project.',
  empty: 'Nothing recorded for this project yet.',
  end: 'That is the whole history of this project.',
  truncated: 'This project has earlier changes that are not shown.',
};

function History(props: {
  renderLead?: (entry: RecordHistoryEntry) => ReactNode;
  copy?: RecordHistoryCopy;
}): ReactElement {
  const load = useCallback((cursor: string | null) => loadPage(cursor), []);
  const history = useRecordHistory(load, 'v1');
  return (
    <RecordHistory
      history={history}
      copy={props.copy ?? COPY}
      heading={(item): string => `Heading of ${item.action}`}
      changes={(item) => recordHistoryChanges(item, new Set(['version']))}
      fieldLabel={(field): string => `Label of ${field}`}
      renderValue={(_field, raw): ReactNode => `«${String(raw)}»`}
      {...(props.renderLead ? { renderLead: props.renderLead } : {})}
    />
  );
}

function mount(ui: ReactElement): void {
  renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter>{ui}</MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions: ['*'] }) }),
    { core: CORE },
  );
}

describe('recordHistoryChanges', () => {
  it('lists what an edit changed, what a creation arrived with, and what a removal had — silent fields left out', () => {
    expect(recordHistoryChanges({ before: { a: 1, b: 2, v: 1 }, after: { a: 1, b: 3, v: 2 } }, new Set(['v']))).toEqual([
      { field: 'b', before: 2, after: 3 },
    ]);
    expect(recordHistoryChanges({ before: null, after: { title: 'T', note: null, empty: '' } })).toEqual([
      { field: 'title', after: 'T' },
    ]);
    expect(recordHistoryChanges({ before: { fileName: 'a.pdf' }, after: null })).toEqual([
      { field: 'fileName', after: 'a.pdf' },
    ]);
  });
});

describe('RecordHistory', () => {
  it('shows each entry as its injected heading, who and when, and its changes in the injected words', async () => {
    loadPage.mockResolvedValue({ data: [entry(2)], pagination: { hasMore: false, cursor: null }, truncated: false });
    mount(<History renderLead={(item) => <p>Lead of {item.id}</p>} />);
    const list = await screen.findByRole('list', { name: core('history.title') });
    const item = within(list).getByRole('listitem');
    expect(within(item).getByRole('heading', { level: 3, name: 'Heading of project.update' })).toBeInTheDocument();
    expect(item).toHaveTextContent('Ada Min');
    expect(item).toHaveTextContent('Lead of entry-2');
    expect(within(item).getByText('Label of title')).toBeInTheDocument();
    expect(item).toHaveTextContent('«Title 1»');
    expect(item).toHaveTextContent('«Title 2»');
    expect(item).toHaveTextContent(core('history.status.from'));
    expect(item).not.toHaveTextContent('version');
    expect(screen.getByText(COPY.hint)).toBeInTheDocument();
    expect(screen.getByText(COPY.end)).toBeInTheDocument();
  });

  it('draws no lead paragraph when the record gives no hint (#1487)', async () => {
    loadPage.mockResolvedValue({ data: [entry(2)], pagination: { hasMore: false, cursor: null }, truncated: false });
    const { hint: _hint, ...withoutHint } = COPY;
    mount(<History copy={withoutHint} />);
    await screen.findByRole('list', { name: core('history.title') });
    expect(screen.queryByText(COPY.hint)).toBeNull();
    expect(document.querySelectorAll('p.max-w-prose')).toHaveLength(0);
  });

  it('names the system and a former administrator, never an id', async () => {
    loadPage.mockResolvedValue({
      data: [
        entry(2, { actor: { kind: 'system', id: null, name: null } }),
        entry(1, { id: 'entry-1b', actor: { kind: 'admin', id: 'gone', name: null } }),
      ],
      pagination: { hasMore: false, cursor: null },
      truncated: false,
    });
    mount(<History />);
    const items = within(await screen.findByRole('list', { name: core('history.title') })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(core('history.actor.system'));
    expect(items[1]).toHaveTextContent(core('history.actor.deleted'));
  });

  it('appends the next page under the ones read, says so, and ends with the truncation sentence', async () => {
    loadPage
      .mockResolvedValueOnce({ data: [entry(3)], pagination: { hasMore: true, cursor: 'c2' }, truncated: false })
      .mockResolvedValueOnce({ data: [entry(2)], pagination: { hasMore: false, cursor: null }, truncated: true });
    mount(<History />);
    await screen.findByRole('list', { name: core('history.title') });
    await userEvent.click(screen.getByRole('button', { name: core('history.more') }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(loadPage).toHaveBeenLastCalledWith('c2');
    expect(screen.getByText(core('history.loadedMore', { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(COPY.truncated)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: core('history.more') })).toBeNull();
  });

  it('says it is empty in the words it was given', async () => {
    loadPage.mockResolvedValue({ data: [], pagination: { hasMore: false, cursor: null }, truncated: false });
    mount(<History />);
    expect(await screen.findByText(COPY.empty)).toBeInTheDocument();
  });

  it('says the history could not be read, and reads it again on Retry', async () => {
    loadPage
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ data: [], pagination: { hasMore: false, cursor: null }, truncated: false });
    mount(<History />);
    expect(await screen.findByText(core('history.error.load'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core('common.action.retry') }));
    expect(await screen.findByText(COPY.empty)).toBeInTheDocument();
  });
});

describe('CursorPagination', () => {
  it('says the page it is on, offers only the sizes the endpoint serves, and pages both ways', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onPageSizeChange = vi.fn();
    mount(
      <CursorPagination
        page={2}
        pageSize={20}
        maxPageSize={50}
        hasPrevious
        hasNext={false}
        onPageSizeChange={onPageSizeChange}
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );
    const nav = screen.getByRole('navigation', { name: core('cursorPagination.label') });
    expect(nav).toHaveTextContent(core('cursorPagination.page', { page: 2 }));
    const sizes = within(nav)
      .getAllByRole('option')
      .map((option) => Number((option as HTMLOptionElement).value));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(50);
    expect(screen.getByRole('button', { name: core('common.pagination.next') })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: core('common.pagination.previous') }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    await userEvent.selectOptions(within(nav).getByRole('combobox'), String(sizes[0]));
    expect(onPageSizeChange).toHaveBeenCalledWith(sizes[0]);
  });
});
