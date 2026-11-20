import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ReactElement } from 'react';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Data } from '@puckeditor/core';
import type { CmsPageBuilderTranslationCapability } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { expectBuilderDialogContract } from '../../helpers/dialog-contract';
import { RowLayoutPicker } from '../../../../packages/modules/cms/src/admin/components/RowLayoutPicker';
import { PageBuilderTranslateAction } from '../../../../packages/modules/cms/src/admin/components/PageBuilderTranslateAction';

/**
 * Issue #1493 (UX audit CONTENT-03) — the two dialogs `cms`' own Page Builder
 * opens over the canvas: the column-layout picker shown when a row is dropped,
 * and Translate. Both are the kit's `ModalDialog` on the `overlay` layer — named,
 * above the fullscreen builder, focus trapped, closed by Escape, focus returned,
 * no axe violations.
 */

installOffsetParentShim();

afterEach(() => cleanup());

const CORE = shippedCoreBundle('en').core as Record<string, string>;
const en = (key: string): string => {
  const value = CORE[key];
  if (value === undefined) throw new Error(`_i18n/i18n/en.json carries no "${key}"`);
  return value;
};

describe('RowLayoutPicker (#1493)', () => {
  function Harness({ onSelect }: { onSelect: (id: string) => void }): ReactElement {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={(): void => setOpen(true)}>
          Add row
        </button>
        <RowLayoutPicker open={open} onOpenChange={setOpen} onSelect={onSelect} />
      </>
    );
  }

  it('is a translated overlay dialog, trapped, closed by Escape, focus back to the opener', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithI18n(
      <StrictMode>
        <Harness onSelect={onSelect} />
      </StrictMode>,
      shippedCoreBundle('en'),
    );
    const opener = screen.getByRole('button', { name: 'Add row' });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: en('pageBuilder.rowLayout.title'),
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(dialog).toHaveAccessibleDescription(en('pageBuilder.rowLayout.description'));
        expect(within(dialog).getByRole('button', { name: en('pageBuilder.rowLayout.skip') })).toBeInTheDocument();
      },
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('applies the chosen preset and closes', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithI18n(<Harness onSelect={onSelect} />, shippedCoreBundle('en'));
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    const dialog = screen.getByRole('dialog', { name: en('pageBuilder.rowLayout.title') });
    const [first] = within(dialog).getAllByRole('button');
    await user.click(first!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('PageBuilderTranslateAction dialog (#1493)', () => {
  const KEYS = [
    'title', 'target', 'sourceLabel', 'sourceCurrent', 'sourceLanguage', 'provider', 'replaceWarning', 'confirm',
    'cancel', 'running', 'scope.canvas', 'scopeDescription.canvas',
  ].map((key) => `pageBuilder.translate.${key}`);
  const READY: CmsPageBuilderTranslationCapability = {
    status: 'ready',
    provider: 'anthropic',
    model: 'claude-test',
    maxCharacters: 40000,
  };
  const canvas: Data = { root: { props: {} }, content: [{ type: 'cms.Heading', props: { id: 'h1', text: 'Witaj' } }] } as Data;

  it('is an overlay dialog, trapped, closed by Escape, focus back to Translate', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <StrictMode>
        <PageBuilderTranslateAction
          capability={READY}
          activeLanguage="en-US"
          languages={['pl-PL', 'en-US']}
          currentData={canvas}
          scope={{ kind: 'canvas' }}
          onTranslated={vi.fn()}
          onNothingToTranslate={vi.fn()}
          translate={vi.fn()}
        />
      </StrictMode>,
      passthroughBundle('cms', KEYS),
    );
    const opener = screen.getByRole('button', { name: 'pageBuilder.translate.scope.canvas' });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: 'pageBuilder.translate.title',
      returnTo: () => opener,
    });
  });
});
