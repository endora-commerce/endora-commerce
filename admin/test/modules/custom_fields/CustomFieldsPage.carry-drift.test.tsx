import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { CustomFieldDefinitionDto } from '@endora-commerce/contracts';
import { askAudienceChange, audienceButton, chooseRowAction } from './row-actions';
import { findEditor, renderCustomFieldsRoutes } from './routes-harness';
import { expectNoAxeViolations } from '../../helpers/axe';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';
import { CARRY_ENTITY_TYPES, carryDefinition, sentence } from './carry-fixtures';

/**
 * Feature 162 (T043, US4-6, US4-8, SC-007, FR-019) — a change that would stop
 * an enabled carry from working asks first, in the page, naming every field on
 * the other side; *Cancel* sends nothing and the proceed button — named after
 * the action it confirms (owner ruling V1, 2026-10-21, T065) — sends exactly
 * what the action sent before
 * (`specs/162-custom-fields-value-carry/contracts/admin-surfaces.md` §1.4).
 * Since issue #1804 the editor is a page of its own, so the warning it asks
 * is a dialog over that page, as the table's is over the list.
 */

type Bundle = Record<string, string>;
const EN = en as Bundle;
const PL = pl as Bundle;
const WARNING = sentence(EN, 'customFields.carry.warning.title');
const CANCEL = sentence(EN, 'customFields.carry.warning.cancel');
const BODY = sentence(EN, 'customFields.carry.warning.body');
const REMOVE_OPTION_ANYWAY = sentence(EN, 'customFields.carry.warning.proceedRemoveOption');
const DELETE_FIELD_ANYWAY = sentence(EN, 'customFields.carry.warning.proceedDeleteField');
const ADD_OPTION_ANYWAY = sentence(EN, 'customFields.carry.warning.proceedAddOption');
const CHANGE_AUDIENCE_ANYWAY = sentence(EN, 'customFields.carry.warning.proceedChangeAudience');
const CORE_EN = coreEn as Bundle;
/** The audience control's confirm button for a move to customer-visible (issue #1749). */
const CHANGE_TO_CUSTOMER = sentence(CORE_EN, 'common.statusChange.confirm', {
  status: sentence(EN, 'customFields.audience.customer'),
});

/** Internal, offers north + south, carries to the Order field of the same key. */
const QR_REGION = carryDefinition('00000000-0000-4000-8000-0000000d0001', { carryTo: ['order'] });
/** The carry's target: compatible today. */
const ORDER_REGION = carryDefinition('00000000-0000-4000-8000-0000000d0002', { entityType: 'order' });
/** Takes part in no carry. */
const ORDER_NOTE = carryDefinition('00000000-0000-4000-8000-0000000d0003', {
  entityType: 'order',
  key: 'note',
  valueType: 'text',
  optionValues: [],
});

const db = vi.hoisted(() => ({ definitions: [] as CustomFieldDefinitionDto[] }));
const client = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  createOption: vi.fn(),
  removeOption: vi.fn(),
}));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => CARRY_ENTITY_TYPES,
    list: async (entityType?: string) => {
      client.list(entityType);
      return db.definitions.filter((d) => entityType === undefined || d.entityType === entityType);
    },
    get: async (id: string) => db.definitions.find((d) => d.id === id),
    create: async () => ({}),
    update: (...args: unknown[]) => client.update(...args),
    remove: (...args: unknown[]) => client.remove(...args),
    createOption: (...args: unknown[]) => client.createOption(...args),
    updateOption: async () => ({}),
    removeOption: (...args: unknown[]) => client.removeOption(...args),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);
const { CustomFieldEditorPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldEditorPage'
);

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  db.definitions = [QR_REGION, ORDER_REGION, ORDER_NOTE];
  for (const fn of Object.values(client)) fn.mockReset();
  client.update.mockResolvedValue({});
  client.remove.mockResolvedValue({});
  client.createOption.mockResolvedValue({ id: 'new', value: 'east' });
  client.removeOption.mockResolvedValue(undefined);
  nativeDialogs = [
    vi.spyOn(window, 'confirm').mockImplementation(() => false),
    vi.spyOn(window, 'prompt').mockImplementation(() => null),
    vi.spyOn(window, 'alert').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const spy of nativeDialogs) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function renderPage(
  entityType: 'quote_request' | 'order',
  bundle: Bundle = EN,
  core: Bundle = coreEn as Bundle,
): Promise<void> {
  renderCustomFieldsRoutes({ CustomFieldsPage, CustomFieldEditorPage }, { bundle: { custom_fields: bundle, core } });
  const recordType = sentence(bundle, 'customFields.form.entity');
  await waitFor(() =>
    expect(within(screen.getByLabelText(recordType)).getAllByRole('option').map((o) => o.textContent)).toContain(
      sentence(bundle, 'customFields.entity.order'),
    ),
  );
  fireEvent.change(screen.getByLabelText(recordType), { target: { value: entityType } });
  await waitFor(() => expect(client.list).toHaveBeenCalledWith(entityType));
  await waitFor(() => expect(client.list).toHaveBeenCalledWith(undefined));
  await screen.findByRole('row', { name: /region/ });
}

async function openEditor(key = 'region', bundle: Bundle = EN): Promise<HTMLElement> {
  const title = sentence(bundle, 'customFields.editor.title', { key });
  await chooseRowAction(key, 'edit', bundle);
  return findEditor(title);
}

/** The editor page of `region`, after the warning over it was answered. */
const regionEditor = (): Promise<HTMLElement> => findEditor(sentence(EN, 'customFields.editor.title', { key: 'region' }));

/** The warning lists exactly these "<type> · <key>" lines. */
function expectCounterparts(warning: HTMLElement, lines: string[]): void {
  expect(within(warning).getAllByRole('listitem').map((item) => item.textContent)).toEqual(lines);
}

const REQUESTS = (): number =>
  client.update.mock.calls.length +
  client.remove.mock.calls.length +
  client.createOption.mock.calls.length +
  client.removeOption.mock.calls.length;

describe('CustomFieldsPage — drift warnings', () => {
  describe('removing an option a carrying source holds', () => {
    async function askToRemoveSouth(): Promise<HTMLElement> {
      await renderPage('order');
      const dialog = await openEditor();
      const south = within(dialog).getByRole('group', { name: 'South' });
      fireEvent.click(within(south).getByRole('button', { name: 'Remove' }));
      return screen.findByRole('dialog', { name: WARNING });
    }

    it('asks first, naming the source, and sends nothing on Cancel', async () => {
      const warning = await askToRemoveSouth();
      expectCounterparts(warning, ['Quote request · region']);
      expect(within(warning).getByRole('button', { name: CANCEL })).toHaveFocus();
      expect(REQUESTS()).toBe(0);
      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      // The editor comes back as it was, the removal not asked again in the row.
      const editor = await regionEditor();
      expect(within(editor).getByRole('group', { name: 'South' })).toBeInTheDocument();
      expect(REQUESTS()).toBe(0);
    });

    it('asks in a dialog of its own over the editor, described by the warning, and gives focus back on Cancel', async () => {
      await renderPage('order');
      const editor = await openEditor();
      const remove = within(within(editor).getByRole('group', { name: 'South' })).getByRole('button', { name: 'Remove' });
      remove.focus();
      fireEvent.click(remove);
      const warning = await screen.findByRole('dialog', { name: WARNING });
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(editor).not.toContainElement(warning);
      expect(warning).toHaveAccessibleDescription(expect.stringContaining(BODY));
      expect(warning).toHaveAccessibleDescription(expect.stringContaining('Quote request · region'));
      // Focus starts on the answer that changes nothing.
      expect(within(warning).getByRole('button', { name: CANCEL })).toHaveFocus();

      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(remove).toHaveFocus());
    });

    it('removes the option exactly as before on Remove option anyway', async () => {
      const warning = await askToRemoveSouth();
      fireEvent.click(within(warning).getByRole('button', { name: REMOVE_OPTION_ANYWAY }));
      await waitFor(() => expect(client.removeOption).toHaveBeenCalledTimes(1));
      expect(client.removeOption).toHaveBeenCalledWith(ORDER_REGION.id, ORDER_REGION.options[1]!.id);
      expect(REQUESTS()).toBe(1);
    });

    it('leaves focus on the options heading once the option is gone, not on the page', async () => {
      const warning = await askToRemoveSouth();
      // The re-read answers the definition without "south".
      db.definitions = [QR_REGION, { ...ORDER_REGION, options: [ORDER_REGION.options[0]!] }, ORDER_NOTE];
      fireEvent.click(within(warning).getByRole('button', { name: REMOVE_OPTION_ANYWAY }));
      const editor = await regionEditor();
      await waitFor(() => expect(within(editor).queryByRole('group', { name: 'South' })).toBeNull());
      // Named by the section and its *Applies immediately* badge (issue #1804).
      const heading = within(editor).getByRole('heading', {
        name: new RegExp(`^${sentence(EN, 'customFields.editor.section.options')}`),
      });
      expect(heading).toHaveFocus();
    });

    it('draws the warning icon in the destructive colour for a removal', async () => {
      const warning = await askToRemoveSouth();
      const icon = warning.querySelector('svg');
      expect(icon).toHaveClass('text-destructive');
    });
  });

  describe('adding an option the target lacks', () => {
    async function askToAddEast(): Promise<HTMLElement> {
      await renderPage('quote_request');
      const dialog = await openEditor();
      const add = within(dialog).getByRole('group', { name: 'Add option' });
      fireEvent.change(within(add).getByLabelText('Stored value'), { target: { value: 'east' } });
      fireEvent.change(within(add).getByLabelText('Default label'), { target: { value: 'East' } });
      fireEvent.click(within(add).getByRole('button', { name: 'Add option' }));
      return screen.findByRole('dialog', { name: WARNING });
    }

    it('asks first, naming the target, and keeps the typed option on Cancel', async () => {
      const warning = await askToAddEast();
      expectCounterparts(warning, ['Order · region']);
      // An added option loses nothing: the icon reads as a caution, not a loss.
      const icon = warning.querySelector('svg');
      expect(icon).not.toHaveClass('text-destructive');
      expect(icon).toHaveClass('text-amber-700');
      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      const editor = await regionEditor();
      expect(within(within(editor).getByRole('group', { name: 'Add option' })).getByLabelText('Stored value')).toHaveValue('east');
      expect(REQUESTS()).toBe(0);
    });

    it('adds the option exactly as before on Add option anyway', async () => {
      const warning = await askToAddEast();
      fireEvent.click(within(warning).getByRole('button', { name: ADD_OPTION_ANYWAY }));
      await waitFor(() => expect(client.createOption).toHaveBeenCalledTimes(1));
      expect(client.createOption).toHaveBeenCalledWith(QR_REGION.id, {
        value: 'east',
        labelDefault: 'East',
        label: {},
        isDefault: false,
        sortOrder: 2,
      });
    });
  });

  /**
   * The row's audience is the kit `StatusChangeControl` (issue #1749, README
   * *A value edited from the row*): its confirm step is the one question, and
   * the warning stands on it — never a second dialog after it.
   */
  describe('making the target visible to customers under an internal source', () => {
    it('warns on the confirm step, naming the source, and sends nothing on Back and Cancel', async () => {
      await renderPage('order');
      const confirm = await askAudienceChange('region', EN, CORE_EN);
      expect(within(confirm).getByText(BODY, { exact: false })).toBeInTheDocument();
      // Read with the summary as focus enters the confirm step.
      expect(confirm).toHaveAccessibleDescription(expect.stringContaining(BODY));
      expect(confirm).toHaveAccessibleDescription(expect.stringContaining('Quote request · region'));
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      fireEvent.click(within(confirm).getByRole('button', { name: sentence(CORE_EN, 'common.action.back') }));
      const choose = await screen.findByRole('dialog', { name: sentence(EN, 'customFields.audience.rowLabel', { key: 'region' }) });
      fireEvent.click(within(choose).getByRole('button', { name: sentence(CORE_EN, 'common.action.cancel') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(audienceButton('region', EN, CORE_EN).closest('div')).toHaveTextContent(sentence(EN, 'customFields.audience.internal'));
      expect(REQUESTS()).toBe(0);
    });

    it('sends the audience exactly as before once the change is confirmed, asking nothing more', async () => {
      await renderPage('order');
      const confirm = await askAudienceChange('region', EN, CORE_EN);
      fireEvent.click(within(confirm).getByRole('button', { name: CHANGE_TO_CUSTOMER }));
      await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
      expect(client.update).toHaveBeenCalledWith(ORDER_REGION.id, { audience: 'customer' });
      expect(screen.queryByRole('dialog', { name: WARNING })).toBeNull();
    });
  });

  describe('changing the audience in the editor (issue #447)', () => {
    async function askFromDialog(): Promise<{ dialog: HTMLElement }> {
      await renderPage('order');
      const dialog = await openEditor();
      fireEvent.change(within(dialog).getByLabelText(sentence(EN, 'customFields.audience.label')), {
        target: { value: 'customer' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await screen.findByRole('dialog', { name: WARNING });
      return { dialog };
    }

    it('asks first, naming the source, and sends nothing on Cancel — the editor keeps the choice', async () => {
      await askFromDialog();
      const warning = screen.getByRole('dialog', { name: WARNING });
      expectCounterparts(warning, ['Quote request · region']);
      expect(within(warning).getByRole('button', { name: CANCEL })).toHaveFocus();
      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: WARNING })).toBeNull());
      const dialog = await regionEditor();
      expect(within(dialog).getByLabelText(sentence(EN, 'customFields.audience.label'))).toHaveValue('customer');
      expect(REQUESTS()).toBe(0);
    });

    it('saves the audience on Change audience anyway', async () => {
      await askFromDialog();
      fireEvent.click(screen.getByRole('button', { name: CHANGE_AUDIENCE_ANYWAY }));
      await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
      expect(client.update).toHaveBeenCalledWith(ORDER_REGION.id, { audience: 'customer' });
    });
  });

  describe('deleting a definition that is part of an enabled carry', () => {
    it('asks once, in the warning, and sends nothing on Cancel', async () => {
      await renderPage('order');
      await chooseRowAction('region', 'delete', EN);
      const warning = await screen.findByRole('dialog', { name: WARNING });
      // The warning is the one question: no kit confirmation before or beside it.
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(within(warning).getByText(sentence(EN, 'customFields.table.deleteConfirm', { key: 'region' }))).toBeInTheDocument();
      expectCounterparts(warning, ['Quote request · region']);
      expect(warning).toHaveAccessibleDescription(
        expect.stringContaining(sentence(EN, 'customFields.table.deleteConfirm', { key: 'region' })),
      );
      expect(warning).toHaveAccessibleDescription(expect.stringContaining(BODY));
      expect(warning.querySelector('svg')).toHaveClass('text-destructive');
      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(REQUESTS()).toBe(0);
    });

    it('deletes exactly as before on Delete field anyway', async () => {
      await renderPage('quote_request');
      await chooseRowAction('region', 'delete', EN);
      const warning = await screen.findByRole('dialog', { name: WARNING });
      expectCounterparts(warning, ['Order · region']);
      fireEvent.click(within(warning).getByRole('button', { name: DELETE_FIELD_ANYWAY }));
      await waitFor(() => expect(client.remove).toHaveBeenCalledTimes(1));
      expect(client.remove).toHaveBeenCalledWith(QR_REGION.id);
    });

    it('says a refused deletion above the rows, which stay on screen (issue #1749)', async () => {
      client.remove.mockRejectedValue(new Error('boom'));
      await renderPage('quote_request');
      await chooseRowAction('region', 'delete', EN);
      const warning = await screen.findByRole('dialog', { name: WARNING });
      fireEvent.click(within(warning).getByRole('button', { name: DELETE_FIELD_ANYWAY }));
      expect(await screen.findByText(sentence(EN, 'customFields.error.action'))).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /region/ })).toBeInTheDocument();
    });
  });

  /**
   * Owner ruling V1 (T065): the proceed button names the action — never a bare
   * "Continue" — and stays destructive-styled for a removal or a deletion.
   */
  describe.each([
    ['en', EN, coreEn as Bundle],
    ['pl', PL, corePl as Bundle],
  ] as const)('the proceed button names the action (%s)', (_language, bundle, core) => {
    const say = (key: string, params: Record<string, string> = {}): string => sentence(bundle, key, params);
    const title = (): string => say('customFields.carry.warning.title');
    /** The warning's only two buttons, *Cancel* first, and the proceed button's name. */
    function expectButtons(warning: HTMLElement, proceedKey: string, destructive: boolean): void {
      const buttons = within(warning).getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual([say('customFields.carry.warning.cancel'), say(proceedKey)]);
      const proceed = buttons[1]!;
      if (destructive) expect(proceed).toHaveClass('bg-destructive');
      else expect(proceed).not.toHaveClass('bg-destructive');
      // The old generic labels are gone from both bundles.
      expect(bundle['customFields.carry.warning.proceed']).toBeUndefined();
      expect(bundle['customFields.carry.warning.proceedSave']).toBeUndefined();
    }

    it('reads "remove option anyway", destructive, for removing an option a carry needs', async () => {
      await renderPage('order', bundle, core);
      const dialog = await openEditor('region', bundle);
      const south = within(dialog).getByRole('group', { name: 'South' });
      fireEvent.click(within(south).getByRole('button', { name: say('customFields.editor.option.remove') }));
      const warning = await screen.findByRole('dialog', { name: title() });
      const proceed = within(warning).getByRole('button', { name: say('customFields.carry.warning.proceedRemoveOption') });
      expect(proceed).toHaveClass('bg-destructive');
      fireEvent.click(proceed);
      await waitFor(() => expect(client.removeOption).toHaveBeenCalledTimes(1));
    });

    it('reads "add option anyway", not destructive, for adding an option the target lacks', async () => {
      await renderPage('quote_request', bundle, core);
      const dialog = await openEditor('region', bundle);
      const add = within(dialog).getByRole('group', { name: say('customFields.editor.option.add') });
      fireEvent.change(within(add).getByLabelText(say('customFields.editor.option.value')), { target: { value: 'east' } });
      fireEvent.change(within(add).getByLabelText(say('customFields.editor.labelDefault')), { target: { value: 'East' } });
      fireEvent.click(within(add).getByRole('button', { name: say('customFields.editor.option.add') }));
      const warning = await screen.findByRole('dialog', { name: title() });
      expectButtons(warning, 'customFields.carry.warning.proceedAddOption', false);
      const proceed = within(warning).getByRole('button', { name: say('customFields.carry.warning.proceedAddOption') });
      fireEvent.click(proceed);
      await waitFor(() => expect(client.createOption).toHaveBeenCalledTimes(1));
    });

    it('names the change, not destructive, on the confirm step of the row audience control', async () => {
      await renderPage('order', bundle, core);
      const confirm = await askAudienceChange('region', bundle, core);
      const proceed = within(confirm).getByRole('button', {
        name: sentence(core, 'common.statusChange.confirm', { status: say('customFields.audience.customer') }),
      });
      expect(proceed).not.toHaveClass('bg-destructive');
      expect(confirm).toHaveAccessibleDescription(expect.stringContaining(say('customFields.carry.warning.body')));
    });

    it('reads "delete field anyway", destructive, for deleting a field a carry needs', async () => {
      await renderPage('quote_request', bundle, core);
      await chooseRowAction('region', 'delete', bundle);
      const warning = await screen.findByRole('dialog', { name: title() });
      expectButtons(warning, 'customFields.carry.warning.proceedDeleteField', true);
    });
  });

  describe('accessibility', () => {
    it('has no axe violations with the warning open in the editor and over the table', async () => {
      await renderPage('order');
      const dialog = await openEditor();
      fireEvent.click(within(within(dialog).getByRole('group', { name: 'South' })).getByRole('button', { name: 'Remove' }));
      await expectNoAxeViolations(await screen.findByRole('dialog', { name: WARNING }));
      fireEvent.keyDown(document, { key: 'Escape' });
      // Escape answers the warning; the editor page under it stays.
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(await regionEditor()).toBeInTheDocument();
      // Nothing changed, so the way back asks nothing.
      fireEvent.click(screen.getByRole('link', { name: sentence(EN, 'customFields.title') }));
      await screen.findByRole('row', { name: /region/ });

      await chooseRowAction('region', 'delete', EN);
      await expectNoAxeViolations(await screen.findByRole('dialog', { name: WARNING }));
      expect(REQUESTS()).toBe(0);
    });
  });

  describe('a change that breaks nothing', () => {
    it('warns of nothing when the audience change is one the rule allows', async () => {
      await renderPage('quote_request');
      const confirm = await askAudienceChange('region', EN, CORE_EN);
      expect(within(confirm).queryByText(BODY, { exact: false })).toBeNull();
      fireEvent.click(within(confirm).getByRole('button', { name: CHANGE_TO_CUSTOMER }));
      await waitFor(() => expect(client.update).toHaveBeenCalledWith(QR_REGION.id, { audience: 'customer' }));
      expect(screen.queryByRole('dialog', { name: WARNING })).toBeNull();
    });

    it('confirms a deletion no carry depends on in the kit confirmation, not the warning', async () => {
      await renderPage('order');
      await chooseRowAction('note', 'delete', EN);
      const confirm = await screen.findByRole('dialog');
      expect(screen.queryByRole('dialog', { name: WARNING })).toBeNull();
      expect(confirm).toHaveAccessibleDescription(sentence(EN, 'customFields.table.deleteConfirm', { key: 'note' }));
    });

    it('keeps the in-row confirmation for an option no source holds', async () => {
      db.definitions = [QR_REGION, carryDefinition(ORDER_REGION.id, { entityType: 'order', optionValues: ['north', 'south', 'west'] })];
      await renderPage('order');
      const dialog = await openEditor();
      fireEvent.click(within(within(dialog).getByRole('group', { name: 'West' })).getByRole('button', { name: 'Remove' }));
      expect(screen.queryByRole('dialog', { name: WARNING })).toBeNull();
      expect(within(dialog).getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    });
  });
});
