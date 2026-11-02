import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormDefinition } from '@endora-commerce/contracts';
import { LANGUAGE, definition, en, renderForms } from './forms-fixtures';

/**
 * The builder's *Translations* tab (`specs/170-forms-module/` User Story 7, T101; FR-068,
 * research R-7): one structure, texts per storefront language. Switching the language edits **only**
 * that language's texts — every operator text of the form listed beside its default-language
 * original — and nothing of the structure, the logic or the validation is editable there (US7-1).
 * A language with texts that fall back to the default is marked, and so is each such text (US7-2).
 */

const { TranslationsPanel } = await import('../../../../packages/modules/forms/src/admin/components/TranslationsPanel');

const POLISH = 'pl-PL';

const SOURCE = definition({
  sections: [
    {
      id: 's1',
      columns: 1,
      fields: [
        { id: 'f1', type: 'text', key: 'name', required: true },
        {
          id: 'f2',
          type: 'select',
          key: 'topic',
          options: [
            { id: 'o1', value: 'sales' },
            { id: 'o2', value: 'help' },
          ],
        },
      ],
    },
  ],
  texts: {
    [LANGUAGE]: {
      'form.title': 'Contact',
      'fields.f1.label': 'Name',
      'fields.f1.placeholder': 'Your name',
      'fields.f2.label': 'Topic',
      'fields.f2.options.o1': 'Sales',
      'fields.f2.options.o2': 'Help',
      'messages.closed': 'We are closed.',
      'email.confirmation.subject': 'Thanks',
    },
    [POLISH]: { 'form.title': 'Kontakt', 'fields.f1.label': 'Imię' },
  },
});

interface Harness {
  latest(): FormDefinition;
}

function renderPanel(options: { definition?: FormDefinition; disabled?: boolean; languages?: string[] } = {}): Harness {
  let current = options.definition ?? SOURCE;
  const changed = vi.fn();
  function Host(): ReactNode {
    const [draft, setDraft] = useState(current);
    return (
      <TranslationsPanel
        definition={draft}
        languages={options.languages ?? [LANGUAGE, POLISH]}
        defaultLanguage={LANGUAGE}
        disabled={options.disabled ?? false}
        onDefinitionChange={(next) => {
          current = next;
          changed(next);
          setDraft(next);
        }}
      />
    );
  }
  renderForms(<Host />);
  return { latest: () => current };
}

const tab = (language: string) => screen.getByRole('tab', { name: new RegExp(language) });

describe('TranslationsPanel (US7-1, US7-2)', () => {
  it('offers every storefront language, the default first and selected', () => {
    renderPanel();
    const tabs = screen.getAllByRole('tab').map((element) => element.textContent);
    expect(tabs[0]).toContain(LANGUAGE);
    expect(tabs[1]).toContain(POLISH);
    expect(tab(LANGUAGE)).toHaveAttribute('aria-selected', 'true');
  });

  it('lists each text of the form beside its default-language original', async () => {
    renderPanel();
    await userEvent.click(tab(POLISH));
    const title = screen.getByRole('textbox', { name: new RegExp(en('translations.text.title')) });
    expect(title).toHaveValue('Kontakt');
    // The original is shown, read only, as the reference.
    expect(screen.getByText('Contact')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: new RegExp(`${en('inspector.placeholder')}.*Name`) })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: new RegExp(`${en('translations.text.option', { value: 'help' })}`) })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: new RegExp(en('settings.restrictions.closedMessage')) })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: new RegExp(en('notifications.confirmation.subject')) })).toHaveValue('');
  });

  it('edits only the chosen language’s texts — the structure and the other languages stay', async () => {
    const harness = renderPanel();
    await userEvent.click(tab(POLISH));
    await userEvent.type(screen.getByRole('textbox', { name: new RegExp(`${en('translations.text.option', { value: 'help' })}`) }), 'Pomoc');
    const next = harness.latest();
    expect(next.texts[POLISH]).toEqual({ 'form.title': 'Kontakt', 'fields.f1.label': 'Imię', 'fields.f2.options.o2': 'Pomoc' });
    expect(next.texts[LANGUAGE]).toEqual(SOURCE.texts[LANGUAGE]);
    expect(next.sections).toEqual(SOURCE.sections);
    expect(next.behaviour).toEqual(SOURCE.behaviour);
    expect(next.restrictions).toEqual(SOURCE.restrictions);
  });

  it('has no control of the structure, the logic or the validation', async () => {
    renderPanel();
    await userEvent.click(tab(POLISH));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('button', { name: en('canvas.addField') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('canvas.addSection') })).toBeNull();
    expect(screen.queryByLabelText(en('inspector.key'))).toBeNull();
    expect(screen.queryByLabelText(en('inspector.required'))).toBeNull();
    // Every control there is a text of the chosen language.
    for (const textbox of screen.getAllByRole('textbox')) expect(textbox).not.toHaveAttribute('readonly');
  });

  it('marks an incomplete language and each of its texts that falls back', async () => {
    renderPanel();
    // Next to the language switch, whichever language is open: six of the eight English texts have
    // no Polish. The default language is never incomplete.
    const summary = screen.getByRole('list', { name: en('translations.status') });
    expect(within(summary).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      en('translations.incomplete', { language: POLISH, count: 6 }),
    ]);
    await userEvent.click(tab(POLISH));
    const fallback = screen.getAllByText(en('translations.fallsBack', { language: LANGUAGE }));
    expect(fallback).toHaveLength(6);
  });

  it('says a language is complete once every text is translated', async () => {
    const complete = definition({
      texts: { [LANGUAGE]: { 'form.title': 'Contact' }, [POLISH]: { 'form.title': 'Kontakt' } },
    });
    renderPanel({ definition: complete });
    await userEvent.click(tab(POLISH));
    expect(screen.getByText(en('translations.complete', { language: POLISH }))).toBeInTheDocument();
  });

  it('edits the default language too, which every other language falls back to', async () => {
    const harness = renderPanel();
    const title = screen.getByRole('textbox', { name: new RegExp(en('translations.text.title')) });
    await userEvent.clear(title);
    await userEvent.type(title, 'Write to us');
    expect(harness.latest().texts[LANGUAGE]?.['form.title']).toBe('Write to us');
    expect(within(screen.getByRole('tabpanel')).queryByText(en('translations.fallsBack', { language: LANGUAGE }))).toBeNull();
  });

  it('is read only for an operator who cannot write', async () => {
    renderPanel({ disabled: true });
    await userEvent.click(tab(POLISH));
    for (const textbox of screen.getAllByRole('textbox')) expect(textbox).toBeDisabled();
  });
});
