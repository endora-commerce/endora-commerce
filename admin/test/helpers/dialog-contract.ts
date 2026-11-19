import { screen, waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { expect } from 'vitest';
import { expectNoAxeViolations } from './axe';

type User = ReturnType<typeof userEvent.setup>;

/**
 * The contract every dialog opened from inside the Page Builder keeps (issue
 * #1493, UX audit CONTENT-03): it is a modal dialog named by its title, it opens
 * on the `overlay` layer above the fullscreen builder, focus moves into it and
 * Tab / Shift+Tab cannot leave it, axe finds nothing, Escape closes it, and
 * focus goes back to `returnTo` (the control that opened it, by default).
 *
 * Call it with the dialog **closed**; `open` opens it. Files using it install
 * `installOffsetParentShim()`, without which jsdom hides every element from the
 * kit's focus trap.
 */
export async function expectBuilderDialogContract(
  user: User,
  options: {
    open: () => Promise<void>;
    name: string | RegExp;
    /** Where focus must land after Escape. */
    returnTo: () => HTMLElement;
    /** Checked once the dialog is open and settled, before the Tab walk. */
    whenOpen?: (dialog: HTMLElement) => Promise<void> | void;
    /** Passed to axe; `false` where the dialog holds an `<iframe>`. */
    iframes?: boolean;
  },
): Promise<void> {
  await options.open();
  const dialog = await screen.findByRole('dialog', { name: options.name });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog.closest('[data-layer]')).toHaveAttribute('data-layer', 'overlay');
  await options.whenOpen?.(dialog);
  expect(dialog.contains(document.activeElement), 'focus moved into the dialog').toBe(true);

  for (let i = 0; i < 12; i += 1) {
    await user.tab();
    expect(dialog.contains(document.activeElement), `Tab ${i + 1} stayed in the dialog`).toBe(true);
  }
  for (let i = 0; i < 4; i += 1) {
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement), `Shift+Tab ${i + 1} stayed in the dialog`).toBe(true);
  }

  await expectNoAxeViolations(document.body, options.iframes === false ? { iframes: false } : {});

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: options.name })).toBeNull());
  expect(options.returnTo()).toHaveFocus();
}
