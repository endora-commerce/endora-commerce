import { FORM_ADDRESS_PARTS, FORM_FIELD_ERROR_CODES, type FormDefinition, type FormField } from '@endora-commerce/contracts';
import { isInputField } from './definition-draft.js';

/**
 * Every operator text a form can carry (`specs/170-forms-module/` data-model §3.6, research R-7), in
 * the order the form reads, grouped by the element it belongs to — what the *Translations* tab lists
 * for each storefront language. Derived from the structure alone, so a text the default language has
 * not written yet is still offered, and a text of an element that is gone is not.
 *
 * A text's `name` is a key of this module's bundle with its parameters; the screen translates it.
 */

export type TextKind = 'line' | 'multiline' | 'rich';

export interface CatalogueText {
  readonly textId: string;
  readonly kind: TextKind;
  readonly name: { readonly key: string; readonly params?: Readonly<Record<string, string>> };
}

export type CatalogueGroup =
  | { readonly kind: 'form'; readonly id: 'form'; readonly texts: readonly CatalogueText[] }
  | { readonly kind: 'section'; readonly id: string; readonly number: number; readonly texts: readonly CatalogueText[] }
  | { readonly kind: 'field'; readonly id: string; readonly field: FormField; readonly texts: readonly CatalogueText[] }
  | { readonly kind: 'messages'; readonly id: 'messages'; readonly texts: readonly CatalogueText[] }
  | { readonly kind: 'email'; readonly id: 'email'; readonly texts: readonly CatalogueText[] };

const text = (textId: string, kind: TextKind, key: string, params?: Record<string, string>): CatalogueText => ({
  textId,
  kind,
  name: params ? { key, params } : { key },
});

const CONSENTS: ReadonlySet<string> = new Set(['privacy_consent', 'marketing_consent', 'terms']);
const WITHOUT_PLACEHOLDER: ReadonlySet<string> = new Set(['checkbox', 'privacy_consent', 'marketing_consent', 'terms', 'hidden', 'address']);
const WITH_DEFAULT_TEXT: ReadonlySet<string> = new Set(['text', 'email', 'phone', 'textarea']);

/** The texts of one field — the same set the field inspector writes, plus options, parts and overrides. */
function fieldTexts(definition: FormDefinition, field: FormField): CatalogueText[] {
  const at = (suffix: string): string => `fields.${field.id}.${suffix}`;
  if (field.type === 'content') return [text(at('content'), 'rich', 'inspector.content')];
  if (field.type === 'section_break') return [text(at('title'), 'line', 'inspector.heading')];
  if (!isInputField(field)) return [];
  const texts = [text(at('label'), 'line', 'inspector.label')];
  if (!WITHOUT_PLACEHOLDER.has(field.type)) texts.push(text(at('placeholder'), 'line', 'inspector.placeholder'));
  if (field.type !== 'hidden') texts.push(text(at('help'), 'line', 'inspector.help'));
  if (CONSENTS.has(field.type)) texts.push(text(at('content'), 'rich', 'inspector.consentText'));
  if (WITH_DEFAULT_TEXT.has(field.type)) texts.push(text(at('defaultText'), 'line', 'inspector.defaultValue'));
  if ('options' in field) {
    for (const option of field.options) {
      texts.push(text(at(`options.${option.id}`), 'line', 'translations.text.option', { value: option.value }));
    }
  }
  if (field.type === 'address') {
    for (const part of FORM_ADDRESS_PARTS) {
      if (field.parts[part].enabled) texts.push(text(at(`parts.${part}.label`), 'line', 'translations.text.part', { part }));
    }
  }
  // An operator's own error message is offered where one was written in any language (R-24).
  const written = new Set(Object.values(definition.texts).flatMap((entries) => Object.keys(entries)));
  for (const code of FORM_FIELD_ERROR_CODES) {
    const textId = at(`errors.${code}`);
    if (written.has(textId)) texts.push(text(textId, 'line', 'translations.text.error', { code }));
  }
  return texts;
}

export function textCatalogue(definition: FormDefinition): CatalogueGroup[] {
  const groups: CatalogueGroup[] = [
    {
      kind: 'form',
      id: 'form',
      texts: [
        text('form.title', 'line', 'translations.text.title'),
        text('form.description', 'multiline', 'translations.text.description'),
        text('form.submitLabel', 'line', 'translations.text.submitLabel'),
      ],
    },
  ];
  definition.sections.forEach((section, index) => {
    groups.push({
      kind: 'section',
      id: section.id,
      number: index + 1,
      texts: [
        text(`sections.${section.id}.title`, 'line', 'canvas.sectionTitle'),
        text(`sections.${section.id}.description`, 'multiline', 'translations.text.sectionDescription'),
      ],
    });
    for (const field of section.fields) {
      const texts = fieldTexts(definition, field);
      if (texts.length > 0) groups.push({ kind: 'field', id: field.id, field, texts });
    }
  });
  groups.push({
    kind: 'messages',
    id: 'messages',
    texts: [
      text('messages.success', 'rich', 'settings.confirmation.messageText'),
      text('messages.closed', 'line', 'settings.restrictions.closedMessage'),
      text('messages.notYetOpen', 'line', 'settings.restrictions.notYetOpenMessage'),
      text('messages.full', 'line', 'settings.restrictions.fullMessage'),
      text('messages.signIn', 'line', 'settings.restrictions.signInMessage'),
    ],
  });
  groups.push({
    kind: 'email',
    id: 'email',
    texts: [
      text('email.confirmation.subject', 'line', 'notifications.confirmation.subject'),
      text('email.confirmation.body', 'rich', 'notifications.confirmation.body'),
    ],
  });
  return groups;
}
