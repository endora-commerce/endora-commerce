import { screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Issue #1527 (UX audit CAT-12) — the attribute list opens its one editor in a
 * dialog: from the attribute's name in the row, or from *New attribute* (in the
 * header, or in the empty state while there is no attribute). These open it the
 * way an operator does and hand back the dialog, which holds the form and its
 * footer Save.
 */

/** The table row of the attribute whose key is shown as `key`. */
export async function rowOf(key: string): Promise<HTMLElement> {
  const cell = await screen.findByText(key, { selector: 'code' });
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row for ${key}`);
  return row as HTMLElement;
}

/** Opens the attribute's editor by its name — the row's first button. */
export async function openAttribute(user: UserEvent, key: string): Promise<HTMLElement> {
  const row = await rowOf(key);
  await user.click(within(row).getAllByRole('button')[0]!);
  return screen.findByRole('dialog');
}

/**
 * Opens the blank editor from *New attribute*, named `label`. It waits for the
 * list to load first: while it loads the header carries the button, and once
 * an empty list arrives the empty state carries it instead.
 */
export async function openNewAttribute(user: UserEvent, label: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.queryByTestId('list-page-skeleton')).toBeNull());
  await user.click(screen.getByRole('button', { name: label }));
  return screen.findByRole('dialog');
}
