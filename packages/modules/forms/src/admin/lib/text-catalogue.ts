import { FORM_ADDRESS_PARTS, FORM_FIELD_ERROR_CODES, type FormDefinition, type FormField } from '@endora-commerce/contracts';
import { isInputField } from './definition-draft.js';

/**
 * Every operator text a form can carry (`specs/170-forms-module/` data-model §3.6, research R-7), in
 * the order the form reads, and where in the builder each one is edited. The builder's language
 * switch uses it to take the operator to the **first** text a language is missing: the contracts'
 * `textCompleteness` answers the missing ids sorted by name, which is not the order anyone reads a
 * form in. Derived from the structure alone, so a text of an element that is gone is not listed.
 *
 * (2026-11-03 owner review: the *Translations* tab that listed these texts was replaced by the
 * language switch in the builder's header; each text is now edited where its element is.)
 */

/** The builder tab a text is edited on, and the field whose inspector holds it, if any. */
export interface TextPlace {
  readonly tab: 'fields' | 'settings' | 'notifications';
  readonly fieldId?: string;
}

const CONSENTS: ReadonlySet<string> = new Set(['privacy_consent', 'marketing_consent', 'terms']);
const WITHOUT_PLACEHOLDER: ReadonlySet<string> = new Set(['checkbox', 'privacy_consent', 'marketing_consent', 'terms', 'hidden', 'address']);
const WITH_DEFAULT_TEXT: ReadonlySet<string> = new Set(['text', 'email', 'phone', 'textarea']);

/** Whether a field has a placeholder text (the inspector offers one). */
export function hasPlaceholder(field: FormField): boolean {
  return isInputField(field) && !WITHOUT_PLACEHOLDER.has(field.type);
}

/** Whether a field has a default text (the inspector offers one). */
export function hasDefaultText(field: FormField): boolean {
  return WITH_DEFAULT_TEXT.has(field.type);
}

/** The error codes an operator wrote their own message for, in any language (R-24). */
export function writtenErrorCodes(definition: FormDefinition, fieldId: string): string[] {
  const written = new Set(Object.values(definition.texts).flatMap((entries) => Object.keys(entries)));
  return FORM_FIELD_ERROR_CODES.filter((code) => written.has(`fields.${fieldId}.errors.${code}`));
}

/** The text ids of one field, in the order its inspector shows them. */
function fieldTextIds(definition: FormDefinition, field: FormField): string[] {
  const at = (suffix: string): string => `fields.${field.id}.${suffix}`;
  if (field.type === 'content') return [at('content')];
  if (field.type === 'section_break') return [at('title')];
  if (!isInputField(field)) return [];
  const ids = [at('label')];
  if (hasPlaceholder(field)) ids.push(at('placeholder'));
  if (field.type !== 'hidden') ids.push(at('help'));
  if (CONSENTS.has(field.type)) ids.push(at('content'));
  if (hasDefaultText(field)) ids.push(at('defaultText'));
  if ('options' in field) for (const option of field.options) ids.push(at(`options.${option.id}`));
  if (field.type === 'address') {
    for (const part of FORM_ADDRESS_PARTS) if (field.parts[part].enabled) ids.push(at(`parts.${part}.label`));
  }
  for (const code of writtenErrorCodes(definition, field.id)) ids.push(at(`errors.${code}`));
  return ids;
}

/** Every text id of the form, in reading order. */
export function textOrder(definition: FormDefinition): string[] {
  const ids = ['form.title', 'form.description', 'form.submitLabel'];
  for (const section of definition.sections) {
    ids.push(`sections.${section.id}.title`, `sections.${section.id}.description`);
    for (const field of section.fields) ids.push(...fieldTextIds(definition, field));
  }
  ids.push('messages.success', 'messages.closed', 'messages.notYetOpen', 'messages.full', 'messages.signIn');
  ids.push('email.confirmation.subject', 'email.confirmation.body');
  return ids;
}

/** Where a text is edited. */
export function placeOfText(textId: string): TextPlace {
  const field = /^fields\.([^.]+)\./.exec(textId);
  if (field) return { tab: 'fields', fieldId: field[1]! };
  if (textId.startsWith('messages.')) return { tab: 'settings' };
  if (textId.startsWith('email.')) return { tab: 'notifications' };
  return { tab: 'fields' };
}

/** The first of `missing` in the form's reading order (any id the order does not know comes last). */
export function firstMissingText(definition: FormDefinition, missing: readonly string[]): string | null {
  if (missing.length === 0) return null;
  const wanted = new Set(missing);
  return textOrder(definition).find((id) => wanted.has(id)) ?? missing[0]!;
}
