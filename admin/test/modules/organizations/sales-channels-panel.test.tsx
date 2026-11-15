import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { OrganizationSalesChannelsResponse } from '@endora-commerce/contracts';
import { adminSession, renderWithSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/154-sales-channel-access/` T062 — the Organization's *Sales channels*
 * panel (contracts/admin-api-and-ui.md §2, US5).
 *
 * The stores an Organization's members may sign in and shop on, edited on the
 * Organization's own page with the customer permissions: every channel offered,
 * an inactive one suffixed and the system default badged; and a read-only list
 * for an operator without `customers:manage`.
 *
 * Issue #1305 (spec 180 FR-061, SC-001; `module-admin-surfaces.md` FR-083 §4):
 * the panel is an immediate action, so a tick writes the whole set at once — no
 * draft and no Save of its own beside the page's one Save. A failed write puts
 * the tick back; the last channel cannot be unticked, and says why; and no
 * second write starts while one is in flight.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { SalesChannelsPanel } = await import(
  '../../../../packages/modules/organizations/src/admin/panels/SalesChannelsPanel'
);

const enPath = resolve(process.cwd(), '../packages/modules/organizations/i18n/en.json');
const en = JSON.parse(readFileSync(enPath, 'utf8')) as Record<string, string>;
const pl = JSON.parse(readFileSync(enPath.replace('en.json', 'pl.json'), 'utf8')) as Record<
  string,
  string
>;
const coreEn = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: coreEn, organizations: en };

const ORG = '00000000-0000-4000-8000-0000000000aa';
const RETAIL = '00000000-0000-4000-8000-00000000c001';
const TRADE = '00000000-0000-4000-8000-00000000c002';
const ARCHIVE = '00000000-0000-4000-8000-00000000c003';

function response(assigned: string[]): OrganizationSalesChannelsResponse {
  return {
    data: {
      organizationId: ORG,
      assignedSalesChannelIds: assigned,
      options: [
        { id: RETAIL, code: 'retail', name: { 'en-US': 'Retail' }, active: true, systemDefault: true },
        { id: TRADE, code: 'trade', name: { 'en-US': 'Trade' }, active: true, systemDefault: false },
        { id: ARCHIVE, code: 'archive', name: { 'en-US': 'Archive' }, active: false, systemDefault: false },
      ],
    },
  };
}

function renderPanel(permissions: readonly string[]) {
  return renderWithSession(
    <StrictMode>
      <SalesChannelsPanel organizationId={ORG} />
    </StrictMode>,
    { session: adminSession({ permissions }), bundle },
  );
}

function box(name: RegExp): HTMLInputElement {
  return screen.getByRole('checkbox', { name });
}

/** Resolves the next `PUT` when called; the panel is held mid-write until then. */
function deferredPut(): { resolve: (value: unknown) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  putSpy.mockImplementationOnce(
    () =>
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return {
    resolve: (value) => resolve(value),
    reject: (reason) => reject(reason),
  };
}

const URL = `/api/v1/admin/organizations/${ORG}/sales-channels`;

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockResolvedValue(response([RETAIL]));
});

describe('bundle', () => {
  it('ships the panel keys in English and Polish', () => {
    for (const key of [
      'salesChannels.title',
      'salesChannels.description',
      'salesChannels.atLeastOne',
      'salesChannels.inactiveSuffix',
      'salesChannels.systemDefault',
      'salesChannels.adding',
      'salesChannels.removing',
      'salesChannels.added',
      'salesChannels.removed',
      'salesChannels.toggleError',
    ]) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
    expect(en['salesChannels.atLeastOne']).toBe(
      'An organization must be assigned at least one sales channel.',
    );
  });
});

describe('SalesChannelsPanel — with customers:manage', () => {
  it('offers every channel, the inactive one suffixed and the default badged', async () => {
    const { container } = renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${ORG}/sales-channels`);
    expect(box(/Trade/).checked).toBe(false);
    const archive = box(/Archive/);
    expect(archive.labels?.[0]?.textContent).toContain(en['salesChannels.inactiveSuffix']);
    expect(box(/Retail/).closest('[data-sales-channel-option]')?.textContent).toContain(en['salesChannels.systemDefault']);
    expect(box(/Trade/).closest('[data-sales-channel-option]')?.textContent).not.toContain(en['salesChannels.systemDefault']);
    await expectNoAxeViolations(container);
  });

  it('offers no Save of its own and keeps the Applies immediately badge', async () => {
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.getByText(en['salesChannels.title']!).textContent).toContain(coreEn['saveSession.immediateBadge']);
  });

  it('writes the whole set once, on the tick, and shows what the server stored', async () => {
    putSpy.mockResolvedValue(response([RETAIL, TRADE]));
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    fireEvent.click(box(/Trade/));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy).toHaveBeenCalledWith(URL, { salesChannelIds: [RETAIL, TRADE] });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        en['salesChannels.added']!.replace('{channel}', 'Trade (trade)'),
      ),
    );
    expect(box(/Trade/).checked).toBe(true);
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it('removes a channel on the untick', async () => {
    getSpy.mockResolvedValue(response([RETAIL, TRADE]));
    putSpy.mockResolvedValue(response([TRADE]));
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    fireEvent.click(box(/Retail/));
    await waitFor(() => expect(putSpy).toHaveBeenCalledWith(URL, { salesChannelIds: [TRADE] }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        en['salesChannels.removed']!.replace('{channel}', 'Retail (retail)'),
      ),
    );
    expect(box(/Retail/).checked).toBe(false);
  });

  it('shows the write in flight on its channel and starts no second write meanwhile', async () => {
    const put = deferredPut();
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    fireEvent.click(box(/Trade/));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(box(/Trade/).checked).toBe(true);
    expect(box(/Trade/).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(
      en['salesChannels.adding']!.replace('{channel}', 'Trade (trade)'),
    );
    // Every box waits for the write in flight, so no two writes race. They stay focusable
    // (aria-disabled, not disabled), so the focus is not thrown off the box just ticked.
    expect(box(/Archive/).getAttribute('aria-disabled')).toBe('true');
    expect(box(/Archive/).disabled).toBe(false);
    fireEvent.click(box(/Archive/));
    expect(box(/Archive/).checked).toBe(false);
    fireEvent.click(box(/Trade/));
    expect(putSpy).toHaveBeenCalledTimes(1);
    put.resolve(response([RETAIL, TRADE]));
    await waitFor(() => expect(box(/Archive/).getAttribute('aria-disabled')).toBeNull());
    expect(box(/Trade/).getAttribute('aria-busy')).toBeNull();
  });

  it('puts the tick back and says why when the write fails', async () => {
    const put = deferredPut();
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    fireEvent.click(box(/Trade/));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
      '@endora-commerce/admin-kit/lib',
    );
    put.reject(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'Unknown sales channel.', requestId: 'req_1305' } }),
    );
    await waitFor(() => expect(box(/Trade/).checked).toBe(false));
    expect(box(/Retail/).checked).toBe(true);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(en['salesChannels.toggleError']!.replace('{channel}', 'Trade (trade)'));
    expect(alert.textContent).toContain('Unknown sales channel.');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('refuses to untick the last channel, says why, and writes nothing', async () => {
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    expect(screen.queryByText(en['salesChannels.atLeastOne']!)).toBeNull();
    fireEvent.click(box(/Retail/));
    expect(box(/Retail/).checked).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(en['salesChannels.atLeastOne']);
    expect(putSpy).not.toHaveBeenCalled();
  });
});

describe('SalesChannelsPanel — read only', () => {
  it('lists the assigned channels without controls for customers:read', async () => {
    getSpy.mockResolvedValue(response([RETAIL, ARCHIVE]));
    const { container } = renderPanel(['customers:read']);
    await waitFor(() => expect(screen.getByText(/Retail/)).toBeTruthy());
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Archive/).textContent).toContain(en['salesChannels.inactiveSuffix']);
    expect(screen.queryByText(/Trade/)).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('the host', () => {
  it('renders the panel on the Organization page, and sales_channels no longer contributes there', async () => {
    const host = readFileSync(
      resolve(process.cwd(), '../packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx'),
      'utf8',
    );
    expect(host).toContain('<SalesChannelsPanel organizationId={org.id} />');
    expect(host).not.toContain('EntityChannelMembership');
    const salesChannels = await import('@endora-commerce/mod-sales-channels/admin');
    expect(
      (salesChannels.contributions.zones ?? []).some((zone) => zone.zone === 'organization.detail.after'),
    ).toBe(false);
  });
});
