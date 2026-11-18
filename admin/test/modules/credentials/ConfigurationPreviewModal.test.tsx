import { StrictMode, useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConfigurationDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../../helpers/axe';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { ConfigurationPreviewModal } from '../../../../packages/modules/credentials/src/admin-ui/ConfigurationPreviewModal';

/**
 * Issue #1444 (DS-11) — the read-only credential preview is the kit's
 * `ModalDialog`, not the hand-drawn overlay it copied from the old bulk
 * order-status dialog: named by its title, closed by Escape or *Close*, focus
 * returned to *Preview*, and a secret still shown only as set / not set.
 */

installOffsetParentShim();

const BUNDLE = {
  ...passthroughBundle('credentials', ['preview.title', 'preview.secret', 'preview.notSet', 'form.inert']),
  ...passthroughBundle('core', ['common.action.close']),
};

const CONFIGURATION: ConfigurationDto = {
  id: 'c1',
  code: 'smtp-main',
  name: 'Main SMTP',
  typeCode: 'smtp',
  typeLabel: 'SMTP',
  providerCode: 'generic',
  providerLabel: 'Generic',
  inert: false,
  fields: [
    { key: 'host', secret: false, value: 'smtp.example.test' },
    { key: 'password', secret: true, isSet: true },
  ],
  version: 1,
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={(): void => setOpen(true)}>
        Preview
      </button>
      <ConfigurationPreviewModal open={open} configuration={CONFIGURATION} onClose={(): void => setOpen(false)} />
    </>
  );
}

async function openPreview(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithI18n(
    <StrictMode>
      <Harness />
    </StrictMode>,
    BUNDLE,
  );
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  return user;
}

describe('ConfigurationPreviewModal (#1444)', () => {
  it('is a modal dialog named by its title that masks secrets', async () => {
    await openPreview();
    const dialog = screen.getByRole('dialog', { name: 'preview.title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('smtp.example.test')).toBeInTheDocument();
    expect(within(dialog).getByText('preview.secret')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common.action.close' })).toHaveFocus();
  });

  it('closes on Escape and on Close, returning focus to Preview', async () => {
    const user = await openPreview();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'common.action.close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveFocus();
  });

  it('has no axe violations while open', async () => {
    await openPreview();
    await expectNoAxeViolations(document.body);
  });
});
