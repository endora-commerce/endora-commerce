import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ModalDialog, ModalDialogClose } from '../../components/ModalDialog';

/**
 * Issue #801 — the storefront's modal dialog primitive.
 *
 * Built on the native `<dialog>` opened with `showModal()`: the browser makes
 * the rest of the page inert (the focus trap), closes it on Escape, and the
 * component returns focus to the trigger on close. Those are browser
 * behaviours an SSR render cannot exercise (SSR-test convention); what the
 * markup carries — the trigger's relation to the dialog, the labelled title,
 * the named close button, the server-rendered body, closed on first paint — is
 * asserted here.
 */

function render(): string {
  return renderToString(
    <ModalDialog triggerLabel="What your role allows" title="What your role allows" closeLabel="Close">
      <ul>
        <li>SERVER_BODY</li>
      </ul>
    </ModalDialog>,
  );
}

describe('ModalDialog', () => {
  it('renders a button trigger that announces and controls the dialog', () => {
    const html = render();
    const dialogId = /<dialog\b[^>]*\sid="([^"]+)"/.exec(html)?.[1];
    expect(dialogId).toBeTruthy();
    const trigger = /<button type="button"[^>]*aria-haspopup="dialog"[^>]*>([^<]*)<\/button>/.exec(html);
    expect(trigger?.[0]).toContain(`aria-controls="${dialogId}"`);
    expect(trigger?.[1]).toBe('What your role allows');
  });

  it('labels the dialog with its title heading', () => {
    const html = render();
    const labelledBy = /<dialog\b[^>]*\saria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toMatch(new RegExp(`<h2[^>]*\\sid="${labelledBy}"[^>]*>What your role allows</h2>`));
  });

  it('carries a close button with an accessible name', () => {
    const dialog = /<dialog\b[\s\S]*?<\/dialog>/.exec(render())?.[0] ?? '';
    expect(dialog).toMatch(/<button type="button"[^>]*aria-label="Close"/);
  });

  it('server-renders its body inside the dialog, closed on first paint', () => {
    const html = render();
    const dialog = /<dialog\b[\s\S]*?<\/dialog>/.exec(html)?.[0] ?? '';
    expect(dialog).toContain('SERVER_BODY');
    expect(dialog).not.toMatch(/<dialog\b[^>]*\sopen/);
  });

  it('is a plain dialog by default — the native element carries the role', () => {
    const html = render();
    expect(html).not.toMatch(/<dialog\b[^>]*\srole=/);
    expect(html).not.toMatch(/<dialog\b[^>]*\saria-describedby=/);
  });
});

/**
 * Issue #804 — the extensions the confirmation and form dialogs need: an
 * actions footer, the alert-dialog role for a destructive confirmation, a
 * close control the caller's buttons are built from, and a stated initial
 * focus.
 */
describe('ModalDialog — footer, alert role and close controls (issue #804)', () => {
  function renderConfirm(): string {
    return renderToString(
      <ModalDialog
        triggerLabel="Clear list"
        title="Clear this list?"
        closeLabel="Close"
        role="alertdialog"
        footer={
          <>
            <ModalDialogClose className="btn btn--outline" initialFocus>
              Cancel
            </ModalDialogClose>
            <ModalDialogClose className="btn btn--danger">Clear list</ModalDialogClose>
          </>
        }
      >
        <p>CONFIRM_BODY</p>
      </ModalDialog>,
    );
  }

  it('marks a destructive confirmation as an alertdialog described by its body', () => {
    const html = renderConfirm();
    expect(html).toMatch(/<dialog\b[^>]*\srole="alertdialog"/);
    const describedBy = /<dialog\b[^>]*\saria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toMatch(new RegExp(`<div[^>]*\\sid="${describedBy}"[^>]*>\\s*<p>CONFIRM_BODY</p>`));
  });

  it('renders the footer inside the dialog, after the body', () => {
    const dialog = /<dialog\b[\s\S]*?<\/dialog>/.exec(renderConfirm())?.[0] ?? '';
    const foot = /<div class="b2b-dialog__foot">([\s\S]*?)<\/div>/.exec(dialog)?.[1] ?? '';
    expect(foot).toMatch(/<button type="button" class="btn btn--outline"[^>]*>Cancel<\/button>/);
    expect(foot).toMatch(/<button type="button" class="btn btn--danger"[^>]*>Clear list<\/button>/);
    expect(dialog.indexOf('CONFIRM_BODY')).toBeLessThan(dialog.indexOf('b2b-dialog__foot'));
  });

  it('flags the control that takes focus when the dialog opens', () => {
    const foot = /<div class="b2b-dialog__foot">([\s\S]*?)<\/div>/.exec(renderConfirm())?.[1] ?? '';
    expect(foot).toMatch(/<button[^>]*data-autofocus=""[^>]*>Cancel<\/button>/);
    expect(foot).not.toMatch(/<button[^>]*data-autofocus=""[^>]*>Clear list<\/button>/);
  });

  it('renders no footer when none is given', () => {
    expect(render()).not.toContain('b2b-dialog__foot');
  });

  it('disables the close button while the dialog is not dismissible', () => {
    const html = renderToString(
      <ModalDialog triggerLabel="t" title="T" closeLabel="Close" dismissible={false}>
        x
      </ModalDialog>,
    );
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Close"[^>]*disabled=""/);
  });
});

