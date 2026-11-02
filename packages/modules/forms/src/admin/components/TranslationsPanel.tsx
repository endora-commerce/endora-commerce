import { useId, useMemo, useState, type ReactNode } from 'react';
import { textCompleteness, type FormDefinition } from '@endora-commerce/contracts';
import { ContentLanguageTabs } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Input, Textarea } from '@endora-commerce/admin-kit/ui';
import { setText, textOf } from '../lib/definition-draft.js';
import { textCatalogue, type CatalogueGroup, type CatalogueText } from '../lib/text-catalogue.js';

/**
 * The builder's *Translations* tab (`specs/170-forms-module/` User Story 7; FR-068, research R-7,
 * contracts/admin-surfaces.md §4).
 *
 * **One structure, texts per language** (US7-1): the language switch is admin-kit's
 * `ContentLanguageTabs` over the storefront languages, the form's default language first; for the
 * chosen language every operator text of the form is listed — grouped by the element it belongs to,
 * in the form's order — beside its default-language original. Only texts are editable here: no
 * field, section, option, rule or validation setting is, so a translation can never make one
 * language's form differ from another's.
 *
 * **Incomplete languages are marked** (US7-2) next to the switch, whichever language is open, by the
 * same `textCompleteness` the server's `untranslated` warning uses; in an incomplete language each
 * text that falls back to the default says so. An empty text is removed (`setText`), so the fallback
 * applies again.
 *
 * Edits go into the builder's draft, saved and published with the form.
 */

export interface TranslationsPanelProps {
  /** The builder's draft. */
  readonly definition: FormDefinition;
  /** The storefront languages the form may be written in. */
  readonly languages: readonly string[];
  readonly defaultLanguage: string;
  readonly disabled: boolean;
  readonly onDefinitionChange: (next: FormDefinition) => void;
}

const nonBlank = (value: string | undefined): boolean => value !== undefined && value.trim() !== '';

export function TranslationsPanel(props: TranslationsPanelProps): ReactNode {
  const { definition, defaultLanguage, disabled, onDefinitionChange } = props;
  const t = useTranslation('forms');
  const id = useId();
  const languages = useMemo(
    () => [defaultLanguage, ...props.languages.filter((language) => language !== defaultLanguage)],
    [props.languages, defaultLanguage],
  );
  const [language, setLanguage] = useState(defaultLanguage);
  const active = languages.includes(language) ? language : defaultLanguage;

  const catalogue = useMemo(() => textCatalogue(definition), [definition]);
  const completeness = useMemo(
    () => textCompleteness(definition, languages, defaultLanguage),
    [definition, languages, defaultLanguage],
  );
  const incomplete = completeness.filter((entry) => entry.missing.length > 0);
  const activeMissing = completeness.find((entry) => entry.language === active)?.missing.length ?? 0;
  const isDefault = active === defaultLanguage;

  const nameOf = (entry: CatalogueText): string => {
    const params = { ...(entry.name.params ?? {}) };
    if (entry.name.key === 'translations.text.part' && params['part']) params['part'] = t(`inspector.part.${params['part']}`);
    if (entry.name.key === 'translations.text.error' && params['code']) params['code'] = t(`validation.${params['code']}`);
    return t(entry.name.key, params);
  };

  const groupName = (group: CatalogueGroup): string => {
    switch (group.kind) {
      case 'form':
        return t('translations.group.form');
      case 'section':
        return t('canvas.section', { number: group.number });
      case 'field': {
        const own =
          textOf(definition, defaultLanguage, `fields.${group.field.id}.label`) ||
          textOf(definition, defaultLanguage, `fields.${group.field.id}.title`);
        return own || t(`fieldTypes.${group.field.type}`);
      }
      case 'messages':
        return t('translations.group.messages');
      case 'email':
        return t('translations.group.email');
    }
  };

  const row = (group: CatalogueGroup, groupId: string, entry: CatalogueText, index: number): ReactNode => {
    const rowId = `${id}-${group.id}-${index}`;
    const value = textOf(definition, active, entry.textId);
    const original = textOf(definition, defaultLanguage, entry.textId);
    const fallsBack = !isDefault && !nonBlank(value) && nonBlank(original);
    const described = [!isDefault && nonBlank(original) ? `${rowId}-original` : null, fallsBack ? `${rowId}-fallback` : null]
      .filter(Boolean)
      .join(' ');
    const common = {
      id: rowId,
      value,
      disabled,
      'aria-labelledby': `${rowId}-label ${groupId}`,
      ...(described ? { 'aria-describedby': described } : {}),
      onChange: (event: { target: { value: string } }) => onDefinitionChange(setText(definition, active, entry.textId, event.target.value)),
    };
    return (
      <div key={entry.textId} className="space-y-1">
        <label id={`${rowId}-label`} htmlFor={rowId} className="text-sm font-medium">
          {nameOf(entry)}
        </label>
        {!isDefault && nonBlank(original) ? (
          <p id={`${rowId}-original`} className="whitespace-pre-wrap rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            <span className="sr-only">{t('translations.original', { language: defaultLanguage })} </span>
            <span>{original}</span>
          </p>
        ) : null}
        {entry.kind === 'line' ? <Input {...common} /> : <Textarea rows={entry.kind === 'rich' ? 4 : 2} {...common} />}
        {fallsBack ? (
          <p id={`${rowId}-fallback`} className="text-xs text-muted-foreground">
            {t('translations.fallsBack', { language: defaultLanguage })}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('translations.description', { language: defaultLanguage })}</p>
        <ContentLanguageTabs languages={languages} activeLanguage={active} onChange={setLanguage} />
        {incomplete.length > 0 ? (
          <ul aria-label={t('translations.status')} className="space-y-0.5 text-sm">
            {incomplete.map((entry) => (
              <li key={entry.language} className="text-muted-foreground">
                {t('translations.incomplete', { language: entry.language, count: entry.missing.length })}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div role="tabpanel" aria-label={active} className="space-y-6">
        {!isDefault && activeMissing === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('translations.complete', { language: active })}
          </p>
        ) : null}
        {catalogue.map((group) => {
          const groupId = `${id}-${group.id}-name`;
          return (
            <section key={group.id} aria-labelledby={groupId} className="space-y-3">
              <h3 id={groupId} className="text-sm font-semibold">
                {groupName(group)}
              </h3>
              <div className="grid gap-3 lg:grid-cols-2">{group.texts.map((entry, index) => row(group, groupId, entry, index))}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
