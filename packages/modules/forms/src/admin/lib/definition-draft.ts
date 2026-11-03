import {
  FORM_INPUT_FIELD_TYPES,
  type FormDefinition,
  type FormField,
  type FormFieldType,
  type FormInputField,
  type FormSection,
  type VisibilityRule,
} from '@endora-commerce/contracts';

/**
 * The builder's edits of a working copy (`specs/170-forms-module/` User Story 1), as pure functions
 * over a `FormDefinition` that each answer a new definition. The screen holds one draft and applies
 * these; nothing here talks to the server, and the publish rules stay the server's (FR-011) — the
 * builder only keeps the shape the save accepts.
 */

/** The MIME type a palette drag carries: the field type being dropped. */
export const FIELD_TYPE_DRAG_FORMAT = 'application/x-endora-form-field-type';

export function isInputField(field: FormField): field is FormInputField {
  return (FORM_INPUT_FIELD_TYPES as readonly string[]).includes(field.type);
}

/** A stable element id: text ids are derived from it, so it never changes once made (R-7). */
export function newElementId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/** Every input field's key, for picking a free one. */
function keysOf(definition: FormDefinition): Set<string> {
  return new Set(definition.sections.flatMap((section) => section.fields.filter(isInputField).map((field) => field.key)));
}

/** `base`, `base_2`, `base_3`, … — the first key no input field holds. */
export function freeKey(definition: FormDefinition, base: string): string {
  const taken = keysOf(definition);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

const ADDRESS_PARTS = {
  street: { enabled: true as const, required: true },
  line2: { enabled: false, required: false },
  postalCode: { enabled: true, required: true },
  city: { enabled: true as const, required: true },
  country: { enabled: true, required: true },
};

/** A field of `type` with the neutral settings: one column wide, optional, not shared. */
export function newField(definition: FormDefinition, type: FormFieldType): FormField {
  const id = newElementId('f');
  if (type === 'content' || type === 'section_break') return { id, type, width: 1 };
  const base = { id, key: freeKey(definition, type), width: 1, required: false, shareWithIntegrations: false };
  switch (type) {
    case 'select':
    case 'radio':
    case 'checkboxes':
      return { ...base, type, options: [{ id: newElementId('o'), value: 'Option 1' }] } as FormField;
    case 'datetime':
      return { ...base, type, mode: 'date' };
    case 'address':
      return { ...base, type, parts: structuredClone(ADDRESS_PARTS) };
    case 'hidden':
      return { ...base, type, source: 'static', staticValue: '' };
    case 'email':
      return { ...base, type, submitterEmail: false };
    case 'privacy_consent':
    case 'terms':
      // Required whenever shown (FR-029): the builder starts it so, and the server holds it.
      return { ...base, type, required: true };
    default:
      return { ...base, type } as FormField;
  }
}

export function newSection(): FormSection {
  return { id: newElementId('s'), columns: 1, fields: [] };
}

function mapSections(definition: FormDefinition, map: (section: FormSection) => FormSection): FormDefinition {
  return { ...definition, sections: definition.sections.map(map) };
}

/** The section holding `fieldId`, with the field's index. */
export function locateField(definition: FormDefinition, fieldId: string): { section: FormSection; index: number } | null {
  for (const section of definition.sections) {
    const index = section.fields.findIndex((field) => field.id === fieldId);
    if (index >= 0) return { section, index };
  }
  return null;
}

export function findField(definition: FormDefinition, fieldId: string): FormField | null {
  const place = locateField(definition, fieldId);
  return place ? place.section.fields[place.index]! : null;
}

export function insertField(definition: FormDefinition, sectionId: string, field: FormField, index?: number): FormDefinition {
  return mapSections(definition, (section) => {
    if (section.id !== sectionId) return section;
    const fields = [...section.fields];
    fields.splice(index ?? fields.length, 0, field);
    return { ...section, fields };
  });
}

/** Moves a field to `toIndex` of `toSectionId` (the index after the field was taken out). */
export function moveField(definition: FormDefinition, fieldId: string, toSectionId: string, toIndex: number): FormDefinition {
  const field = findField(definition, fieldId);
  if (!field) return definition;
  const without = mapSections(definition, (section) => ({ ...section, fields: section.fields.filter((f) => f.id !== fieldId) }));
  const target = without.sections.find((section) => section.id === toSectionId);
  // A field keeps no width wider than the section it lands in.
  const fitted = target ? { ...field, width: Math.min(field.width, target.columns) } : field;
  return insertField(without, toSectionId, fitted, toIndex);
}

export function moveSection(definition: FormDefinition, sectionId: string, toIndex: number): FormDefinition {
  const sections = [...definition.sections];
  const from = sections.findIndex((section) => section.id === sectionId);
  if (from < 0) return definition;
  const [moved] = sections.splice(from, 1);
  sections.splice(toIndex, 0, moved!);
  return { ...definition, sections };
}

export function replaceField(definition: FormDefinition, field: FormField): FormDefinition {
  return mapSections(definition, (section) => ({
    ...section,
    fields: section.fields.map((candidate) => (candidate.id === field.id ? field : candidate)),
  }));
}

/** The visibility rule of a section or a field; `undefined` makes it always shown (FR-030). */
export function setVisibility(definition: FormDefinition, elementId: string, rule: VisibilityRule | undefined): FormDefinition {
  const apply = <T extends { visibility?: VisibilityRule | undefined }>(element: T): T => {
    const { visibility: _visibility, ...rest } = element;
    return (rule === undefined ? rest : { ...rest, visibility: rule }) as T;
  };
  return mapSections(definition, (section) =>
    section.id === elementId
      ? apply(section)
      : { ...section, fields: section.fields.map((field) => (field.id === elementId ? apply(field) : field)) },
  );
}

/** Removes a field and the texts written for it. */
export function removeField(definition: FormDefinition, fieldId: string): FormDefinition {
  const without = mapSections(definition, (section) => ({ ...section, fields: section.fields.filter((f) => f.id !== fieldId) }));
  return dropTexts(without, `fields.${fieldId}.`);
}

/** Columns change; every field of the section is narrowed to fit (FR-016). */
export function setColumns(definition: FormDefinition, sectionId: string, columns: 1 | 2 | 3): FormDefinition {
  return mapSections(definition, (section) =>
    section.id === sectionId
      ? { ...section, columns, fields: section.fields.map((field) => ({ ...field, width: Math.min(field.width, columns) })) }
      : section,
  );
}

export function addSection(definition: FormDefinition, section: FormSection): FormDefinition {
  return { ...definition, sections: [...definition.sections, section] };
}

/** Removes a section with its fields and their texts; the last section stays (a form has one). */
export function removeSection(definition: FormDefinition, sectionId: string): FormDefinition {
  if (definition.sections.length <= 1) return definition;
  const section = definition.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return definition;
  let next: FormDefinition = { ...definition, sections: definition.sections.filter((candidate) => candidate.id !== sectionId) };
  next = dropTexts(next, `sections.${sectionId}.`);
  for (const field of section.fields) next = dropTexts(next, `fields.${field.id}.`);
  return next;
}

function dropTexts(definition: FormDefinition, prefix: string): FormDefinition {
  const texts: FormDefinition['texts'] = {};
  for (const [language, entries] of Object.entries(definition.texts)) {
    texts[language] = Object.fromEntries(Object.entries(entries).filter(([id]) => !id.startsWith(prefix)));
  }
  return { ...definition, texts };
}

/** One text of one language; an empty value removes it, so the fallback applies (R-7). */
export function setText(definition: FormDefinition, language: string, textId: string, value: string): FormDefinition {
  const entries = { ...(definition.texts[language] ?? {}) };
  if (value === '') delete entries[textId];
  else entries[textId] = value;
  return { ...definition, texts: { ...definition.texts, [language]: entries } };
}

export function textOf(definition: FormDefinition, language: string, textId: string): string {
  return definition.texts[language]?.[textId] ?? '';
}
