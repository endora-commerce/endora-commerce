import { describe, expect, it } from 'vitest';
import { formDefinitionSchema, type FormDefinition } from '@endora-commerce/contracts';
import { firstMissingText, placeOfText, textOrder } from './text-catalogue.js';

/**
 * Where the builder's language switch takes the operator (`specs/170-forms-module/` User Story 7;
 * 2026-11-03 owner review): the first missing text **in the form's reading order** — the contracts'
 * `textCompleteness` answers the ids sorted by name — and the tab and field that edit it.
 */

const DEFINITION: FormDefinition = formDefinitionSchema.parse({
  schemaVersion: 1,
  sections: [
    {
      id: 's1',
      columns: 1,
      fields: [
        { id: 'f_b', type: 'select', key: 'topic', options: [{ id: 'o1', value: 'sales' }] },
        { id: 'f_a', type: 'text', key: 'name' },
      ],
    },
  ],
  behaviour: { confirmation: { type: 'message' }, captchaRequired: false, confirmationEmail: { enabled: false, includeSummary: false } },
  restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
  texts: { en: { 'fields.f_b.errors.required': 'Pick one' } },
});

describe('text catalogue', () => {
  it('lists the texts in reading order, with an error message only where one was written', () => {
    const order = textOrder(DEFINITION);
    expect(order.indexOf('form.title')).toBeLessThan(order.indexOf('sections.s1.title'));
    expect(order.indexOf('fields.f_b.options.o1')).toBeLessThan(order.indexOf('fields.f_a.label'));
    expect(order).toContain('fields.f_b.errors.required');
    expect(order).not.toContain('fields.f_a.errors.required');
    expect(order.at(-1)).toBe('email.confirmation.body');
  });

  it('answers the first missing text in reading order, not by name', () => {
    expect(firstMissingText(DEFINITION, ['fields.f_a.label', 'fields.f_b.label', 'messages.closed'])).toBe('fields.f_b.label');
    expect(firstMissingText(DEFINITION, ['unknown.text'])).toBe('unknown.text');
    expect(firstMissingText(DEFINITION, [])).toBeNull();
  });

  it('says on which tab, and for which field, a text is edited', () => {
    expect(placeOfText('fields.f_a.placeholder')).toEqual({ tab: 'fields', fieldId: 'f_a' });
    expect(placeOfText('sections.s1.title')).toEqual({ tab: 'fields' });
    expect(placeOfText('form.submitLabel')).toEqual({ tab: 'fields' });
    expect(placeOfText('messages.full')).toEqual({ tab: 'settings' });
    expect(placeOfText('email.confirmation.subject')).toEqual({ tab: 'notifications' });
  });
});
