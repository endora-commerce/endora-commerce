import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Answers the kit's `ConfirmDialog` (issue #313) the way an operator would:
 * waits for the open dialog and presses its confirm button (`true`) or Cancel
 * (`false`). The footer holds Cancel first and the confirm button last, so the
 * answer does not depend on which label a screen chose or on the test bundle.
 * Returns the dialog, for assertions on its question.
 */
export async function answerConfirm(ok: boolean): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog');
  const buttons = within(dialog).getAllByRole('button');
  const target = ok ? buttons[buttons.length - 1] : buttons[0];
  if (!target) throw new Error('the confirmation dialog has no buttons');
  await userEvent.click(target);
  return dialog;
}
