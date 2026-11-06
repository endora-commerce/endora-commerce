import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ModalDialog } from '../../components/ModalDialog';

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
});
