import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1464 (UX audit CONTENT-06) — the newsletter's row deletes (e-mail
 * block, subscriber, tag, custom field) fired on one click. Each now asks in
 * the kit's `ConfirmDialog`, naming the object and what deleting it does, with
 * focus on Cancel; the request runs inside the dialog, so a refusal (a tag a
 * campaign still uses) is read where the operator is looking. Real bundles, so
 * the copy asserted is the copy that ships.
 */

installOffsetParentShim();

const deleteBlock = vi.fn();
const deleteSubscriber = vi.fn();
const deleteTag = vi.fn();
const deleteCustomField = vi.fn();
const listBlocks = vi.fn();
const listSubscribers = vi.fn();
const listTags = vi.fn();
const listCustomFields = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, useAuth: () => ({ hasPermission: () => true }) };
});

vi.mock('@endora-commerce/page-builder-admin/email', () => ({
  EmailEditorPane: (): ReactNode => <div />,
  EmailVariablesProvider: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
  mergeEmailVariables: () => [],
  listEmailTemplatesForApply: async () => [],
  loadEmailTemplateCanvas: async () => null,
  saveCanvasAsEmailTemplate: async () => undefined,
}));

vi.mock('../../../../packages/modules/newsletter/src/admin/api/newsletter-client', () => ({
  newsletterClient: {
    listBlocks: () => listBlocks(),
    listSubscribers: () => listSubscribers(),
    listTags: () => listTags(),
    listCustomFields: () => listCustomFields(),
    deleteBlock: (id: string) => deleteBlock(id),
    deleteSubscriber: (id: string) => deleteSubscriber(id),
    deleteTag: (id: string) => deleteTag(id),
    deleteCustomField: (id: string) => deleteCustomField(id),
    subscribersExportUrl: () => '/export.csv',
  },
}));

const { BlocksPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/BlocksPage');
const { SubscribersPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/SubscribersPage');
const { TagsPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/TagsPage');

function bundle(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  const read = (path: string): Record<string, string> =>
    JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
  return {
    newsletter: read(`../packages/modules/newsletter/i18n/${language}.json`),
    core: read(`../packages/modules/_i18n/i18n/${language}.json`),
  };
}

const BLOCK = { id: 'b1', code: 'footer', name: 'Footer', active: true, isSystem: false, version: 1 };
const SUBSCRIBER = {
  id: 's1',
  email: 'ann@example.test',
  status: 'active',
  tags: [],
  source: null,
};
const TAG = { id: 't1', code: 'vip', name: 'VIP', description: null };
const FIELD = { id: 'f1', key: 'company', label: 'Company', type: 'text' };

beforeEach(() => {
  for (const fn of [deleteBlock, deleteSubscriber, deleteTag, deleteCustomField]) fn.mockReset().mockResolvedValue(undefined);
  listBlocks.mockReset().mockResolvedValue({ items: [BLOCK] });
  listSubscribers.mockReset().mockResolvedValue({ items: [SUBSCRIBER], total: 1, scopeNotice: null });
  listTags.mockReset().mockResolvedValue({ items: [TAG] });
  listCustomFields.mockReset().mockResolvedValue({ items: [FIELD] });
});

async function clickDelete(rowText: string): Promise<HTMLElement> {
  const cell = await screen.findByText(rowText);
  const row = (cell.closest('tr') ?? cell.closest('li')) as HTMLElement;
  await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));
  return screen.findByRole('dialog');
}

describe('newsletter deletes ask first (#1464)', () => {
  it('e-mail block: names it, opens on Cancel, and Cancel deletes nothing', async () => {
    renderWithI18n(<BlocksPage />, bundle('en'));
    const dialog = await clickDelete('Footer');

    expect(dialog).toHaveAccessibleName('Delete this e-mail block?');
    expect(dialog).toHaveTextContent('“Footer” (footer)');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteBlock).not.toHaveBeenCalled();
  });

  it('e-mail block: deletes on confirm and reloads the list', async () => {
    renderWithI18n(<BlocksPage />, bundle('en'));
    const dialog = await clickDelete('Footer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete block' }));

    await waitFor(() => expect(deleteBlock).toHaveBeenCalledWith('b1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(listBlocks).toHaveBeenCalledTimes(2);
  });

  it('subscriber: names the address and says it stays unmailable', async () => {
    renderWithI18n(<SubscribersPage />, bundle('en'));
    const dialog = await clickDelete('ann@example.test');

    expect(dialog).toHaveTextContent('ann@example.test');
    expect(dialog).toHaveTextContent('suppression list');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete subscriber' }));
    await waitFor(() => expect(deleteSubscriber).toHaveBeenCalledWith('s1'));
  });

  it('tag: a refusal stays in the dialog, in the words the API sent', async () => {
    deleteTag.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'NEWSLETTER_TAG_IN_USE', message: 'Tag "vip" is used by a campaign or an automation.' },
      } as never),
    );
    renderWithI18n(<TagsPage />, bundle('en'));
    const dialog = await clickDelete('vip');
    expect(dialog).toHaveTextContent('“VIP”');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete tag' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tag "vip" is used by a campaign or an automation.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('custom field: asks in Polish too', async () => {
    renderWithI18n(<TagsPage />, bundle('pl'), { language: 'pl' });
    const dialog = await clickDelete('company');

    expect(dialog).toHaveAccessibleName('Usunąć to pole dodatkowe?');
    expect(dialog).toHaveTextContent('„Company” (company)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń pole' }));
    await waitFor(() => expect(deleteCustomField).toHaveBeenCalledWith('f1'));
  });
});
