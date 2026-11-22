import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EmailBlockSummary, EmailTemplateSummary, TransactionalEmailSummary } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';

/**
 * Issue #1463 (UX audit CONTENT-05) — the transactional e-mail list, the
 * e-mail blocks and the e-mail templates screens printed their column headers,
 * "Yes", the empty row and the raw `global` / `channel` scope in English, and
 * named the create form's inputs by placeholder only. Rendered with the
 * bundles that ship, in both languages.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, useAuth: () => ({ hasPermission: () => true }) };
});

const EMAIL: TransactionalEmailSummary = {
  code: 'order_confirmation',
  name: 'Order confirmation',
  ownerModule: 'orders',
  group: null,
  active: true,
  languages: ['en-US'],
  hasGlobalOverride: true,
  hasChannelOverride: false,
  deactivatable: true,
  nonDeactivatableReason: null,
};
const BLOCK: EmailBlockSummary = {
  id: 'b1',
  code: 'footer',
  name: 'Footer',
  active: true,
  isSystem: true,
  scope: 'channel',
  languages: ['en-US'],
  version: 1,
};
const TEMPLATE = { ...BLOCK, id: 't1', code: 'layout', name: 'Layout', isSystem: false, scope: 'global' } as EmailTemplateSummary;

let emails: TransactionalEmailSummary[] = [EMAIL];

vi.mock('../../../../packages/modules/transactional_emails/src/admin/api/transactional-emails-client', () => ({
  transactionalEmailsClient: {
    list: async () => ({ items: emails }),
    listBlocks: async () => ({ items: [BLOCK] }),
    listTemplates: async () => ({ items: [TEMPLATE] }),
    setActive: vi.fn(),
  },
}));

const { EmailsList } = await import('../../../../packages/modules/transactional_emails/src/admin/pages/EmailsList');
const { EmailBlocksPage } = await import('../../../../packages/modules/transactional_emails/src/admin/pages/EmailBlocksPage');
const { EmailTemplatesPage } = await import('../../../../packages/modules/transactional_emails/src/admin/pages/EmailTemplatesPage');

afterEach(() => {
  cleanup();
  emails = [EMAIL];
});

describe.each(['en', 'pl'] as const)('transactional e-mail screens in %s (#1463)', (language) => {
  const own = shippedModuleBundle('transactional_emails', language).transactional_emails as Record<string, string>;
  const core = shippedCoreBundle(language).core as Record<string, string>;
  const key = (k: string): string => {
    const value = own[k];
    if (!value) throw new Error(`transactional_emails/i18n/${language}.json carries no "${k}"`);
    return value;
  };
  const render = (ui: React.ReactElement): void => {
    renderWithI18n(<MemoryRouter>{ui}</MemoryRouter>, {
      ...shippedModuleBundle('transactional_emails', language),
      ...shippedModuleBundle('orders', language),
      ...shippedCoreBundle(language),
    }, { language });
  };

  it('the e-mail list heads its columns and says which e-mails are customised', async () => {
    render(<EmailsList />);
    const row = (await screen.findByRole('link', { name: 'Order confirmation' })).closest('tr')!;
    expect(screen.getByRole('heading', { level: 1, name: key('page.title') })).toBeInTheDocument();
    for (const column of ['list.column.name', 'list.column.code', 'list.column.module', 'list.column.customized']) {
      expect(screen.getByRole('columnheader', { name: key(column) })).toBeInTheDocument();
    }
    expect(within(row).getByText(key('customization.all'))).toBeInTheDocument();
  });

  // Issue #1536 (CONTENT-19): the Module column printed the id `orders`.
  it("the e-mail list names the sending module in the reader's language", async () => {
    render(<EmailsList />);
    const row = (await screen.findByRole('link', { name: 'Order confirmation' })).closest('tr')!;
    const ordersName = shippedModuleBundle('orders', language).orders?.['module.name'];
    expect(ordersName).toBeTruthy();
    expect(within(row).getByText(ordersName!)).toBeInTheDocument();
    expect(within(row).queryByText('orders')).toBeNull();
    expect(within(row).getByRole('switch', { name: key('activation.switchLabel').replace('{name}', 'Order confirmation') })).toBeInTheDocument();
  });

  // Issue #1448 (DS-15): "no e-mails" and "no e-mail matches the search" are
  // two different empty states, and only the second offers Clear filters.
  it('the e-mail list says so when there are no e-mails at all', async () => {
    emails = [];
    render(<EmailsList />);
    expect(await screen.findByText(key('list.emptyState.title'))).toBeInTheDocument();
    expect(screen.getByText(key('list.emptyState.body'))).toBeInTheDocument();
    expect(screen.queryByText(key('list.emptyFiltered'))).toBeNull();
    expect(screen.queryByRole('button', { name: core['common.emptyState.clearFilters']! })).toBeNull();
  });

  it('the e-mail list tells a search that matches nothing apart, and clears it', async () => {
    render(<EmailsList />);
    await screen.findByRole('link', { name: 'Order confirmation' });
    const search = screen.getByRole('searchbox', { name: key('list.searchLabel') });
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(await screen.findByText(key('list.emptyFiltered'))).toBeInTheDocument();
    expect(screen.queryByText(key('list.emptyState.title'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    expect(await screen.findByRole('link', { name: 'Order confirmation' })).toBeInTheDocument();
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('the e-mail list shows no empty state before the list has arrived', () => {
    render(<EmailsList />);
    expect(document.querySelector('[data-empty-state]')).toBeNull();
  });

  it('e-mail blocks label the create form and name each block’s scope', async () => {
    render(<EmailBlocksPage />);
    const row = (await screen.findByRole('link', { name: 'Footer' })).closest('tr')!;
    expect(within(row).getByText(key('scope.channel'))).toBeInTheDocument();
    expect(within(row).queryByText('channel')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: key('blocks.title') })).toBeInTheDocument();
    // The create form is a dialog behind the header's Create block, not a card open above the list (#1749).
    expect(screen.queryByRole('textbox', { name: key('create.field.code') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: key('blocks.create') }));
    const dialog = screen.getByRole('dialog', { name: key('blocks.create') });
    expect(within(dialog).getByRole('textbox', { name: key('create.field.code') })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: key('create.field.name') })).toBeInTheDocument();
  });

  it('e-mail templates label the create form and name each template’s scope', async () => {
    render(<EmailTemplatesPage />);
    const row = (await screen.findByRole('link', { name: 'Layout' })).closest('tr')!;
    expect(within(row).getByText(key('scope.global'))).toBeInTheDocument();
    // A row's Delete is in its menu, named by the template (#1749).
    expect(within(row).getByRole('button', { name: key('templates.rowActions').replace('{name}', 'Layout') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: key('templates.title') })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: key('templates.create') }));
    const dialog = screen.getByRole('dialog', { name: key('templates.create') });
    expect(within(dialog).getByRole('textbox', { name: key('create.field.code') })).toBeInTheDocument();
  });
});
