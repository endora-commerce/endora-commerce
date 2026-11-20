import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ReactElement, type ReactNode } from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Data } from '@puckeditor/core';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { installOffsetParentShim } from '../helpers/layout-shim';
import { expectBuilderDialogContract } from '../helpers/dialog-contract';

/**
 * Issue #1493 (UX audit CONTENT-03) — every dialog the shared Page Builder and
 * e-mail builder chrome opens is the kit's `ModalDialog` on the `overlay`
 * layer: named by its title, above the fullscreen builder, focus trapped,
 * Escape closes it, focus returns to the control that opened it, and axe finds
 * nothing. Before, each drew its own scrim (`createPortal` + `fixed inset-0`)
 * and none trapped focus; most ignored Escape.
 *
 * Copy is the shipped `core` bundle, so a dialog named by a key the bundle
 * does not carry fails here instead of reading `core.<key>` to the operator.
 */

installOffsetParentShim();

const get = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (path: string) => get(path), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

// The asset library reads the API; the shell around it is the subject here.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>('@endora-commerce/admin-kit/components');
  return {
    ...actual,
    AssetPicker: (): ReactElement => (
      <button type="button" data-testid="asset-library">
        Library item
      </button>
    ),
  };
});

const { PageBuilderHeaderActions } = await import('../../../packages/page-builder-admin/src/chrome/PageBuilderHeaderActions');
const { ColorPaletteModal } = await import('../../../packages/page-builder-admin/src/chrome/ColorPaletteModal');
const { AssetModalFieldControl } = await import('../../../packages/page-builder-admin/src/chrome/AssetPickers');
const { createProductSlugsField, createCategorySlugsField } = await import('../../../packages/page-builder-admin/src/chrome/CatalogPickers');
const { EmailHtmlPreviewModal } = await import('../../../packages/page-builder-admin/src/email/EmailEditorPane');
const { EmailRowLayoutPicker } = await import('../../../packages/page-builder-admin/src/email/EmailRowLayoutPicker');
const { EmailVariablesProvider, useEmailVariables } = await import('../../../packages/page-builder-admin/src/email/EmailVariablesProvider');

const CORE = shippedCoreBundle('en').core as Record<string, string>;
/** The shipped English copy for `key`; a key the bundle lacks fails the test that reads it. */
const en = (key: string, params: Record<string, string | number> = {}): string => {
  const value = CORE[key];
  if (value === undefined) throw new Error(`_i18n/i18n/en.json carries no "${key}"`);
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};
const t = (key: string, params?: Record<string, string | number>): string => (key in CORE ? en(key, params) : `core.${key}`);

const CANVAS: Data = { root: { props: {} }, content: [{ type: 'Heading', props: { id: 'h1', text: 'Hi' } }] } as Data;

function wrap(node: ReactNode): ReactElement {
  return <StrictMode>{node}</StrictMode>;
}

function renderCore(node: ReactNode): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(wrap(node), shippedCoreBundle('en'));
}

/** A button that opens `render` — for the dialogs a parent opens by state. */
function Opener({ label, children }: { label: string; children: (close: () => void) => ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={(): void => setOpen(true)}>
        {label}
      </button>
      {open ? children((): void => setOpen(false)) : null}
    </>
  );
}

/**
 * Issue #1494 (CONTENT-11) — the canvas toolbar's dialogs open from its "More"
 * menu; focus comes back to "More" when they close.
 */
function moreButton(): HTMLElement {
  return screen.getByRole('button', { name: en('common.action.more') });
}
async function chooseFromMore(user: ReturnType<typeof userEvent.setup>, key: string): Promise<void> {
  await user.click(moreButton());
  await user.click(await screen.findByRole('menuitem', { name: en(key) }));
}

/** The canvas toolbar with only template entries — what `PageBuilderTemplateActions` was. */
function TemplateToolbar(props: Record<string, unknown>): ReactElement {
  return <PageBuilderHeaderActions fullscreen={false} onToggleFullscreen={vi.fn()} currentData={CANVAS} t={t} {...props} />;
}

afterEach(() => {
  cleanup();
  get.mockReset();
});

describe('template dialogs (#1493, from the More menu since #1494)', () => {
  it('save as template: overlay dialog, trapped, Escape, focus back to the button', async () => {
    const user = userEvent.setup();
    renderCore(<TemplateToolbar onSaveAsTemplate={vi.fn()} t={t} />);
    const opener = moreButton();
    await expectBuilderDialogContract(user, {
      open: () => chooseFromMore(user, 'pageBuilder.saveAsTemplate.button'),
      name: en('pageBuilder.saveAsTemplate.title'),
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(within(dialog).getByLabelText(en('common.field.name'))).toHaveFocus();
        expect(dialog).toHaveAccessibleDescription(en('pageBuilder.saveAsTemplate.description'));
      },
    });
  });

  it('save as template: the result is visible next to the button, a failure stays in the dialog', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValueOnce(new Error('MISSING_SCOPE')).mockResolvedValueOnce(undefined);
    renderCore(<TemplateToolbar onSaveAsTemplate={onSave} t={t} />);
    const opener = moreButton();
    await chooseFromMore(user, 'pageBuilder.saveAsTemplate.button');
    const dialog = screen.getByRole('dialog', { name: en('pageBuilder.saveAsTemplate.title') });
    await user.type(within(dialog).getByLabelText(en('common.field.name')), 'Landing');
    await user.click(within(dialog).getByRole('button', { name: en('pageBuilder.saveAsTemplate.confirm') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en('pageBuilder.saveAsTemplate.missingScope'));

    await user.click(within(dialog).getByRole('button', { name: en('pageBuilder.saveAsTemplate.confirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(en('pageBuilder.saveAsTemplate.success'));
    expect(status).not.toHaveClass('sr-only');
    expect(opener).toHaveFocus();
  });

  it('apply template: overlay dialog, trapped, Escape, focus back to the button; the result is visible', async () => {
    const user = userEvent.setup();
    const list = vi.fn(async () => [{ id: 'tpl-1', label: 'Landing' }]);
    const apply = vi.fn(async () => undefined);
    renderCore(
      <TemplateToolbar onListTemplatesForApply={list} onApplyTemplate={apply} t={t} />,
    );
    const opener = moreButton();
    await expectBuilderDialogContract(user, {
      open: () => chooseFromMore(user, 'pageBuilder.applyTemplate.button'),
      name: en('pageBuilder.applyTemplate.title'),
      returnTo: () => opener,
      whenOpen: async (dialog) => {
        await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Landing' })).toBeInTheDocument());
      },
    });

    await chooseFromMore(user, 'pageBuilder.applyTemplate.button');
    const dialog = screen.getByRole('dialog', { name: en('pageBuilder.applyTemplate.title') });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: en('pageBuilder.applyTemplate.confirm') })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: en('pageBuilder.applyTemplate.confirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apply).toHaveBeenCalledWith('tpl-1');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(en('pageBuilder.applyTemplate.success'));
    expect(status).not.toHaveClass('sr-only');
  });

  it('apply template: a failed list is shown inside the dialog', async () => {
    const user = userEvent.setup();
    renderCore(
      <TemplateToolbar
        onListTemplatesForApply={vi.fn(async () => Promise.reject(new Error('Templates unavailable')))}
        onApplyTemplate={vi.fn()}
        t={t}
      />,
    );
    await chooseFromMore(user, 'pageBuilder.applyTemplate.button');
    const dialog = screen.getByRole('dialog', { name: en('pageBuilder.applyTemplate.title') });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Templates unavailable');
  });
});

describe('PageBuilderHeaderActions dialogs (#1493)', () => {
  const header = (over: Record<string, unknown> = {}): ReactElement => (
    <PageBuilderHeaderActions
      fullscreen={false}
      onToggleFullscreen={vi.fn()}
      languages={['pl', 'en']}
      activeLanguage="pl"
      currentData={CANVAS}
      onCopyFromLanguage={vi.fn()}
      onClearCanvas={vi.fn()}
      t={t}
      {...over}
    />
  );

  it('copy from language: overlay dialog, trapped, Escape, focus back to the button', async () => {
    const user = userEvent.setup();
    renderCore(header());
    const opener = moreButton();
    await expectBuilderDialogContract(user, {
      open: () => chooseFromMore(user, 'pageBuilder.copyLanguage.button'),
      name: en('pageBuilder.copyLanguage.title'),
      returnTo: () => opener,
    });
  });

  it('copy from language: the result is visible next to the button', async () => {
    const user = userEvent.setup();
    const copy = vi.fn(async () => undefined);
    renderCore(header({ onCopyFromLanguage: copy }));
    await chooseFromMore(user, 'pageBuilder.copyLanguage.button');
    const dialog = screen.getByRole('dialog', { name: en('pageBuilder.copyLanguage.title') });
    await user.click(within(dialog).getByRole('button', { name: en('pageBuilder.copyLanguage.confirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(copy).toHaveBeenCalledWith('en');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(en('pageBuilder.copyLanguage.success', { language: 'en' }));
    expect(status).not.toHaveClass('sr-only');
  });

  it('clear canvas: overlay dialog opening on Cancel, trapped, Escape, focus back to the button', async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    renderCore(header({ onClearCanvas: clear }));
    const opener = moreButton();
    await expectBuilderDialogContract(user, {
      open: () => chooseFromMore(user, 'pageBuilder.clearCanvas.button'),
      name: en('pageBuilder.clearCanvas.title'),
      returnTo: () => opener,
      whenOpen: (dialog) => {
        // Destructive: Enter on a dialog opened by accident keeps the canvas.
        expect(within(dialog).getByRole('button', { name: en('pageBuilder.clearCanvas.cancel') })).toHaveFocus();
        expect(dialog).toHaveAccessibleDescription(en('pageBuilder.clearCanvas.description'));
      },
    });
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('ColorPaletteModal (#1493)', () => {
  const entries = [{ id: 'c1', name: 'Brand blue', hex: '#1d4ed8' }];
  const palette = (): ReactElement => (
    <Opener label="Open palette">
      {(close): ReactNode => (
        <ColorPaletteModal open entries={entries} pickMode={false} onClose={close} onPick={vi.fn()} onSave={vi.fn(async () => undefined)} />
      )}
    </Opener>
  );

  it('is an overlay dialog, trapped, closed by Escape, focus back to the opener', async () => {
    const user = userEvent.setup();
    renderCore(palette());
    const opener = screen.getByRole('button', { name: 'Open palette' });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: en('pageBuilder.colorPalette.title'),
      returnTo: () => opener,
    });
  });

  it('Escape in the inline delete question answers it, and leaves the palette open', async () => {
    const user = userEvent.setup();
    renderCore(palette());
    await user.click(screen.getByRole('button', { name: 'Open palette' }));
    const dialog = screen.getByRole('dialog', { name: en('pageBuilder.colorPalette.title') });
    const remove = within(dialog).getByRole('button', { name: en('pageBuilder.colorPalette.delete') });
    await user.click(remove);
    expect(within(dialog).getByRole('group', { name: en('pageBuilder.colorPalette.deleteConfirm') })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: en('pageBuilder.colorPalette.title') })).toBeInTheDocument();
    expect(within(dialog).queryByRole('group')).toBeNull();
    expect(within(dialog).getByRole('button', { name: en('pageBuilder.colorPalette.delete') })).toHaveFocus();
  });
});

describe('asset picker dialog (#1493)', () => {
  it('is an overlay dialog, trapped, closed by Escape, focus back to Select', async () => {
    const user = userEvent.setup();
    renderCore(<AssetModalFieldControl value="" onChange={vi.fn()} label="Image" acceptMimePrefix="image/" />);
    // Puck's FieldLabel wraps the control in a <label>, which changes the button's computed name.
    const opener = screen.getByText(en('pageBuilder.assetPicker.select'), { selector: 'button' });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: en('pageBuilder.assetPicker.selectImage'),
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(within(dialog).getByRole('button', { name: en('common.action.close') })).toBeInTheDocument();
      },
    });
  });
});

describe('catalog picker dialogs (#1493)', () => {
  function renderField(field: { type: string; render?: unknown }, label: string): void {
    if (field.type !== 'custom') throw new Error('expected a custom field');
    const Render = field.render as (props: Record<string, unknown>) => ReactElement;
    renderCore(<Render value={[]} onChange={vi.fn()} field={{ type: 'custom', label }} name="f" id="f" />);
  }

  it('the product search: overlay dialog, labelled controls, trapped, Escape, focus back', async () => {
    get.mockResolvedValue({ data: [{ id: 'p1', slug: 'drill-x', name: 'Drill X', sku: 'DRILL-X' }], pagination: { total: 1 } });
    const user = userEvent.setup();
    renderField(createProductSlugsField(), 'Products');
    const opener = screen.getByRole('button', { name: /products/i });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: en('pageBuilder.catalogPicker.selectProducts'),
      returnTo: () => opener,
      whenOpen: async (dialog) => {
        expect(within(dialog).getByRole('textbox', { name: en('pageBuilder.catalogPicker.searchProducts') })).toBeInTheDocument();
        expect(within(dialog).getByRole('combobox', { name: en('pageBuilder.catalogPicker.statusLabel') })).toBeInTheDocument();
        await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: /Drill X/ })).toBeInTheDocument());
      },
    });
  });

  it('the category search: overlay dialog, labelled filter, trapped, Escape, focus back', async () => {
    get.mockResolvedValue({ data: [{ id: 'c1', slug: 'tools', name: 'Tools', parentCategoryId: null }] });
    const user = userEvent.setup();
    renderField(createCategorySlugsField(), 'Categories');
    const opener = screen.getByRole('button', { name: /categories/i });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: en('pageBuilder.catalogPicker.selectCategories'),
      returnTo: () => opener,
      whenOpen: async (dialog) => {
        expect(within(dialog).getByRole('textbox', { name: en('pageBuilder.catalogPicker.filterCategories') })).toBeInTheDocument();
        await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Tools' })).toBeInTheDocument());
      },
    });
  });
});

describe('e-mail builder dialogs (#1493)', () => {
  it('the HTML preview: overlay dialog, trapped, Escape, focus back to the opener', async () => {
    const user = userEvent.setup();
    renderCore(
      <Opener label="Preview">
        {(close): ReactNode => <EmailHtmlPreviewModal open html="<p>Hi</p>" onClose={close} />}
      </Opener>,
    );
    const opener = screen.getByRole('button', { name: 'Preview' });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: en('pageBuilder.emailPreview.title'),
      returnTo: () => opener,
      iframes: false,
    });
  });

  it('the row layout picker: overlay dialog, translated, trapped, Escape, focus back', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderCore(
      <Opener label="Add row">
        {(close): ReactNode => (
          <EmailRowLayoutPicker open onOpenChange={(open: boolean): void => (open ? undefined : close())} onSelect={onSelect} />
        )}
      </Opener>,
    );
    const opener = screen.getByRole('button', { name: 'Add row' });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: en('pageBuilder.rowLayout.title'),
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(dialog).toHaveAccessibleDescription(en('pageBuilder.rowLayout.emailDescription'));
        expect(within(dialog).getByRole('button', { name: en('pageBuilder.rowLayout.skip') })).toBeInTheDocument();
      },
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('the variable picker: overlay dialog, labelled search, trapped, Escape, focus back; a pick inserts', async () => {
    const insert = vi.fn();
    function Consumer(): ReactElement {
      const { openPicker } = useEmailVariables();
      return (
        <button type="button" onClick={(): void => openPicker(insert)}>
          Insert
        </button>
      );
    }
    const user = userEvent.setup();
    renderCore(
      <EmailVariablesProvider variables={[{ key: 'customer.firstName', label: 'First name' }]}>
        <Consumer />
      </EmailVariablesProvider>,
    );
    const opener = screen.getByRole('button', { name: 'Insert' });
    await expectBuilderDialogContract(user, {
      open: () => user.click(opener),
      name: en('pageBuilder.emailVariables.title'),
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(within(dialog).getByRole('searchbox', { name: en('pageBuilder.emailVariables.search') })).toHaveFocus();
      },
    });
    expect(insert).not.toHaveBeenCalled();

    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: en('pageBuilder.emailVariables.title') });
    await user.type(within(dialog).getByRole('searchbox'), 'zzz');
    expect(within(dialog).getByText(en('pageBuilder.emailVariables.empty'))).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: '' } });
    await user.click(within(dialog).getByRole('button', { name: /First name/ }));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});
