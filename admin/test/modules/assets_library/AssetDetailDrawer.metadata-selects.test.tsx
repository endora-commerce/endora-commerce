import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ASSET_ID, core, detail, en, mockClient, refusal, renderDrawer } from './drawer-fixtures';

/**
 * Issue #1575 — the MIME type and visibility controls of the asset detail
 * drawer write nothing on `change` (WCAG 3.2.2 On Input). The MIME type is
 * staged in its select and written by its own Save, like the filename and the
 * label beside it; visibility is a badge with a "Change…" dialog that names
 * what the change does before it is confirmed (`StatusChangeControl`, DS-18).
 */

const client = vi.hoisted(() => ({ current: null as ReturnType<typeof mockClient> | null }));
vi.mock('../../../../packages/modules/assets_library/src/admin/api/assets-library-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    assetsLibraryClient: new Proxy({}, { get: (_t, prop: string) => (client.current as unknown as Record<string, unknown>)[prop] }),
  };
});

const { AssetDetailDrawer } = await import(
  '../../../../packages/modules/assets_library/src/admin/components/AssetDetailDrawer'
);

const WRITE = ['assets.read', 'assets.write'];
const READ = ['assets.read'];

function render(permissions: readonly string[] = WRITE, onChanged = vi.fn()) {
  return renderDrawer(<AssetDetailDrawer assetId={ASSET_ID} onChanged={onChanged} onClose={vi.fn()} />, permissions);
}

function visibilityButton(): HTMLElement {
  return screen.getByRole('button', { name: `${core('common.statusChange.change')} ${en('detail.visibility')}` });
}

beforeEach(() => {
  client.current = mockClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetDetailDrawer — MIME type', () => {
  it('picking an option writes nothing until Save is pressed', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ mimeType: 'image/png' }));
    client.current!.patchAsset.mockResolvedValue(detail({ mimeType: 'image/webp' }));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(WRITE, onChanged);
    const select = await screen.findByLabelText(en('detail.mimeType'));
    expect(screen.getByText(en('detail.mimeTypeHelp'))).toBeInTheDocument();

    await user.selectOptions(select, 'image/webp');
    expect(client.current!.patchAsset).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: en('detail.mimeTypeSave') }));
    await waitFor(() => expect(client.current!.patchAsset).toHaveBeenCalledWith(ASSET_ID, { mimeType: 'image/webp' }));
    expect(client.current!.patchAsset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: en('detail.mimeTypeSave') })).toBeNull());
  });

  it('offers no Save until the value differs, and none again after picking the current one back', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ mimeType: 'image/png' }));
    const user = userEvent.setup();
    render();
    const select = await screen.findByLabelText(en('detail.mimeType'));
    expect(screen.queryByRole('button', { name: en('detail.mimeTypeSave') })).toBeNull();
    await user.selectOptions(select, 'image/gif');
    expect(screen.getByRole('button', { name: en('detail.mimeTypeSave') })).toBeInTheDocument();
    await user.selectOptions(select, 'image/png');
    expect(screen.queryByRole('button', { name: en('detail.mimeTypeSave') })).toBeNull();
  });

  it('is read-only without assets.write', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    render(READ);
    expect(await screen.findByLabelText(en('detail.mimeType'))).toBeDisabled();
  });
});

describe('AssetDetailDrawer — visibility', () => {
  it('shows the current visibility as a value, not a select', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ visibility: 'public' }));
    render();
    await screen.findByLabelText(en('detail.mimeType'));
    expect(screen.queryByRole('combobox', { name: en('detail.visibility') })).toBeNull();
    expect(screen.getByText(en('visibility.public'))).toBeInTheDocument();
    expect(visibilityButton()).toBeEnabled();
  });

  it('writes only after the confirm step, which names the consequence', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ visibility: 'public' }));
    client.current!.patchAsset.mockResolvedValue(detail({ visibility: 'private' }));
    const user = userEvent.setup();
    render();
    await screen.findByLabelText(en('detail.mimeType'));

    await user.click(visibilityButton());
    const dialog = await screen.findByRole('dialog', { name: en('detail.visibilityChangeTitle') });
    // One way to go: the kit preselects it; nothing is written yet.
    await user.click(within(dialog).getByRole('button', { name: core('common.statusChange.continue') }));
    expect(client.current!.patchAsset).not.toHaveBeenCalled();
    expect(within(dialog).getByText(en('detail.visibilityConsequence.private'), { exact: false })).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: core('common.statusChange.confirm', { status: en('visibility.private') }) }),
    );
    await waitFor(() => expect(client.current!.patchAsset).toHaveBeenCalledWith(ASSET_ID, { visibility: 'private' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(en('detail.shareUrl.privateNotice'))).toBeInTheDocument();
  });

  it('names how many records use the asset when making it private', async () => {
    client.current!.getAsset.mockResolvedValue(
      detail({
        visibility: 'public',
        references: [
          { kind: 'product_gallery', entityId: 'p1', label: 'Drill' },
          { kind: 'cms_body_embed', entityId: 'c1', label: 'Home' },
        ] as never,
      }),
    );
    const user = userEvent.setup();
    render();
    await screen.findByLabelText(en('detail.mimeType'));
    await user.click(visibilityButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: core('common.statusChange.continue') }));
    expect(within(dialog).getByText(en('detail.visibilityConsequence.referenced', { count: 2 }), { exact: false })).toBeInTheDocument();
  });

  it('keeps the dialog open with the server sentence when the write is refused', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ visibility: 'private' }));
    client.current!.patchAsset.mockRejectedValue(refusal(409, 'ASSET_CONFLICT', 'The asset changed meanwhile.'));
    const user = userEvent.setup();
    render();
    await screen.findByLabelText(en('detail.mimeType'));
    await user.click(visibilityButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: core('common.statusChange.continue') }));
    expect(within(dialog).getByText(en('detail.visibilityConsequence.public'), { exact: false })).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: core('common.statusChange.confirm', { status: en('visibility.public') }) }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The asset changed meanwhile.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('explains why it cannot be changed without assets.write', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    render(READ);
    await screen.findByLabelText(en('detail.mimeType'));
    const button = visibilityButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(en('detail.visibilityNoPermission'));
  });
});
