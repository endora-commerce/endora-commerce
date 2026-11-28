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
 * `specs/193-admin-form-extensions/` D-300.28, T100 — a start the platform's
 * field-rule check refused, on the merge screen: each refused value is marked
 * on its choice row with the rule's message (or that the admin may not change
 * the field), with *Keep the survivor's value*; the e-mail union, never a
 * choice, is shown on a read-only combined row naming its remedy.
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

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/organizations/i18n/en.json');
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


const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');

const refused = (code: 'FIELD_RULE_VIOLATION' | 'FIELD_WRITE_FORBIDDEN', details: unknown[]) =>
  new ApiError(code === 'FIELD_RULE_VIOLATION' ? 422 : 403, { error: { code, message: 'Refused.', requestId: 'r', details } } as never);

async function toConfirmAndStart(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: EN['merge.flow.next']! }));
  await user.click(screen.getByRole('checkbox', { name: EN['merge.flow.acknowledge']! }));
  await user.click(screen.getByRole('button', { name: EN['merge.flow.start']! }));
}

const NAME_PREVIEW = preview({
  fields: [{ code: 'name', survivor: 'Acme', loser: 'Acme Spolka z ograniczona odpowiedzialnoscia', default: 'survivor' }],
});

describe('a start the field rules refused (193 D-300.28)', () => {
  it('marks the refused value on its row, offers the survivor’s value, and starts again with it', async () => {
    postSpy.mockResolvedValueOnce({ data: NAME_PREVIEW });
    postSpy.mockRejectedValueOnce(refused('FIELD_RULE_VIOLATION', [{ path: 'name', code: 'too_long', message: 'At most 20 characters.' }]));
    postSpy.mockResolvedValueOnce({ data: merge() });
    const user = userEvent.setup();
    const { container } = renderFlow();
    await pickDuplicate(user);
    const row = await screen.findByRole('radiogroup', { name: EN['merge.field.name']! });
    await user.click(within(row).getByRole('radio', { name: /odpowiedzialnoscia/ }));
    await toConfirmAndStart(user);

    // Back on the review step, the refusal said beside the value it refuses.
    expect(await screen.findByText(EN['merge.flow.fieldRefused.title']!)).toBeInTheDocument();
    const chosen = within(screen.getByRole('radiogroup', { name: EN['merge.field.name']! })).getByRole('radio', { name: /odpowiedzialnoscia/ });
    expect(chosen).toHaveAttribute('aria-invalid', 'true');
    expect(chosen).toHaveAccessibleDescription('At most 20 characters.');
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: EN['merge.flow.fieldRefused.keepSurvivor']! }));
    expect(within(screen.getByRole('radiogroup', { name: EN['merge.field.name']! })).getByRole('radio', { name: /^.*Acme$/ })).toBeChecked();
    expect(screen.queryByText('At most 20 characters.')).toBeNull();
    await toConfirmAndStart(user);
    await waitFor(() =>
      expect(postSpy).toHaveBeenLastCalledWith(`/api/v1/admin/organizations/${SURVIVOR}/merges`, expect.objectContaining({ fieldChoices: { name: 'survivor' } })),
    );
  });

  it('says the admin may not change a field the start forbids', async () => {
    postSpy.mockResolvedValueOnce({ data: preview({ fields: [{ code: 'vatStatus', survivor: 'vat_payer', loser: 'vat_exempt', default: 'survivor' }] }) });
    postSpy.mockRejectedValueOnce(
      refused('FIELD_WRITE_FORBIDDEN', [{ path: 'vatStatus', permission: 'organizations:change-tax-id', reason: 'missing-permission', message: 'Forbidden.' }]),
    );
    const user = userEvent.setup();
    renderFlow();
    await pickDuplicate(user);
    const row = await screen.findByRole('radiogroup', { name: EN['merge.field.vatStatus']! });
    await user.click(within(row).getAllByRole('radio')[1]!);
    await toConfirmAndStart(user);
    expect(await screen.findByText(EN['merge.flow.fieldRefused.forbidden']!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['merge.flow.fieldRefused.keepSurvivor']! })).toBeInTheDocument();
  });

  it('shows a refused e-mail union on a read-only combined row, with the remedy that fits', async () => {
    postSpy.mockResolvedValueOnce({ data: preview() });
    postSpy.mockRejectedValueOnce(
      refused('FIELD_WRITE_FORBIDDEN', [{ path: 'orderConfirmationEmails', permission: 'acme:recipients', reason: 'missing-permission', message: 'Forbidden.' }]),
    );
    const user = userEvent.setup();
    renderFlow();
    await pickDuplicate(user);
    await screen.findByRole('radiogroup', { name: EN['merge.field.legalName']! });
    await toConfirmAndStart(user);
    const union = await screen.findByRole('group', { name: EN['merge.flow.union.label']! });
    expect(within(union).queryByRole('radio')).toBeNull();
    expect(within(union).getByText(EN['merge.flow.union.needsPermission']!.replace('{permission}', 'acme:recipients'))).toBeInTheDocument();
  });

  it('names the recipient fix for a union a rule refuses', async () => {
    postSpy.mockResolvedValueOnce({ data: preview() });
    postSpy.mockRejectedValueOnce(
      refused('FIELD_RULE_VIOLATION', [{ path: 'orderConfirmationEmails', code: 'pattern', message: 'Use the company domain.' }]),
    );
    const user = userEvent.setup();
    renderFlow();
    await pickDuplicate(user);
    await screen.findByRole('radiogroup', { name: EN['merge.field.legalName']! });
    await toConfirmAndStart(user);
    const union = await screen.findByRole('group', { name: EN['merge.flow.union.label']! });
    expect(within(union).getByText('Use the company domain.')).toBeInTheDocument();
    expect(within(union).getByText(EN['merge.flow.union.fixRecipients']!)).toBeInTheDocument();
  });
});
