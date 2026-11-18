import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../helpers/axe';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { ASSET_ID, core, detail, en, mockClient, refusal, renderDrawer } from './drawer-fixtures';

/**
 * `specs/156-asset-stable-url/` UI block review — the asset detail drawer's
 * accessibility: axe over the drawer, its permalink error state and every
 * dialog it opens, and where focus goes when a dialog opens and closes
 * (initial focus on Cancel, Escape back to the opener, Tab wrapping, and a
 * sensible element when the opener is gone or the dialog opened from a refusal).
 */

installOffsetParentShim();

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
const PERMALINK_URL = 'https://api.example.test/assets/file/docs/certificate.pdf';
const PREVIOUS = {
  filename: 'certificate-2025.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  contentVersion: '0f1e2d3c4b5a',
  replacedAt: '2026-10-10T08:00:00.000Z',
  replacedBy: null,
  restorableUntil: '2026-11-09T08:00:00.000Z',
};
const NEW_PDF = new File(['%PDF-1.4 new'], 'certificate-2026.pdf', { type: 'application/pdf' });

function render() {
  return renderDrawer(<AssetDetailDrawer assetId={ASSET_ID} onChanged={vi.fn()} onClose={vi.fn()} />, WRITE);
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  client.current = mockClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetDetailDrawer — axe', () => {
  it('the whole drawer, with a permalink and a previous version, has no violations', async () => {
    client.current!.getAsset.mockResolvedValue(
      detail({ permalink: 'docs/certificate.pdf', permalinkUrl: PERMALINK_URL, previousVersion: PREVIOUS }),
    );
    const { container } = render();
    await screen.findByRole('region', { name: en('detail.previous.title') });
    expect(screen.getByRole('button', { name: en('detail.close') })).toBeInTheDocument();
    expect(screen.getByLabelText(en('detail.filename'))).toBeInTheDocument();
    expect(screen.getByLabelText(en('detail.mimeType'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${core('common.statusChange.change')} ${en('detail.visibility')}` })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('the share row and the permalink error state have no violations', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    const { container } = render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'a//b');
    await screen.findByText(en('detail.permalink.invalid.invalid_segment'));
    await expectNoAxeViolations(container);
  });

  it('every dialog has no violations', async () => {
    client.current!.getAsset.mockResolvedValue(
      detail({ permalink: 'docs/certificate.pdf', permalinkUrl: PERMALINK_URL, previousVersion: PREVIOUS }),
    );
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('region', { name: en('detail.previous.title') });

    await user.upload(fileInput(container), NEW_PDF);
    await expectNoAxeViolations(await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') }));
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: en('detail.permalink.remove') }));
    await expectNoAxeViolations(await screen.findByRole('dialog', { name: en('detail.permalink.removeTitle') }));
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: en('detail.previous.restore') }));
    await expectNoAxeViolations(await screen.findByRole('dialog', { name: en('detail.previous.confirmTitle') }));
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: en('detail.softDelete') }));
    await expectNoAxeViolations(await screen.findByRole('dialog', { name: en('detail.delete.permalinkTitle') }));
  });
});

describe('AssetDetailDrawer — visibility dialog axe (issue #1575)', () => {
  it('both steps of the visibility dialog have no violations', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    render();
    await user.click(
      await screen.findByRole('button', { name: `${core('common.statusChange.change')} ${en('detail.visibility')}` }),
    );
    const dialog = await screen.findByRole('dialog', { name: en('detail.visibilityChangeTitle') });
    await expectNoAxeViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: core('common.statusChange.continue') }));
    await expectNoAxeViolations(await screen.findByRole('dialog', { name: core('common.statusChange.confirmTitle') }));
  });
});

describe('AssetDetailDrawer — focus', () => {
  it('focuses Cancel on open, wraps Tab inside the dialog, and returns to the opener on Escape', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: PREVIOUS }));
    const user = userEvent.setup();
    render();
    const opener = await screen.findByRole('button', { name: en('detail.previous.restore') });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: en('detail.previous.confirmTitle') });
    const cancel = within(dialog).getByRole('button', { name: en('common.cancel') });
    const confirm = within(dialog).getByRole('button', { name: en('detail.previous.restore') });
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to the permalink input after a removal, whose button is gone', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ permalink: 'docs/certificate.pdf', permalinkUrl: PERMALINK_URL }));
    client.current!.removePermalink.mockResolvedValue(detail());
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: en('detail.permalink.remove') }));
    const dialog = await screen.findByRole('dialog', { name: en('detail.permalink.removeTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('detail.permalink.remove') }));
    await waitFor(() => expect(screen.queryByRole('button', { name: en('detail.permalink.remove') })).toBeNull());
    expect(document.activeElement).toBe(screen.getByLabelText(en('detail.permalink.label')));
  });

  it('returns focus to the permalink input when the reuse dialog, opened from a refusal, is cancelled', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.setPermalink.mockRejectedValueOnce(
      refusal(409, 'ASSET_PERMALINK_PREVIOUSLY_USED', 'used before', {
        permalink: 'docs/sheet.pdf',
        releasedAt: '2026-10-10T10:00:00.000Z',
      }),
    );
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'docs/sheet.pdf');
    await user.click(screen.getByRole('button', { name: en('detail.permalink.save') }));
    const reuse = await screen.findByRole('dialog', { name: en('detail.permalink.reuseTitle') });
    await user.click(within(reuse).getByRole('button', { name: en('common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByLabelText(en('detail.permalink.label')));
  });

  it('keeps focus on the Restore button when a restore is refused', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: PREVIOUS }));
    client.current!.restorePreviousVersion.mockRejectedValue(
      refusal(409, 'ASSET_REPLACE_CONFLICT', "Someone else changed this asset's file since you opened it."),
    );
    const user = userEvent.setup();
    render();
    const opener = await screen.findByRole('button', { name: en('detail.previous.restore') });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: en('detail.previous.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('detail.previous.restore') }));
    await screen.findByText("Someone else changed this asset's file since you opened it.");
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en('detail.previous.restore') }));
  });

  it('marks the confirming button busy, not disabled, while its own request is in flight', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: PREVIOUS }));
    client.current!.restorePreviousVersion.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: en('detail.previous.restore') }));
    const dialog = await screen.findByRole('dialog', { name: en('detail.previous.confirmTitle') });
    const confirm = within(dialog).getByRole('button', { name: en('detail.previous.restore') });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toHaveAttribute('aria-busy', 'true'));
    expect(confirm).not.toBeDisabled();
    expect(document.activeElement).toBe(confirm);
    await user.click(confirm);
    expect(client.current!.restorePreviousVersion).toHaveBeenCalledTimes(1);
  });
});
