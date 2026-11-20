import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { TransactionalEmailSummary } from '@endora-commerce/contracts';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
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

const passthrough = passthroughBundle('transactional_emails', [
  'activation.column',
  'activation.on',
  'activation.off',
  'activation.locked',
  'activation.switchLabel',
  'list.search',
  'list.searchLabel',
  'list.filter.module',
  'list.filter.allModules',
]);
const bundle: Bundle = {
  transactional_emails: { ...passthrough.transactional_emails, 'list.toggleError': '{name}: {message}' },
  // The sending module's own name, from its own bundle (#1536).
  demo: { 'module.name': 'Demo module' },
};

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
  const link = screen.getByRole('link', { name: code });
  const tr = link.closest('tr');
  if (!tr) throw new Error(`no row rendered for email "${code}"`);
  return tr as HTMLElement;
}

beforeEach(() => {
  items = [];
  permissions = ['transactional_emails:read', 'transactional_emails:write'];
  setActive.mockReset();
});

describe('EmailsList — per-email activation (issues #89, #1536)', () => {
  it('switches an email off through the audited endpoint, with a switch rather than a filled button', async () => {
    items = [summary({ code: 'demo_notice' })];
    setActive.mockResolvedValue(summary({ code: 'demo_notice', active: false }));
    await renderList();

    const control = within(row('demo_notice')).getByRole('switch', { name: 'activation.switchLabel' });
    expect(control).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(control);

    expect(setActive).toHaveBeenCalledWith('demo_notice', false);
    // The row re-renders from the server's summary, not from an assumption.
    await waitFor(() =>
      expect(within(row('demo_notice')).getByRole('switch')).toHaveAttribute('aria-checked', 'false'),
    );
    expect(within(row('demo_notice')).getByText('activation.off')).toBeInTheDocument();
  });

  it('offers the way back for an email already switched off, and no row carries a filled button', async () => {
    items = [summary({ code: 'demo_notice', active: false })];
    setActive.mockResolvedValue(summary({ code: 'demo_notice', active: true }));
    await renderList();

    // CONTENT-19: an inactive row used to carry the page's only filled button (Von Restorff).
    expect(within(row('demo_notice')).queryByRole('button')).toBeNull();
    const control = within(row('demo_notice')).getByRole('switch', { name: 'activation.switchLabel' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(control);
    expect(setActive).toHaveBeenCalledWith('demo_notice', true);
  });

  it('marks the switch busy while the write runs, and ignores a second press', async () => {
    items = [summary({ code: 'demo_notice' })];
    let finish: (value: TransactionalEmailSummary) => void = () => undefined;
    setActive.mockReturnValue(new Promise<TransactionalEmailSummary>((resolve) => { finish = resolve; }));
    await renderList();

    const control = within(row('demo_notice')).getByRole('switch');
    await userEvent.click(control);
    expect(control).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(control);
    expect(setActive).toHaveBeenCalledTimes(1);

    finish(summary({ code: 'demo_notice', active: false }));
    await waitFor(() => expect(within(row('demo_notice')).getByRole('switch')).not.toHaveAttribute('aria-busy'));
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

    const control = within(row('demo_account_setup')).getByRole('switch', { name: 'activation.switchLabel' });
    // Focusable, so the reason is heard, but not operable.
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control).toHaveAccessibleDescription('Nobody could finish signing up.');
    expect(within(row('demo_account_setup')).getByText('activation.locked')).toBeInTheDocument();
    expect(
      within(row('demo_account_setup')).getAllByText('Nobody could finish signing up.').length,
    ).toBeGreaterThan(0);

    await userEvent.click(control);
    expect(setActive).not.toHaveBeenCalled();
  });

  it('shows the state but no control to a reader without write permission', async () => {
    permissions = ['transactional_emails:read'];
    items = [summary({ code: 'demo_notice' })];
    await renderList();

    expect(within(row('demo_notice')).queryByRole('switch')).toBeNull();
    expect(within(row('demo_notice')).queryByRole('button')).toBeNull();
    expect(within(row('demo_notice')).getByText('activation.on')).toBeInTheDocument();
  });

  it('surfaces the server refusal instead of leaving a stale toggle', async () => {
    items = [summary({ code: 'demo_notice' })];
    setActive.mockRejectedValue(new Error('the server said no'));
    await renderList();

    await userEvent.click(within(row('demo_notice')).getByRole('switch'));

    expect(await screen.findByText('demo_notice: the server said no')).toBeInTheDocument();
    // Still on: nothing was written, so nothing may look written.
    expect(within(row('demo_notice')).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('EmailsList — the sending module (#1536)', () => {
  it("names the module by its own name, not by its id", async () => {
    items = [summary({ code: 'demo_notice' })];
    await renderList();
    expect(within(row('demo_notice')).getByText('Demo module')).toBeInTheDocument();
    expect(within(row('demo_notice')).queryByText('demo')).toBeNull();
  });

  it('filters the list by module', async () => {
    items = [summary({ code: 'demo_notice' }), summary({ code: 'other_notice', ownerModule: 'other' })];
    await renderList();
    const select = screen.getByRole('combobox', { name: 'list.filter.module' });
    expect(within(select).getByRole('option', { name: 'Demo module' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'demo');
    expect(screen.getByRole('link', { name: 'demo_notice' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'other_notice' })).toBeNull();
  });
});

describe('EmailsList — search box (#1465)', () => {
  it('names the search box by a label, not only by its placeholder', async () => {
    items = [summary({ code: 'demo_notice' })];
    await renderList();
    const search = screen.getByRole('searchbox', { name: 'list.searchLabel' });
    expect(search).toHaveAttribute('placeholder', 'list.search');
  });
});
