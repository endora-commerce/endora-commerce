import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OrganizationMergePreview, OrganizationMergeView } from '@endora-commerce/contracts';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/192-organization-merge/` T074, T075 (FR-080 – FR-083;
 * `contracts/organization-merge.md` §5) — the operator's merge flow: choosing
 * the duplicate, the preview with its refusals, the incomplete-participation
 * notice, the value choices and the irreversible acknowledgement; the progress
 * view with resume and cancel; the attention list; the archived loser's banner;
 * the palette actions and the routes.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: (...a: unknown[]) => postSpy(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrganizationMergeFlow } = await import('../../../../packages/modules/organizations/src/admin/merge/OrganizationMergeFlow');
const { OrganizationMergePage } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationMergePage');
const { OrganizationMergesPage } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationMergesPage');
const { MergedBanner } = await import('../../../../packages/modules/organizations/src/admin/merge/MergedBanner');
const { contributions } = await import('../../../../packages/modules/organizations/src/admin/index');
const { manifest } = await import('../../../../packages/modules/organizations/src/manifest');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/organizations/i18n/en.json');
const PL = read('../packages/modules/organizations/i18n/pl.json');
const CORE = read('../packages/modules/_i18n/i18n/en.json');

const SURVIVOR = '00000000-0000-4000-8000-0000000000a1';
const LOSER = '00000000-0000-4000-8000-0000000000a2';
const MERGE = '00000000-0000-4000-8000-0000000000a3';

function merge(overrides: Partial<OrganizationMergeView> = {}): OrganizationMergeView {
  return {
    id: MERGE,
    hostType: 'organization',
    survivorId: SURVIVOR,
    loserId: LOSER,
    state: 'running',
    version: 3,
    source: null,
    actorKind: 'admin',
    actorAdminUserId: '00000000-0000-4000-8000-0000000000a4',
    startedAt: '2026-11-25T10:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    needsAttentionAt: null,
    lastErrorCode: null,
    fieldChoices: {},
    customFieldChoices: {},
    steps: [
      { moduleId: 'organizations', key: 'host-structure', phase: 'structure', state: 'done', movedCount: 2, deferredReason: null, lastErrorCode: null, trailing: false },
      { moduleId: 'orders', key: 'orders', phase: 'records', state: 'pending', movedCount: 0, deferredReason: null, lastErrorCode: null, trailing: false },
    ],
    survivorName: 'Acme S.A.',
    loserName: 'ACME (import)',
    actorName: 'Anna Nowak',
    ...overrides,
  };
}

function preview(overrides: Partial<OrganizationMergePreview> = {}): OrganizationMergePreview {
  return {
    refusals: [],
    fields: [
      { code: 'legalName', survivor: 'Acme Spółka Akcyjna', loser: 'ACME S.A.', default: 'survivor' },
      { code: 'taxId', survivor: null, loser: '5260250995', default: 'loser' },
    ],
    customFields: [],
    participants: [
      { moduleId: 'orders', key: 'orders', phase: 'records', counts: { 'Order.organizationId': 12 }, conflicts: [], warnings: [{ code: 'credit_over_limit' }] },
      {
        moduleId: 'api_keys',
        key: 'api-keys',
        phase: 'configuration',
        counts: { 'ApiKey.organizationId': 2 },
        conflicts: [],
        warnings: [{ code: 'API_KEY_BOUND_KEYS_REPOINTED', details: { count: 2, ids: ['k1', 'k2'] } }],
      },
    ],
    incomplete: [],
    ...overrides,
  };
}

function render(ui: React.ReactElement, path: string, routePath: string, permissions: string[] = ['*']): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={ui} />
            <Route path="/organizations/merges/:mergeId" element={<p>progress page</p>} />
            <Route path="/organizations/:id" element={<p>organization page</p>} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
    ),
    { core: CORE, organizations: EN, orders: { 'module.name': 'Orders' } },
  );
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/organizations?')) {
      const data = [{ id: LOSER, name: 'ACME (import)', legalName: null, status: 'active' }];
      return { data, meta: { page: 1, pageSize: 20, total: 1 }, pagination: { cursor: null, hasMore: false, limit: 25 } };
    }
    return { data: [] };
  });
});

function renderFlow(onStarted = vi.fn()): ReturnType<typeof renderWithI18n> {
  return render(
    <OrganizationMergeFlow survivorId={SURVIVOR} survivorName="Acme S.A." onCancel={vi.fn()} onStarted={onStarted} />,
    '/flow',
    '/flow',
  );
}

async function pickDuplicate(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: EN['merge.flow.picker']! }));
  await user.click(await screen.findByRole('option', { name: /ACME \(import\)/ }));
  fireEvent.click(screen.getByRole('button', { name: EN['merge.flow.next']! }));
}

describe('the merge flow', () => {
  it('shows its three steps and keeps Next disabled until a duplicate is chosen', () => {
    renderFlow();
    for (const key of ['merge.flow.step.choose', 'merge.flow.step.review', 'merge.flow.step.confirm']) {
      expect(screen.getByText(EN[key]!)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: EN['merge.flow.next']! })).toBeDisabled();
  });

  it('previews the pair: what moves, the warnings and the values that differ, with the defaults chosen', async () => {
    postSpy.mockResolvedValueOnce({ data: preview() });
    const user = userEvent.setup();
    renderFlow();
    await pickDuplicate(user);
    expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${SURVIVOR}/merge-preview`, { loserId: LOSER });
    expect(await screen.findByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // A warning code nobody translated shows as itself; a translated one in words.
    expect(screen.getByText('credit_over_limit')).toBeInTheDocument();
    expect(
      screen.getByText(EN['merge.warning.API_KEY_BOUND_KEYS_REPOINTED']!.replace('{count}', '2')),
    ).toBeInTheDocument();
    const legal = screen.getByRole('radiogroup', { name: EN['merge.field.legalName']! });
    expect(within(legal).getByRole('radio', { name: /Acme Spółka Akcyjna/ })).toBeChecked();
    const tax = screen.getByRole('radiogroup', { name: EN['merge.field.taxId']! });
    expect(within(tax).getByRole('radio', { name: /5260250995/ })).toBeChecked();
  });

  it('says clearly that the start waits for modules that cannot move their records yet, and offers no way on', async () => {
    postSpy.mockResolvedValueOnce({
      data: preview({
        refusals: [{ code: 'RECORD_MERGE_PARTICIPATION_INCOMPLETE', details: { modules: ['orders', 'crm'] } }],
        incomplete: ['orders', 'crm'],
      }),
    });
    const user = userEvent.setup();
    renderFlow();
    await pickDuplicate(user);
    expect(await screen.findByText(EN['merge.flow.incomplete.title']!)).toBeInTheDocument();
    expect(screen.getByText(/Orders, crm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['merge.flow.next']! })).toBeDisabled();
  });

  it('shows a refusal in words, not as a code', async () => {
    postSpy.mockResolvedValueOnce({
      data: preview({ refusals: [{ code: 'ORGANIZATION_MERGE_TREE_INVALID', details: { code: 'ancestor' } }], fields: [], participants: [] }),
    });
    const user = userEvent.setup();
    renderFlow();
    await pickDuplicate(user);
    expect(await screen.findByText(EN['errors.ORGANIZATION_MERGE_TREE_INVALID.ancestor']!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['merge.flow.next']! })).toBeDisabled();
  });

  it('starts only after the irreversible acknowledgement, sending the chosen values', async () => {
    postSpy.mockResolvedValueOnce({ data: preview() });
    postSpy.mockResolvedValueOnce({ data: merge() });
    const onStarted = vi.fn();
    const user = userEvent.setup();
    renderFlow(onStarted);
    await pickDuplicate(user);
    const legal = await screen.findByRole('radiogroup', { name: EN['merge.field.legalName']! });
    await user.click(within(legal).getByRole('radio', { name: /ACME S\.A\./ }));
    fireEvent.click(screen.getByRole('button', { name: EN['merge.flow.next']! }));
    const start = screen.getByRole('button', { name: EN['merge.flow.start']! });
    expect(start).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: EN['merge.flow.acknowledge']! }));
    expect(start).toBeEnabled();
    await user.click(start);
    await waitFor(() =>
      expect(postSpy).toHaveBeenLastCalledWith(`/api/v1/admin/organizations/${SURVIVOR}/merges`, {
        loserId: LOSER,
        fieldChoices: { legalName: 'loser', taxId: 'loser' },
        customFieldChoices: {},
        acknowledgeIrreversible: true,
      }),
    );
    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: MERGE }));
  });

  it('has no axe violations', async () => {
    const { container } = renderFlow();
    await expectNoAxeViolations(container);
  });
});

describe('the progress view', () => {
  it('shows the phases, the steps and how far the merge is', async () => {
    getSpy.mockResolvedValue({ data: merge() });
    render(<OrganizationMergePage />, `/organizations/merges/${MERGE}`, '/organizations/merges/:mergeId');
    expect(await screen.findByRole('heading', { level: 1, name: /ACME \(import\).*Acme S\.A\./ })).toBeInTheDocument();
    expect(screen.getByText(EN['merge.phase.structure']!)).toBeInTheDocument();
    expect(screen.getByText(EN['merge.phase.records']!)).toBeInTheDocument();
    expect(screen.getByText(EN['merge.phase.finalize']!)).toBeInTheDocument();
    expect(screen.getByText(EN['merge.step.hostStructure']!)).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText(EN['merge.progress.count']!.replace('{done}', '1').replace('{total}', '3'))).toBeInTheDocument();
    // Nothing moved by a participant yet — but the host's structure did, so no cancel.
    expect(screen.queryByRole('button', { name: EN['merge.action.cancel']! })).toBeNull();
  });

  it('resumes a merge that needs attention', async () => {
    const stuck = merge({
      state: 'needs_attention',
      lastErrorCode: 'DB_TIMEOUT',
      needsAttentionAt: '2026-11-25T10:03:00.000Z',
      steps: [{ moduleId: 'orders', key: 'orders', phase: 'records', state: 'failed', movedCount: 4, deferredReason: null, lastErrorCode: 'DB_TIMEOUT', trailing: false }],
    });
    getSpy.mockResolvedValue({ data: stuck });
    postSpy.mockResolvedValue({ data: merge({ version: 4 }) });
    render(<OrganizationMergePage />, `/organizations/merges/${MERGE}`, '/organizations/merges/:mergeId');
    expect(await screen.findByText(EN['merge.attention.title']!)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: EN['merge.action.resume']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organization-merges/${MERGE}/resume`, { expectedVersion: 3 }));
  });

  it('cancels a merge before any record moved, after confirming', async () => {
    getSpy.mockResolvedValue({
      data: merge({ steps: [{ moduleId: 'orders', key: 'orders', phase: 'records', state: 'pending', movedCount: 0, deferredReason: null, lastErrorCode: null, trailing: false }] }),
    });
    postSpy.mockResolvedValue({ data: merge({ state: 'cancelled' }) });
    const user = userEvent.setup();
    render(<OrganizationMergePage />, `/organizations/merges/${MERGE}`, '/organizations/merges/:mergeId');
    // In "More", away from the primary (Von Restorff); it asks first.
    fireEvent.pointerDown(await screen.findByRole('button', { name: CORE['common.action.more']! }), { button: 0, ctrlKey: false });
    await user.click(await screen.findByRole('menuitem', { name: EN['merge.action.cancel']! }));
    await user.click(await screen.findByRole('button', { name: EN['merge.cancel.confirm']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organization-merges/${MERGE}/cancel`, { expectedVersion: 3 }));
  });

  it('offers no resume to an operator without organizations:merge', async () => {
    getSpy.mockResolvedValue({ data: merge({ state: 'needs_attention' }) });
    render(<OrganizationMergePage />, `/organizations/merges/${MERGE}`, '/organizations/merges/:mergeId', ['customers:read']);
    expect(await screen.findByText(EN['merge.attention.title']!)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['merge.action.resume']! })).toBeNull();
  });
});

describe('the attention list', () => {
  it('lists the merges that need attention by default, with a resume on each', async () => {
    getSpy.mockResolvedValue({ data: [merge({ state: 'needs_attention' })] });
    postSpy.mockResolvedValue({ data: merge() });
    render(<OrganizationMergesPage />, '/organizations/merges', '/organizations/merges');
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/organization-merges?state=needs_attention'));
    expect((await screen.findAllByText(/ACME \(import\)/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(EN['merge.action.resume']!) })[0]!);
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organization-merges/${MERGE}/resume`, { expectedVersion: 3 }));
  });

  it('says when nothing needs attention', async () => {
    getSpy.mockResolvedValue({ data: [] });
    render(<OrganizationMergesPage />, '/organizations/merges', '/organizations/merges');
    expect(await screen.findByText(EN['merge.list.empty.title']!)).toBeInTheDocument();
  });
});

describe('the archived loser', () => {
  it('says into which organization it was merged, when and by whom, and leads there', async () => {
    getSpy.mockResolvedValue({ data: merge({ state: 'completed', completedAt: '2026-11-25T10:05:00.000Z' }) });
    render(
      <MergedBanner survivorId={SURVIVOR} mergeId={MERGE} mergedAt="2026-11-25T10:05:00.000Z" />,
      '/banner',
      '/banner',
    );
    const link = await screen.findByRole('link', { name: 'Acme S.A.' });
    expect(link.getAttribute('href')).toBe(`/organizations/${SURVIVOR}`);
    expect(screen.getByText(/Anna Nowak/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: EN['merge.banner.viewMerge']! }).getAttribute('href')).toBe(`/organizations/merges/${MERGE}`);
  });
});

describe('routes, palette and permission', () => {
  it('declares the merge screens ahead of /:id under the codes their APIs enforce', () => {
    const routes = contributions.routes ?? [];
    const index = (path: string): number => routes.findIndex((r) => r.path === path);
    expect(routes[index('/organizations/merge')]?.requiredPermission).toBe('organizations:merge');
    expect(routes[index('/organizations/merges')]?.requiredPermission).toBe('organizations:merge');
    expect(routes[index('/organizations/merges/:mergeId')]?.requiredPermission).toEqual(['customers:read', 'customers:manage']);
    for (const path of ['/organizations/merge', '/organizations/merges', '/organizations/merges/:mergeId']) {
      expect(index(path)).toBeGreaterThanOrEqual(0);
      expect(index(path)).toBeLessThan(index('/organizations/:id'));
    }
  });

  it('offers merge-organizations and open-record-merges under organizations:merge, labelled in both languages', () => {
    expect(manifest.actions?.find((a) => a.id === 'merge-organizations')).toMatchObject({
      targetRoute: '/organizations/merge',
      requiredPermission: 'organizations:merge',
    });
    expect(manifest.actions?.find((a) => a.id === 'open-record-merges')).toMatchObject({
      targetRoute: '/organizations/merges',
      requiredPermission: 'organizations:merge',
    });
    for (const bundle of [EN, PL]) {
      for (const action of ['mergeOrganizations', 'openRecordMerges']) {
        for (const key of ['label', 'description', 'keywords']) expect(bundle[`actions.${action}.${key}`]).toEqual(expect.any(String));
      }
      expect(bundle['adminRoles.permission.organizations:merge']).toEqual(expect.any(String));
    }
    expect(manifest.permissions?.find((p) => p.code === 'organizations:merge')).toBeDefined();
  });

  it('ships every merge string in Polish as well as English', () => {
    const missing = Object.keys(EN).filter((key) => (key.startsWith('merge.') || key.startsWith('notifications.merge.')) && PL[key] === undefined);
    expect(missing).toEqual([]);
  });
});
