import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, Suspense, useState, type ReactElement, type ReactNode } from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSONContent } from '@tiptap/core';
import { createInlineRichTextField, RichContentEditorField } from '@endora-commerce/cms-components';
import { PAGE_BUILDER_FIELD_TEXT } from '@endora-commerce/page-builder-core';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { expectBuilderDialogContract } from '../../helpers/dialog-contract';

/**
 * Issue #1652 (UX audit, follow-up to CONTENT-03 #1493) — the rich-text
 * editors of `@endora-commerce/cms-components` draw their dialogs through the
 * package's own `CmsModalDialog`, because the package ships to the storefront
 * and cannot depend on the admin kit. Each keeps the kit `ModalDialog`'s
 * contract: a modal dialog named by its title on the `overlay` layer, focus
 * trapped, Escape closes it, focus returns to the toolbar button that opened
 * it, and axe finds nothing.
 *
 * The toolbar buttons keep the caret in the text on a mouse press
 * (`onMouseDown` prevents the default), so the opener is reached the way a
 * keyboard user reaches it: focused, then Enter.
 */

installOffsetParentShim();

const { CmsModalDialog } = await import('../../../../packages/cms-components/src/components/CmsModalDialog');

afterEach(() => {
  cleanup();
});

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

/** Focuses `button` and presses Enter on it. */
async function press(user: ReturnType<typeof userEvent.setup>, button: HTMLElement): Promise<void> {
  button.focus();
  await user.keyboard('{Enter}');
}

describe('CmsModalDialog (#1652)', () => {
  it('keeps the builder dialog contract', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <StrictMode>
        <Opener label="Open">
          {(close) => (
            <CmsModalDialog title="Example" onClose={close}>
              <label>
                First
                <input />
              </label>
              <button type="button">Second</button>
            </CmsModalDialog>
          )}
        </Opener>
      </StrictMode>,
    );
    const opener = screen.getByRole('button', { name: 'Open' });
    await expectBuilderDialogContract(user, {
      open: () => press(user, opener),
      name: 'Example',
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(within(dialog).getByLabelText('First')).toHaveFocus();
      },
    });
  });

  it('closes on a press on the scrim, and only the topmost dialog answers Escape', async () => {
    const user = userEvent.setup();
    const onOuterClose = vi.fn();
    renderWithI18n(
      <CmsModalDialog title="Outer" onClose={onOuterClose}>
        <Opener label="Nested">
          {(close) => (
            <CmsModalDialog title="Inner" onClose={close}>
              <button type="button">Inside</button>
            </CmsModalDialog>
          )}
        </Opener>
      </CmsModalDialog>,
    );
    await press(user, screen.getByRole('button', { name: 'Nested' }));
    expect(await screen.findByRole('dialog', { name: 'Inner' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull());
    expect(onOuterClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Nested' })).toHaveFocus();

    const scrim = screen.getByRole('dialog', { name: 'Outer' }).parentElement!;
    await user.pointer({ keys: '[MouseLeft]', target: scrim });
    expect(onOuterClose).toHaveBeenCalledTimes(1);
  });
});

const HEADING: JSONContent = {
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Pricing' }] }],
};

function renderRichText(value: JSONContent = HEADING): void {
  renderWithI18n(
    <StrictMode>
      <RichContentEditorField value={value} onChange={vi.fn()} />
    </StrictMode>,
  );
}

async function toolbarButton(name: string): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
}

describe('rich text toolbar dialogs (#1652)', () => {
  it('link: trapped, Escape, focus back to the Link button', async () => {
    const user = userEvent.setup();
    renderRichText();
    const opener = await toolbarButton('Link');
    await expectBuilderDialogContract(user, {
      open: () => press(user, opener),
      name: 'Link',
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(within(dialog).getByLabelText('URL')).toHaveFocus();
      },
    });
  });

  it('heading anchor: trapped, Escape, focus back to the anchor button', async () => {
    const user = userEvent.setup();
    renderRichText();
    const opener = await toolbarButton('Heading anchor');
    await expectBuilderDialogContract(user, {
      open: () => press(user, opener),
      name: 'Heading anchor',
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(within(dialog).getByLabelText('Anchor')).toHaveFocus();
      },
    });
  });

  it('image: trapped, Escape, focus back to the image button', async () => {
    const user = userEvent.setup();
    renderRichText();
    const opener = await toolbarButton('Insert image');
    await expectBuilderDialogContract(user, {
      open: () => press(user, opener),
      name: 'Insert image',
      returnTo: () => opener,
      whenOpen: (dialog) => {
        expect(within(dialog).getByLabelText('Image URL')).toHaveFocus();
      },
    });
  });

  it('full screen: a dialog named by its title, Escape collapses it, focus back to the expand button', async () => {
    const user = userEvent.setup();
    renderRichText();
    await expectBuilderDialogContract(user, {
      open: async () => press(user, await toolbarButton('Expand editor to full screen')),
      name: PAGE_BUILDER_FIELD_TEXT['richText.fullscreen'],
      returnTo: () => screen.getByRole('button', { name: 'Expand editor to full screen' }),
      whenOpen: (dialog) => {
        expect(within(dialog).getByRole('button', { name: 'Collapse editor' })).toBeTruthy();
      },
    });
  });

  it('a link dialog opened in full screen closes alone on Escape', async () => {
    const user = userEvent.setup();
    renderRichText();
    await press(user, await toolbarButton('Expand editor to full screen'));
    const fullscreen = await screen.findByRole('dialog', { name: PAGE_BUILDER_FIELD_TEXT['richText.fullscreen'] });
    await press(user, within(fullscreen).getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('dialog', { name: 'Link' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Link' })).toBeNull());
    expect(screen.getByRole('dialog', { name: PAGE_BUILDER_FIELD_TEXT['richText.fullscreen'] })).toBeTruthy();
  });
});

function renderInline(): void {
  const field = createInlineRichTextField({ label: 'Title' });
  const Render = field.render as (props: Record<string, unknown>) => ReactElement;
  renderWithI18n(
    <StrictMode>
      <Suspense fallback={null}>
        <Render field={field} name="title" id="title" value="Hello" onChange={vi.fn()} />
      </Suspense>
    </StrictMode>,
  );
}

describe('inline rich text dialogs (#1652)', () => {
  it('link: trapped, Escape, focus back to the Link button', async () => {
    const user = userEvent.setup();
    renderInline();
    const opener = await toolbarButton('Link');
    await expectBuilderDialogContract(user, {
      open: () => press(user, opener),
      name: 'Link',
      returnTo: () => opener,
    });
  });

  it('icon: trapped, Escape, focus back to the icon button', async () => {
    const user = userEvent.setup();
    renderInline();
    const opener = await toolbarButton(PAGE_BUILDER_FIELD_TEXT['inlineIcon.insert']);
    await expectBuilderDialogContract(user, {
      open: () => press(user, opener),
      name: PAGE_BUILDER_FIELD_TEXT['inlineIcon.insert'],
      returnTo: () => opener,
    });
  });

  it('highlight colour: trapped, Escape, focus back to the colour button', async () => {
    const user = userEvent.setup();
    renderInline();
    const opener = await toolbarButton(PAGE_BUILDER_FIELD_TEXT['emphasisColor.button']);
    await expectBuilderDialogContract(user, {
      open: () => press(user, opener),
      name: PAGE_BUILDER_FIELD_TEXT['emphasisColor.title'],
      returnTo: () => opener,
    });
  });
});
