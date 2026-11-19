import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BoardCardFieldsEditor,
  type BoardCardFieldChoice,
  type BoardCardFieldsConfig,
  type BoardCardFieldsEditorCopy,
} from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * The board-card field editor, promoted into the kit from the two copies CRM
 * and Tasks kept side by side (issue #1506, UX audit 2026-11-17 WORK-15).
 *
 * **Where the catalogue and the limit come from is the caller's**: `load`
 * answers the stored choice, everything that can be chosen and the most a card
 * shows, and `save` answers the same shape after a write — so the kit knows
 * neither module's endpoint. What differs between the modules' screens (the
 * built-in group's name, the "title is always shown" line, where custom fields
 * come from) is `copy`; the rest of the copy is the kit's own `core` bundle.
 *
 * Pinned here: the order is set with buttons (WCAG 2.2 SC 2.5.7), the limit is
 * said before it is reached, focus stays with the field being worked on
 * (WCAG 2.4.3 — the Tasks copy's handling, issue #512), the server's own
 * sentence is shown on a refused save, a choice not saved is asked about before
 * a link leaves, and a failed read offers a retry.
 */

const CORE: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function core(key: string, values: Record<string, string | number> = {}): string {
  const template = CORE[key];
  if (template === undefined) throw new Error(`the shipped core bundle has no key "${key}"`);
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}

interface Field extends BoardCardFieldChoice {
  name: string;
}

const builtin = (key: string): Field => ({ ref: `builtin:${key}`, source: 'builtin', name: key });
const custom = (key: string): Field => ({ ref: `custom:${key}`, source: 'custom', name: key });

const NUMBER = builtin('Number');
const OWNER = builtin('Owner');
const DUE = builtin('Due');
const PRIORITY = builtin('Priority');
const REGION = custom('Region');
const VIP = custom('VIP');
const AVAILABLE: Field[] = [NUMBER, OWNER, DUE, PRIORITY, REGION, VIP];

const COPY: BoardCardFieldsEditorCopy = {
  titleAlways: 'The title is always shown.',
  builtinGroup: 'Record fields',
  noCustom: 'No custom fields are defined yet.',
};

const configOf = (fields: Field[], available: Field[] = AVAILABLE, maxFields = 4): BoardCardFieldsConfig<Field> => ({
  fields,
  available,
  maxFields,
});

let stored = configOf([NUMBER, OWNER, DUE]);
const load = vi.fn<() => Promise<BoardCardFieldsConfig<Field>>>();
const save = vi.fn<(refs: string[]) => Promise<BoardCardFieldsConfig<Field>>>();

beforeEach(() => {
  stored = configOf([NUMBER, OWNER, DUE]);
  load.mockReset();
  save.mockReset();
  load.mockImplementation(() => Promise.resolve(stored));
  save.mockImplementation((refs) => {
    stored = configOf(refs.map((ref) => AVAILABLE.find((field) => field.ref === ref)!));
    return Promise.resolve(stored);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderEditor(): Promise<HTMLElement> {
  renderWithI18n(
    <BoardCardFieldsEditor load={load} save={save} fieldLabel={(field: Field): string => field.name} copy={COPY} />,
    { core: CORE },
  );
  return screen.findByRole('region', { name: core('boardCardFields.shown.title') });
}

const shownNames = (region: HTMLElement): string[] =>
  within(region)
    .getAllByRole('listitem')
    .map((item) => (item.textContent ?? '').replace(/^\d+\./, '').trim());

const button = (key: string, field: string): HTMLElement => screen.getByRole('button', { name: core(key, { field }) });
const add = (field: string): HTMLElement => button('boardCardFields.add', field);
const saveButton = (): HTMLElement => screen.getByRole('button', { name: core('common.action.save') });

describe('BoardCardFieldsEditor — the catalogue and the limit from the caller', () => {
  it('shows the stored choice in its order, how many of how many, and the caller’s line about the title', async () => {
    const region = await renderEditor();
    expect(load).toHaveBeenCalledTimes(1);
    expect(shownNames(region)).toEqual(['Number', 'Owner', 'Due']);
    expect(within(region).getByRole('list', { name: core('boardCardFields.shown.title') })).toBeInTheDocument();
    expect(within(region).getByText(core('boardCardFields.shown.count', { count: 3, max: 4 }))).toBeInTheDocument();
    expect(within(region).getByText(COPY.titleAlways)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: COPY.builtinGroup })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: core('boardCardFields.available.custom') })).toBeInTheDocument();
    expect(add('Priority')).toBeEnabled();
    expect(add('Region')).toBeEnabled();
    expect(saveButton()).toBeDisabled();
  });

  it('stops at the caller’s maximum, saying why, and offers the field again once one is removed', async () => {
    const region = await renderEditor();
    await userEvent.click(add('Region'));
    expect(within(region).getByText(core('boardCardFields.shown.count', { count: 4, max: 4 }))).toBeInTheDocument();
    expect(screen.getByText(core('boardCardFields.available.full', { max: 4 }))).toBeInTheDocument();
    expect(add('VIP')).toBeDisabled();
    expect(add('Priority')).toBeDisabled();

    await userEvent.click(button('boardCardFields.remove', 'Owner'));
    expect(add('VIP')).toBeEnabled();
    expect(add('Owner')).toBeEnabled();
  });

  it('orders with buttons and saves the references in that order, then says so', async () => {
    const region = await renderEditor();
    await userEvent.click(add('Region'));
    const up = (): HTMLElement => button('boardCardFields.moveUp', 'Region');
    for (let step = 0; step < 3; step += 1) await userEvent.click(up());
    expect(up()).toBeDisabled();
    expect(shownNames(region)[0]).toBe('Region');
    await userEvent.click(button('boardCardFields.moveDown', 'Region'));

    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(['builtin:Number', 'custom:Region', 'builtin:Owner', 'builtin:Due']);
    expect(await screen.findByText(core('boardCardFields.saved'))).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('discards an edit back to the stored choice', async () => {
    const region = await renderEditor();
    await userEvent.click(button('boardCardFields.remove', 'Number'));
    await userEvent.click(screen.getByRole('button', { name: core('boardCardFields.discard') }));
    expect(shownNames(region)).toEqual(['Number', 'Owner', 'Due']);
    expect(saveButton()).toBeDisabled();
  });

  it('keeps focus on the moved row, or its neighbour, as the two lists change (WCAG 2.4.3, #512)', async () => {
    const region = await renderEditor();
    // Down into the last place, where Move down is disabled: the row's Move up.
    await userEvent.click(button('boardCardFields.moveDown', 'Owner'));
    expect(button('boardCardFields.moveUp', 'Owner')).toHaveFocus();
    // Up into the first place, where Move up is disabled: the row's Move down.
    await userEvent.click(button('boardCardFields.moveUp', 'Due'));
    expect(button('boardCardFields.moveDown', 'Due')).toHaveFocus();
    // A removed row: the row that took its place.
    await userEvent.click(button('boardCardFields.remove', 'Due'));
    expect(button('boardCardFields.remove', 'Number')).toHaveFocus();
    // The last row removed: the row before it.
    await userEvent.click(button('boardCardFields.remove', 'Owner'));
    expect(button('boardCardFields.remove', 'Number')).toHaveFocus();
    // No row left: the field's own Add.
    await userEvent.click(button('boardCardFields.remove', 'Number'));
    expect(add('Number')).toHaveFocus();
    // An added field's chip goes: the next one offered in its group.
    await userEvent.click(add('Number'));
    expect(add('Owner')).toHaveFocus();
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
  });

  it('puts focus on the added row once the card is full and every Add is disabled', async () => {
    await renderEditor();
    await userEvent.click(add('Region'));
    expect(button('boardCardFields.moveUp', 'Region')).toHaveFocus();
  });

  it('shows the server’s own sentence when the save is refused, and keeps the edit', async () => {
    save.mockRejectedValueOnce(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'A board card cannot show that field.' } }),
    );
    const region = await renderEditor();
    await userEvent.click(add('VIP'));
    await userEvent.click(saveButton());
    expect(await screen.findByText('A board card cannot show that field.')).toBeInTheDocument();
    expect(shownNames(region)).toContain('VIP');
    expect(saveButton()).toBeEnabled();
  });

  it('falls back to its own sentence when the failure carries none', async () => {
    save.mockRejectedValueOnce(new Error('offline'));
    await renderEditor();
    await userEvent.click(add('VIP'));
    await userEvent.click(saveButton());
    expect(await screen.findByText(core('boardCardFields.error.save'))).toBeInTheDocument();
  });

  it('says where custom fields come from when none is defined, and that every built-in one is shown', async () => {
    stored = configOf([NUMBER, OWNER, DUE, PRIORITY], [NUMBER, OWNER, DUE, PRIORITY], 6);
    await renderEditor();
    expect(screen.getByText(COPY.noCustom)).toBeInTheDocument();
    expect(screen.getByText(core('boardCardFields.available.allShown'))).toBeInTheDocument();
  });

  it('says a card with no field shows the title alone', async () => {
    stored = configOf([]);
    await renderEditor();
    expect(screen.getByText(core('boardCardFields.shown.empty'))).toBeInTheDocument();
  });

  it('offers a retry when the choice cannot be read', async () => {
    load.mockRejectedValueOnce(new Error('offline'));
    renderWithI18n(
      <BoardCardFieldsEditor load={load} save={save} fieldLabel={(field: Field): string => field.name} copy={COPY} />,
      { core: CORE },
    );
    expect(await screen.findByText(core('boardCardFields.error.load'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core('common.action.retry') }));
    expect(await screen.findByRole('region', { name: core('boardCardFields.shown.title') })).toBeInTheDocument();
  });

  it('asks before a link leaves with a choice not saved, and not once it is saved', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const region = await renderEditor();
    const link = document.createElement('a');
    link.href = '/elsewhere';
    link.textContent = 'Elsewhere';
    document.body.append(link);
    try {
      await userEvent.click(button('boardCardFields.remove', 'Owner'));
      fireEvent.click(link);
      expect(confirm).toHaveBeenCalledTimes(1);

      await userEvent.click(saveButton());
      await waitFor(() => expect(shownNames(region)).toEqual(['Number', 'Due']));
      await waitFor(() => expect(saveButton()).toBeDisabled());
      fireEvent.click(link);
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      link.remove();
    }
  });
});
