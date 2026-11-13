import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { en, renderDrawer } from './drawer-fixtures';
import { answerConfirm } from '../../helpers/confirm-dialog';

/**
 * `specs/156-asset-stable-url/` owner ruling S4 — the folder delete
 * confirmation names how many files in the folder have a shareable link.
 */

const client = vi.hoisted(() => ({
  listFolders: vi.fn(),
  listAssets: vi.fn(),
  countFolderPermalinks: vi.fn(),
  deleteFolder: vi.fn(),
}));
vi.mock('../../../../packages/modules/assets_library/src/admin/api/assets-library-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, assetsLibraryClient: client };
});

const { LibraryPage } = await import('../../../../packages/modules/assets_library/src/admin/pages/LibraryPage');

const FOLDER = {
  id: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  parentId: null,
  name: 'Datasheets',
  position: 0,
  childIds: [],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

beforeEach(() => {
  client.listFolders.mockResolvedValue([FOLDER]);
  client.listAssets.mockResolvedValue({ data: [], nextCursor: null });
  client.deleteFolder.mockResolvedValue({ deletedFolderId: FOLDER.id });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function clickDelete(): Promise<void> {
  const user = userEvent.setup();
  await screen.findByText('Datasheets');
  await user.click(screen.getByTitle(en('common.delete')));
}

describe('LibraryPage — folder delete confirmation', () => {
  it('names how many files in the folder have a shareable link, and Cancel deletes nothing', async () => {
    client.countFolderPermalinks.mockResolvedValue(3);
    renderDrawer(<LibraryPage />, ['assets.read', 'assets.write']);
    await clickDelete();
    const dialog = await screen.findByRole('dialog');
    expect(client.countFolderPermalinks).toHaveBeenCalledWith(FOLDER.id);
    expect(within(dialog).getByText(en('folders.deleteConfirm'))).toBeInTheDocument();
    expect(within(dialog).getByText(en('folders.permalinkNotice', { count: 3 }))).toBeInTheDocument();
    await answerConfirm(false);
    expect(client.deleteFolder).not.toHaveBeenCalled();
  });

  it('says nothing about links when no file in the folder has one', async () => {
    client.countFolderPermalinks.mockResolvedValue(0);
    renderDrawer(<LibraryPage />, ['assets.read', 'assets.write']);
    await clickDelete();
    const dialog = await answerConfirm(true);
    expect(dialog).toHaveTextContent(en('folders.deleteConfirm'));
    expect(dialog).not.toHaveTextContent(en('folders.permalinkNotice', { count: 0 }));
    await waitFor(() => expect(client.deleteFolder).toHaveBeenCalledTimes(1));
  });

  it('still asks, without the count, when the count cannot be read', async () => {
    client.countFolderPermalinks.mockRejectedValue(new Error('offline'));
    renderDrawer(<LibraryPage />, ['assets.read', 'assets.write']);
    await clickDelete();
    const dialog = await answerConfirm(false);
    expect(dialog).toHaveTextContent(en('folders.deleteConfirm'));
    expect(client.deleteFolder).not.toHaveBeenCalled();
  });
});
