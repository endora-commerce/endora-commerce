import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomFieldListFilterField } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { WORKFLOW, crmLookupResponse, renderCrm, summary } from './crm-fixtures';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1505 (UX audit 2026-11-17, WORK-05) — the Opportunities list's
 * filters are the kit `ListToolbar`: the search, the state, the status and
 * the assignee always shown; the Organization, the tags, the Sales Channel,
 * the creation range and every custom-field filter behind *More filters*,
 * which counts those in use while it is closed. This replaces feature 157's
 * owner ruling U1 A (the first three custom fields always open, an active
 * later one promoted beside them): the count, not the field, now says a
 * folded filter is in use.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OpportunitiesList } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunitiesList'
);

const LIST_PATH = '/api/v1/admin/crm/opportunities';
const OFFERED_PATH = '/api/v1/admin/crm/opportunities/custom-field-filters';

const NAMES = ['Region', 'Fleet size', 'Industry', 'Source', 'Partner', 'Tier'] as const;

function textField(index: number): CustomFieldListFilterField {
  const name = NAMES[index]!;
  return {
    key: `field_${index + 1}`,
    valueType: 'text',
    label: { en: name, pl: `${name} PL` },
    labelDefault: name,
    options: [],
  };
}

const SIX = NAMES.map((_, index) => textField(index));

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === OFFERED_PATH) return Promise.resolve({ data: SIX });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return Promise.resolve({ data: [summary()], pagination: { cursor: null, hasMore: false, limit: 20 } });
    }
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The kit commits a typed filter after a 300 ms pause. A test that waits for
 * that commit on real timers spends the pause plus every `waitFor` poll under
 * StrictMode, which a loaded CI runner stretched past the 5 s test timeout.
 * So the pause is stepped over instead of waited for.
 *
 * Install the fake timers only after the page has rendered and its first
 * `findBy*` has resolved on real timers: installed before `renderList()`, the
 * typed change was observed to be lost (the input kept its old value and no
 * commit followed). `shouldAdvanceTime` keeps the faked clock following the
 * wall clock, because `waitFor` polls on the global `setTimeout`, which vitest
 * fakes — without it the `waitFor` after the step would never poll.
 */
function installSteppedTimers(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
}

async function stepPastCommitPause(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

function renderList(path = '/crm/opportunities', language: 'en' | 'pl' = 'en'): ReturnType<typeof renderCrm> {
  return renderCrm(
    <StrictMode>
      <OpportunitiesList />
    </StrictMode>,
    { path, language },
  );
}

function shownLabels(): string[] {
  return NAMES.filter((name) => screen.queryByLabelText(name) !== null);
}

function lastListQuery(): URLSearchParams {
  const path = getSpy.mock.calls
    .map(([called]) => called as string)
    .filter((called) => called === LIST_PATH || called.startsWith(`${LIST_PATH}?`))
    .at(-1)!;
  return new URLSearchParams(path.split('?')[1] ?? '');
}

describe('OpportunitiesList — More filters (issue #1505)', () => {
  it('shows the search, the state, the status and the assignee, and folds the rest away', async () => {
    renderList();
    const more = await screen.findByRole('button', { name: 'More filters' });
    expect(screen.getByRole('search', { name: 'Filter opportunities' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'State' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Organization')).toBeNull();
    expect(screen.queryByLabelText('Sales channel')).toBeNull();
    expect(shownLabels()).toEqual([]);
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const controlled = more.getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    expect(document.getElementById(controlled!)).not.toBeNull();
  });

  it('shows the folded filters and every custom field once expanded, and none once collapsed', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'More filters' }));
    const fewer = screen.getByRole('button', { name: 'Fewer filters' });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Organization')).toBeInTheDocument();
    expect(screen.getByLabelText('Sales channel')).toBeInTheDocument();
    await waitFor(() => expect(shownLabels()).toEqual([...NAMES]));
    fireEvent.click(fewer);
    expect(screen.getByRole('button', { name: 'More filters' })).toHaveAttribute('aria-expanded', 'false');
    expect(shownLabels()).toEqual([]);
  });

  it('counts an active folded filter while collapsed, and still sends it', async () => {
    renderList('/crm/opportunities?cf.field_5.contains=acme');
    const more = await screen.findByRole('button', { name: 'More filters (1)' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(shownLabels()).toEqual([]);
    await waitFor(() =>
      expect(JSON.parse(lastListQuery().get('fieldFilters') ?? 'null')).toEqual({
        'custom:field_5': { contains: 'acme' },
      }),
    );
    fireEvent.click(more);
    expect(await screen.findByLabelText('Partner')).toHaveValue('acme');
  });

  it('counts a filter set in the panel once the panel is closed', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'More filters' }));
    const tier = await screen.findByLabelText('Tier');
    installSteppedTimers();
    fireEvent.change(tier, { target: { value: 'gold' } });
    await stepPastCommitPause();
    await waitFor(() =>
      expect(JSON.parse(lastListQuery().get('fieldFilters') ?? 'null')).toEqual({
        'custom:field_6': { contains: 'gold' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fewer filters' }));
    expect(screen.getByRole('button', { name: 'More filters (1)' })).toBeInTheDocument();
  });

  it('clears a filter cleared the moment it appears (#524)', async () => {
    // The field mounts when the panel opens; clearing it in that very commit,
    // before its passive effects run, once lost the clear.
    renderList('/crm/opportunities?cf.field_5.contains=acme');
    const more = await screen.findByRole('button', { name: 'More filters (1)' });
    const cleared = new Promise<HTMLInputElement>((resolve) => {
      const observer = new MutationObserver(() => {
        const input = document.getElementById('crm-opportunity-cf-field_5');
        if (!(input instanceof HTMLInputElement)) return;
        observer.disconnect();
        installSteppedTimers();
        fireEvent.change(input, { target: { value: '' } });
        resolve(input);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    fireEvent.click(more);
    const partner = await cleared;
    await stepPastCommitPause();
    await waitFor(() => expect(lastListQuery().get('fieldFilters')).toBeNull());
    expect(partner).toHaveValue('');
    expect(screen.getByLabelText('Partner')).toBe(partner);
  });

  it('keeps focus on the toggle as it opens and closes from the keyboard', async () => {
    const user = userEvent.setup();
    renderList();
    const more = await screen.findByRole('button', { name: 'More filters' });
    expect(more.tagName).toBe('BUTTON');
    expect(more).toHaveAttribute('type', 'button');
    more.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Fewer filters' })).toHaveFocus();
    await waitFor(() => expect(shownLabels()).toEqual([...NAMES]));
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'More filters' })).toHaveFocus();
    expect(shownLabels()).toEqual([]);
  });

  it('clears every filter, the folded ones included, and returns focus to the search', async () => {
    const user = userEvent.setup();
    renderList('/crm/opportunities?cf.field_5.contains=acme');
    await screen.findByRole('button', { name: 'More filters (1)' });
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    await waitFor(() => expect(lastListQuery().get('fieldFilters')).toBeNull());
    expect(screen.getByRole('button', { name: 'More filters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveFocus();
  });

  it('has no axe violations collapsed or expanded', async () => {
    const { container } = renderList();
    await screen.findByRole('button', { name: 'More filters' });
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    await screen.findByLabelText('Tier');
    await expectNoAxeViolations(container);
  });

  it('speaks Polish', async () => {
    renderList('/crm/opportunities?cf.field_5.contains=acme', 'pl');
    fireEvent.click(await screen.findByRole('button', { name: 'Więcej filtrów (1)' }));
    expect(screen.getByRole('button', { name: 'Mniej filtrów' })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByLabelText('Tier PL')).toBeInTheDocument();
    expect(screen.getByRole('search', { name: 'Filtruj szanse sprzedażowe' })).toBeInTheDocument();
  });
});
