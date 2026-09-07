import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { TransactionalEmailSummary } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #89 — the per-email operator control on the transactional-emails list.
 *
 * The property worth pinning is the same one `ModulesPage.activation.test.tsx`
 * pins one granularity up: a protected email renders a **disabled control with
 * its reason**, not an absent one and not a toggle that silently fails, and the
 * reason arrives from the API rather than from any list held in this app. The
 * code used below is deliberately one no module will ever declare.
 */

let items: TransactionalEmailSummary[] = [];
const setActive = vi.fn();
let permissions = ['transactional_emails:read', 'transactional_emails:write'];

// The **kit's** barrel, not `@/lib/auth`. The screen resolves `useAuth` and
// `ApiError` there since feature 091's batch 11; the admin's own path is a
// re-export shim of the same bindings, and mocking a shim leaves the module the
// screen actually imports untouched.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    useAuth: () => ({
      hasPermission: (code: string) => permissions.includes(code),
    }),
  };
});

vi.mock('../../../../packages/modules/transactional_emails/src/admin/api/transactional-emails-client', () => ({
  transactionalEmailsClient: {
    list: async () => ({ items }),
    setActive: (code: string, active: boolean) => setActive(code, active),
  },
}));

// The screen is `@endora-commerce/mod-transactional-emails/admin`'s since
// feature 091's batch 11. The path names the package's `src/`, which is batch
// 8's convention for a screen test: the package publishes only its barrels, so
// there is no subpath a test could name a single component through.
const { EmailsList } = await import(
  '../../../../packages/modules/transactional_emails/src/admin/pages/EmailsList'
);

const bundle = passthroughBundle('transactional_emails', [
  'activation.column',
  'activation.on',
  'activation.off',
  'activation.locked',
  'activation.action.enable',
  'activation.action.disable',
]);

function summary(patch: Partial<TransactionalEmailSummary> & { code: string }): TransactionalEmailSummary {
  return {
    name: patch.code,
    ownerModule: 'demo',
    group: null,
    active: true,
    languages: ['en-US'],
    hasGlobalOverride: false,
    hasChannelOverride: false,
    deactivatable: true,
    nonDeactivatableReason: null,
    ...patch,
  };
}

async function renderList(): Promise<void> {
  renderWithI18n(
    <MemoryRouter>
      <EmailsList />
    </MemoryRouter>,
    bundle,
  );
  await screen.findByRole('table');
}

function row(code: string): HTMLElement {
  const cell = screen.getByText(code, { selector: 'td.font-mono' });
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`no row rendered for email "${code}"`);
  return tr as HTMLElement;
}

beforeEach(() => {
  items = [];
  permissions = ['transactional_emails:read', 'transactional_emails:write'];
  setActive.mockReset();
});

describe('EmailsList — per-email activation (issue #89)', () => {
  it('switches an email off through the audited endpoint', async () => {
    items = [summary({ code: 'demo_notice' })];
    setActive.mockResolvedValue(summary({ code: 'demo_notice', active: false }));
    await renderList();

    await userEvent.click(
      within(row('demo_notice')).getByRole('button', { name: /activation.action.disable/ }),
    );

    expect(setActive).toHaveBeenCalledWith('demo_notice', false);
    // The row re-renders from the server's summary, not from an assumption.
    expect(
      await within(row('demo_notice')).findByRole('button', {
        name: /activation.action.enable/,
      }),
    ).toBeInTheDocument();
  });

  it('offers the way back for an email already switched off', async () => {
    items = [summary({ code: 'demo_notice', active: false })];
    setActive.mockResolvedValue(summary({ code: 'demo_notice', active: true }));
    await renderList();

    await userEvent.click(
      within(row('demo_notice')).getByRole('button', { name: /activation.action.enable/ }),
    );
    expect(setActive).toHaveBeenCalledWith('demo_notice', true);
  });

  it('renders a protected email locked, with the reason the owning module declared', async () => {
    items = [
      summary({
        code: 'demo_account_setup',
        deactivatable: false,
        nonDeactivatableReason: 'Nobody could finish signing up.',
      }),
    ];
    await renderList();

    const control = within(row('demo_account_setup')).getByRole('button', {
      name: /activation.locked/,
    });
    expect(control).toBeDisabled();
    expect(control.getAttribute('title')).toBe('Nobody could finish signing up.');
    expect(
      within(row('demo_account_setup')).getByText('Nobody could finish signing up.'),
    ).toBeInTheDocument();

    await userEvent.click(control);
    expect(setActive).not.toHaveBeenCalled();
  });

  it('shows the state but no control to a reader without write permission', async () => {
    permissions = ['transactional_emails:read'];
    items = [summary({ code: 'demo_notice' })];
    await renderList();

    expect(within(row('demo_notice')).queryByRole('button')).toBeNull();
    expect(within(row('demo_notice')).getByText('activation.on')).toBeInTheDocument();
  });

  it('surfaces the server refusal instead of leaving a stale toggle', async () => {
    items = [summary({ code: 'demo_notice' })];
    setActive.mockRejectedValue(new Error('the server said no'));
    await renderList();

    await userEvent.click(
      within(row('demo_notice')).getByRole('button', { name: /activation.action.disable/ }),
    );

    expect(await screen.findByText(/the server said no/)).toBeInTheDocument();
    // Still on: nothing was written, so nothing may look written.
    expect(
      within(row('demo_notice')).getByRole('button', { name: /activation.action.disable/ }),
    ).toBeInTheDocument();
  });
});
