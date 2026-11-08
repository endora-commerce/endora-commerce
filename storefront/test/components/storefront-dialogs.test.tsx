import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClearListButton } from '../../components/shopping-lists/ClearListButton';
import { DeleteShoppingListButton } from '../../components/shopping-lists/DeleteShoppingListButton';
import { NotifyWhenAvailableDialog } from '../../components/inventory/NotifyWhenAvailableDialog';

/**
 * Issue #804 — the storefront's three remaining hand-rolled dialogs are built
 * on `ModalDialog`: a native `<dialog>` opened with `showModal()` (the focus
 * trap and Escape), named by its title, closed on first paint and painted
 * with the semantic tokens rather than inline colours.
 *
 * Server-render assertions only (SSR-test convention); what the handlers do is
 * in `storefront-dialogs.wiring.test.tsx`.
 */

const noop = async (): Promise<void> => undefined;

const notifyLabels = {
  cta: 'Notify when available',
  dialogTitle: 'Get notified',
  emailLabel: 'Email address',
  submit: 'Notify me',
  submitting: 'Subscribing…',
  success: 'You will get an email.',
  errorGeneric: 'Could not subscribe.',
  cancel: 'Cancel',
  close: 'Close',
};

function dialogOf(html: string): string {
  const dialog = /<dialog\b[\s\S]*<\/dialog>/.exec(html)?.[0];
  if (!dialog) throw new Error('no <dialog> in the render');
  return dialog;
}

/** The dialog's accessible name: the text of the element its `aria-labelledby` points at. */
function nameOf(html: string): string | undefined {
  const id = /<dialog\b[^>]*\saria-labelledby="([^"]+)"/.exec(html)?.[1];
  if (!id) return undefined;
  return new RegExp(`<h2[^>]*\\sid="${id}"[^>]*>([^<]*)</h2>`).exec(html)?.[1];
}

function triggerOf(html: string): string | undefined {
  return /<button type="button"[^>]*aria-haspopup="dialog"[^>]*>([^<]*)<\/button>/.exec(html)?.[1];
}

/** No inline style and no literal colour: the tokens carry the paint, so dark mode and theme forks follow. */
function expectTokensOnly(dialog: string): void {
  expect(dialog).not.toMatch(/\sstyle="/);
  expect(dialog).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
}

const renders = {
  clear: (): string => renderToString(<ClearListButton listId="l1" locale="en-US" clearAction={noop} />),
  delete: (): string =>
    renderToString(<DeleteShoppingListButton listId="l1" listName="Site A" locale="en-US" deleteAction={noop} />),
  notify: (): string =>
    renderToString(
      <NotifyWhenAvailableDialog
        productId="p1"
        defaultEmail="buyer@example.com"
        salesChannelCode="b2b-pl"
        labels={notifyLabels}
      />,
    ),
};

describe.each([
  ['ClearListButton', renders.clear, 'Clear list', 'Clear this list?'],
  ['DeleteShoppingListButton', renders.delete, 'Delete', 'Delete this list?'],
  ['NotifyWhenAvailableDialog', renders.notify, 'Notify when available', 'Get notified'],
])('%s on ModalDialog (issue #804)', (_name, render, trigger, title) => {
  it('opens a native dialog from a button trigger', () => {
    const html = render();
    expect(triggerOf(html)).toBe(trigger);
    expect(html).not.toMatch(/role="dialog"/);
    expect(html).not.toContain('aria-modal');
  });

  it('is named by its title', () => {
    expect(nameOf(render())).toBe(title);
  });

  it('is closed on first paint', () => {
    expect(render()).not.toMatch(/<dialog\b[^>]*\sopen/);
  });

  it('carries a named close button', () => {
    expect(dialogOf(render())).toMatch(/<button type="button"[^>]*aria-label="Close"/);
  });

  it('is painted with the semantic tokens only', () => {
    expectTokensOnly(dialogOf(render()));
  });
});

describe.each([
  ['ClearListButton', renders.clear, 'Clear list'],
  ['DeleteShoppingListButton', renders.delete, 'Delete list'],
])('%s — a destructive confirmation (issue #804)', (_name, render, confirm) => {
  it('is an alertdialog described by its warning', () => {
    const html = render();
    expect(html).toMatch(/<dialog\b[^>]*\srole="alertdialog"/);
    expect(html).toMatch(/<dialog\b[^>]*\saria-describedby="[^"]+"/);
  });

  it('offers Cancel, focused on open, and a danger-styled confirm', () => {
    const foot = /<div class="b2b-dialog__foot">([\s\S]*?)<\/div>/.exec(dialogOf(render()))?.[1] ?? '';
    expect(foot).toMatch(/<button type="button" class="btn btn--outline"[^>]*data-autofocus=""[^>]*>Cancel<\/button>/);
    expect(foot).toMatch(new RegExp(`<button type="button" class="btn btn--danger"[^>]*>${confirm}</button>`));
    expect(foot.indexOf('Cancel')).toBeLessThan(foot.indexOf(confirm));
  });

  it('mounts a status region for a failed attempt before it has anything to say (PR #837)', () => {
    expect(dialogOf(render())).toMatch(/<div role="status"[^>]*><\/div>/);
  });
});

describe('NotifyWhenAvailableDialog — the form (issue #804)', () => {
  it('pre-fills the e-mail field and focuses it on open', () => {
    const dialog = dialogOf(renders.notify());
    const input = /<input\b[^>]*>/.exec(dialog)?.[0] ?? '';
    expect(input).toContain('type="email"');
    expect(input).toContain('required=""');
    expect(input).toContain('value="buyer@example.com"');
    expect(input).toContain('data-autofocus=""');
    const inputId = /\sid="([^"]+)"/.exec(input)?.[1];
    expect(dialog).toMatch(new RegExp(`<label for="${inputId}">Email address</label>`));
  });

  it('submits from the footer through the form attribute', () => {
    const dialog = dialogOf(renders.notify());
    const formId = /<form\b[^>]*\sid="([^"]+)"/.exec(dialog)?.[1];
    expect(formId).toBeTruthy();
    const foot = /<div class="b2b-dialog__foot">([\s\S]*?)<\/div>/.exec(dialog)?.[1] ?? '';
    expect(foot).toMatch(new RegExp(`<button type="submit"[^>]*form="${formId}"[^>]*>Notify me</button>`));
    expect(foot).toMatch(/<button type="submit" class="btn btn--primary"/);
    expect(foot).toMatch(/<button type="button" class="btn btn--outline"[^>]*>Cancel<\/button>/);
  });

  it('mounts its status region before it has anything to say', () => {
    expect(dialogOf(renders.notify())).toMatch(/<div role="status"[^>]*><\/div>/);
  });
});

/**
 * Issue #838 — the trigger is a secondary action on the product page: it sits
 * beside Add to cart, the view's one primary CTA, so it takes the outline
 * button the PDP's other secondary actions use. `b2b-cta` is the dark primary
 * atom and has no `--secondary` modifier, so the old class painted it primary.
 */
describe('NotifyWhenAvailableDialog — the trigger is a secondary action (issue #838)', () => {
  it('uses the outline button, not the dark primary CTA', () => {
    const trigger = /<button type="button"[^>]*aria-haspopup="dialog"[^>]*>/.exec(renders.notify())?.[0] ?? '';
    const classes = /\sclass="([^"]*)"/.exec(trigger)?.[1]?.split(/\s+/) ?? [];
    expect(classes).toEqual(expect.arrayContaining(['btn', 'btn--outline']));
    expect(classes.some((c) => c.startsWith('b2b-cta'))).toBe(false);
  });

  it('leaves no storefront source naming a b2b-cta modifier, none being defined', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
    const defined = new Set(css.match(/\.b2b-cta--[\w-]+/g)?.map((s) => s.slice(1)) ?? []);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) {
          for (const used of readFileSync(path, 'utf8').match(/\bb2b-cta--[\w-]+/g) ?? []) {
            if (!defined.has(used)) offenders.push(`${relative(root, path)}: ${used}`);
          }
        }
      }
    };
    for (const dir of ['app', 'components', 'lib']) walk(join(root, dir));
    expect(offenders).toEqual([]);
  });
});
