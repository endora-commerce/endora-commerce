// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  formDefinitionSchema,
  visibleElements,
  type AvailablePublicFormDefinition,
  type FormDefinition,
  type VisibilitySource,
} from '@endora-commerce/contracts';
import { FORMS_VISIBILITY_FIXTURES } from '@endora-commerce/contracts/forms-logic.fixtures';
import { formsInitialValues, formsValuesOf, formsVisibility } from './form-block-state.js';

/**
 * `specs/170-forms-module/` T065 — the block's live conditional logic (FR-030, FR-032, B12).
 *
 * The block evaluates the **public** read, which keeps each element's id, type, key and rule; the
 * contracts suite evaluates the definition. Driven by the same fixtures, the two must answer the
 * same sets, so what a shopper sees is what the server will accept.
 */

/** What the public read keeps of a definition for visibility (public-api.md §1). */
function publicShapeOf(definition: FormDefinition): VisibilitySource {
  return {
    sections: definition.sections.map((section) => ({
      id: section.id,
      ...(section.visibility ? { visibility: section.visibility } : {}),
      fields: section.fields.map((field) => ({
        id: field.id,
        type: field.type,
        ...('key' in field ? { key: field.key } : {}),
        ...(field.visibility ? { visibility: field.visibility } : {}),
      })),
    })),
  };
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe('formsVisibility — the shared fixtures (B12)', () => {
  it.each(FORMS_VISIBILITY_FIXTURES.map((fixture) => [fixture.name, fixture] as const))('%s', (_name, fixture) => {
    const definition = formDefinitionSchema.parse(fixture.definition);
    const client = formsVisibility(publicShapeOf(definition), fixture.answers as Record<string, string | string[]>);
    const server = visibleElements(definition, fixture.answers);
    expect(sorted(client.sections)).toEqual(sorted(fixture.expected.sections));
    expect(sorted(client.fields)).toEqual(sorted(fixture.expected.fields));
    expect(sorted(client.fields)).toEqual(sorted(server.fields));
    expect(sorted(client.sections)).toEqual(sorted(server.sections));
  });
});

type Fields = AvailablePublicFormDefinition['sections'][number]['fields'];

const SECTIONS: { id: string; columns: 1; fields: Fields }[] = [
  {
    id: 's1',
    columns: 1,
    fields: [
      { id: 'f1', type: 'text', key: 'name', width: 1, required: false, label: 'Name', defaultValue: 'Ada' },
      { id: 'f2', type: 'number', key: 'qty', width: 1, required: false, label: 'Qty', defaultValue: 3 },
      {
        id: 'f3',
        type: 'select',
        key: 'topic',
        width: 1,
        required: false,
        label: 'Topic',
        defaultValue: 'sales',
        options: [
          { id: 'o1', value: 'sales', label: 'Sales' },
          { id: 'o2', value: 'support', label: 'Support' },
        ],
      },
      {
        id: 'f4',
        type: 'checkboxes',
        key: 'interests',
        width: 1,
        required: false,
        label: 'Interests',
        defaultValue: ['doors'],
        options: [{ id: 'o1', value: 'doors', label: 'Doors' }],
      },
      { id: 'f5', type: 'checkbox', key: 'company', width: 1, required: false, label: 'Company', defaultChecked: true },
      { id: 'f6', type: 'checkbox', key: 'newsletter', width: 1, required: false, label: 'News', defaultChecked: false },
      { id: 'f7', type: 'country', key: 'country', width: 1, required: false, label: 'Country', defaultValue: 'PL' },
      { id: 'f8', type: 'hidden', key: 'campaign', width: 1, required: false, label: '', source: 'static', staticValue: 'web' },
      { id: 'f9', type: 'content', width: 1, content: '<p>Hi</p>' },
    ],
  },
];

describe('formsInitialValues — what the server renders the visibility from (R-28)', () => {
  const hiddenValue = (field: { key: string }) => (field.key === 'campaign' ? 'autumn' : '');

  it('reads every default as the browser would post it, and the hidden fields from the page', () => {
    expect(formsInitialValues(SECTIONS, hiddenValue, undefined)).toEqual({
      name: 'Ada',
      qty: '3',
      topic: 'sales',
      interests: ['doors'],
      company: 'on',
      country: 'PL',
      campaign: 'autumn',
    });
  });

  it('takes a refused attempt’s answers instead of every default (an absent key is empty)', () => {
    expect(formsInitialValues(SECTIONS, hiddenValue, { topic: 'support', 'address.city': 'Kraków' })).toEqual({
      topic: 'support',
      'address.city': 'Kraków',
      campaign: 'autumn',
    });
  });
});

describe('formsValuesOf — the live answers of a form element', () => {
  it('reads each named control, repeated names as a list', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="name" value="Ada" />
      <input type="checkbox" name="interests" value="doors" checked />
      <input type="checkbox" name="interests" value="windows" checked />
      <input type="checkbox" name="company" />
      <select name="topic"><option value="sales">Sales</option><option value="support" selected>Support</option></select>`;
    expect(formsValuesOf(form)).toEqual({ name: 'Ada', interests: ['doors', 'windows'], topic: 'support' });
  });
});
