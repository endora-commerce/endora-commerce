import { fireEvent, screen, within } from '@testing-library/react';

/**
 * The `/custom-fields` row's actions (issue #1749): *Edit* and *Delete* sit in
 * the row's kit `RowActionMenu`, named "Actions for <key>", and the audience is
 * a kit `StatusChangeControl`. Shared by the page's suites so each opens them
 * the way an operator does.
 */

type Bundle = Record<string, string>;

function fill(bundle: Bundle, key: string, params: Record<string, string> = {}): string {
  const text = bundle[key];
  if (text === undefined) throw new Error(`No bundle entry ${key}`);
  return text.replace(/\{(\w+)\}/g, (_m, name: string) => params[name] ?? '');
}

/** Opens the row menu of the definition `key`; resolves the open menu. */
export async function openRowMenu(key: string, bundle: Bundle): Promise<HTMLElement> {
  const trigger = await screen.findByRole('button', { name: fill(bundle, 'customFields.table.actions', { key }) });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return screen.findByRole('menu');
}

/** Chooses *Edit* or *Delete* from the row menu of the definition `key`. */
export async function chooseRowAction(key: string, action: 'edit' | 'delete', bundle: Bundle): Promise<void> {
  const menu = await openRowMenu(key, bundle);
  const item = action === 'edit' ? 'customFields.table.edit' : 'customFields.table.deleteAction';
  fireEvent.click(within(menu).getByRole('menuitem', { name: fill(bundle, item) }));
}

/** The row's audience control: its *Change…* button, named by the column's label for the row. */
export function audienceButton(key: string, bundle: Bundle, core: Bundle): HTMLElement {
  const name = `${fill(core, 'common.statusChange.change')} ${fill(bundle, 'customFields.audience.rowLabel', { key })}`;
  return screen.getByRole('button', { name });
}

/**
 * Walks the audience control to its confirm step for the definition `key`:
 * opens it and continues with the one other audience, which the control picks
 * itself. Resolves the dialog on its confirm step.
 */
export async function askAudienceChange(key: string, bundle: Bundle, core: Bundle): Promise<HTMLElement> {
  fireEvent.click(audienceButton(key, bundle, core));
  const choose = await screen.findByRole('dialog', { name: fill(bundle, 'customFields.audience.rowLabel', { key }) });
  fireEvent.click(within(choose).getByRole('button', { name: fill(core, 'common.statusChange.continue') }));
  return screen.findByRole('dialog', { name: fill(core, 'common.statusChange.confirmTitle') });
}
