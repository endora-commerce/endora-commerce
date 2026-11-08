import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Bundle, SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';
import { AUDIT_ERASED_MARKER } from '@endora-commerce/contracts';
import en from '../../../../packages/modules/audit_logs/i18n/en.json';
import pl from '../../../../packages/modules/audit_logs/i18n/pl.json';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #844 — an anonymised subject's audit history is erased in place, every
 * personal value replaced by the stored marker `[erased]`. The viewer must not
 * print that marker raw: it draws a translated token where it stands (in the
 * snapshots, and as the IP or user agent), keeps every key so the diff still
 * says *which* fields changed, and leaves a string that merely starts with the
 * marker exactly as it was typed.
 */

const get = vi.fn(async (_url: string) => ({ data: ROWS as unknown[] }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => get(...(args as [string])),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const SUBJECT = '00000000-0000-4000-8000-000000000844';

const ROWS = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    actorAdminUserId: null,
    actorName: null,
    actorEmail: null,
    actorCustomerAccountId: SUBJECT,
    actorCustomerLabel: null,
    impersonatedCustomerAccountId: null,
    actedAt: '2026-11-05T10:00:00.000Z',
    action: 'customer_account.update_profile',
    actionModuleId: 'core',
    objectType: 'customer_account',
    objectId: SUBJECT,
    stateBefore: { email: AUDIT_ERASED_MARKER, firstName: AUDIT_ERASED_MARKER },
    stateAfter: {
      email: AUDIT_ERASED_MARKER,
      note: '[erased] by hand',
      organizationId: '00000000-0000-4000-8000-0000000000a1',
      customFieldValues: { vip: AUDIT_ERASED_MARKER },
    },
    ipAddress: AUDIT_ERASED_MARKER,
    userAgent: AUDIT_ERASED_MARKER,
    requestId: 'req-1',
  },
];

async function mount(language: SupportedAdminLanguage): Promise<void> {
  const { default: AuditLogViewer } = await import('../../../../packages/modules/audit_logs/src/admin/pages/AuditLogViewer');
  const bundle: Bundle = {
    ...passthroughBundle('core', ['auditLog.action.detail', 'auditLog.detail.before', 'auditLog.detail.after', 'auditLog.detail.ip', 'auditLog.detail.userAgent']),
    audit_logs: language === 'pl' ? (pl as Record<string, string>) : (en as Record<string, string>),
  };
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/audit-log?objectType=customer_account&objectId=${SUBJECT}`]}>
        <Routes>
          <Route path="/audit-log" element={<AuditLogViewer />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['audit_logs'] }) },
    ),
    bundle,
    { language },
  );
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1));
  fireEvent.click(screen.getByRole('button', { name: 'auditLog.action.detail' }));
}

function snapshot(label: 'auditLog.detail.before' | 'auditLog.detail.after'): HTMLElement {
  return screen.getByText(label).parentElement!.querySelector('pre')!;
}

describe('audit-log viewer — erased values (issue #844)', () => {
  beforeEach(() => {
    get.mockClear();
  });

  it('draws the marker as the translated "Erased" token, in English', async () => {
    await mount('en');
    const after = snapshot('auditLog.detail.after');
    expect(within(after).getAllByText('Erased')).toHaveLength(2);
    expect(after).not.toHaveTextContent(`"${AUDIT_ERASED_MARKER}"`);
    expect(within(snapshot('auditLog.detail.before')).getAllByText('Erased')).toHaveLength(2);
  });

  it('draws it as "Usunięto" in Polish', async () => {
    await mount('pl');
    expect(within(snapshot('auditLog.detail.after')).getAllByText('Usunięto')).toHaveLength(2);
  });

  it('keeps every key, so the diff still says which fields changed', async () => {
    await mount('en');
    const after = snapshot('auditLog.detail.after');
    for (const key of ['email', 'note', 'organizationId', 'customFieldValues', 'vip']) {
      expect(after).toHaveTextContent(`"${key}":`);
    }
    expect(after).toHaveTextContent('"00000000-0000-4000-8000-0000000000a1"');
  });

  it('renders a string that only starts with the marker as the plain string it is', async () => {
    await mount('en');
    expect(snapshot('auditLog.detail.after')).toHaveTextContent('"[erased] by hand"');
  });

  it('draws an erased IP and user agent with the same token', async () => {
    await mount('en');
    const meta = screen.getByText(/auditLog\.detail\.ip/).closest('div')!;
    expect(within(meta).getAllByText('Erased')).toHaveLength(2);
    expect(meta).not.toHaveTextContent(AUDIT_ERASED_MARKER);
  });
});
