import { useId, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  FORM_ADDRESS_PARTS,
  FORM_DATETIME_MODES,
  FORM_HIDDEN_SOURCES,
  FORM_TEXT_PATTERNS,
  type FormAddressPart,
  type FormDefinition,
  type FormDefinitionIssue,
  type FormField,
} from '@endora-commerce/contracts';
import { useCountriesQuery } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Checkbox, Input, Label, MultiSelect, Select, Textarea } from '@endora-commerce/admin-kit/ui';
import { isInputField, locateField, newElementId, replaceField, setText, setVisibility, textOf } from '../lib/definition-draft.js';
import { ConditionRuleEditor } from './ConditionRuleEditor.js';

/**
 * The settings of one field (`specs/170-forms-module/` FR-019 – FR-029, research R-19): its texts in
 * the default language, whether it is required, its width, its key — with a warning when a published
 * form's key is renamed — and the settings of its type: options, limits, the allowed characters, the
 * date mode, the hidden value's source, the address parts, the country subset, the submitter e-mail
 * designation and the share flag, and its visibility rule (`ConditionRuleEditor`, User Story 3); other
 * languages' texts are the translations tab's (User Story 7).
 *
 * Every change answers a new definition through `onChange`; the shape stays what the save accepts,
 * and the publish rules stay the server's (FR-011).
 */
export interface FieldInspectorProps {
  readonly definition: FormDefinition;
  readonly fieldId: string;
  /** The form's default language: the texts edited here. */
  readonly language: string;
  /** The key each field had in the served version, by field id; empty while never published. */
  readonly publishedKeys: ReadonlyMap<string, string>;
  /** The last publish refusal's issues: the rule editor shows the ones about this field's rule. */
  readonly issues?: readonly FormDefinitionIssue[];
  readonly disabled?: boolean;
  readonly onChange: (next: FormDefinition) => void;
  readonly onRemove: (fieldId: string) => void;
}

/** A number input's value, or `undefined` for an empty box. */
function numberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function withOptional<T extends object, K extends string, V>(object: T, key: K, value: V | undefined): T {
  const next = { ...object } as Record<string, unknown>;
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next as T;
}

export function FieldInspector(props: FieldInspectorProps): ReactNode {
  const { definition, fieldId, language, publishedKeys, issues = [], disabled = false, onChange, onRemove } = props;
  const t = useTranslation('forms');
  const baseId = useId();
  const place = locateField(definition, fieldId);
  if (!place) return null;
  const field = place.section.fields[place.index]!;
  const columns = place.section.columns;
  const id = (suffix: string): string => `${baseId}-${suffix}`;

  const update = (next: FormField): void => onChange(replaceField(definition, next));
  const text = (suffix: string): string => textOf(definition, language, `fields.${field.id}.${suffix}`);
  const writeText = (suffix: string, value: string): void => onChange(setText(definition, language, `fields.${field.id}.${suffix}`, value));

  const textInput = (suffix: string, labelKey: string, multiline = false): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={id(suffix)}>{t(labelKey)}</Label>
      {multiline ? (
        <Textarea id={id(suffix)} rows={4} value={text(suffix)} disabled={disabled} onChange={(event) => writeText(suffix, event.target.value)} />
      ) : (
        <Input id={id(suffix)} value={text(suffix)} disabled={disabled} onChange={(event) => writeText(suffix, event.target.value)} />
      )}
    </div>
  );

  const numberInput = (name: string, labelKey: string, value: number | undefined, set: (value: number | undefined) => void): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={id(name)}>{t(labelKey)}</Label>
      <Input
        id={id(name)}
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => set(numberOrUndefined(event.target.value))}
      />
    </div>
  );

  const checkbox = (name: string, label: string, checked: boolean, set: (checked: boolean) => void, readOnly = false): ReactNode => (
    <div className="flex items-center gap-2">
      <Checkbox id={id(name)} checked={checked} disabled={disabled || readOnly} onChange={(event) => set(event.target.checked)} />
      <Label htmlFor={id(name)} className="font-normal">
        {label}
      </Label>
    </div>
  );

  const typeName = t(`fieldTypes.${field.type}`);
  const publishedKey = publishedKeys.get(field.id);

  return (
    <section aria-labelledby={id('title')} className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={id('title')} className="text-sm font-semibold">
          {t('inspector.title', { type: typeName })}
        </h2>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onRemove(field.id)}>
          <Trash2 size={14} aria-hidden="true" />
          {t('inspector.remove')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('inspector.language', { language })}</p>

      {field.type === 'content' ? textInput('content', 'inspector.content', true) : null}
      {field.type === 'section_break' ? textInput('title', 'inspector.heading') : null}

      {isInputField(field) ? (
        <>
          {textInput('label', 'inspector.label')}
          {field.type !== 'checkbox' && !['privacy_consent', 'marketing_consent', 'terms', 'hidden', 'address'].includes(field.type)
            ? textInput('placeholder', 'inspector.placeholder')
            : null}
          {field.type !== 'hidden' ? textInput('help', 'inspector.help') : null}
          {field.type === 'privacy_consent' || field.type === 'marketing_consent' || field.type === 'terms'
            ? textInput('content', 'inspector.consentText', true)
            : null}

          {field.type === 'privacy_consent' || field.type === 'terms' ? (
            <p className="text-xs text-muted-foreground">{t('inspector.consentRequired')}</p>
          ) : field.type === 'marketing_consent' ? (
            <p className="text-xs text-muted-foreground">{t('inspector.marketingNeverRequired')}</p>
          ) : field.type !== 'hidden' ? (
            checkbox('required', t('inspector.required'), field.required, (required) => update({ ...field, required }))
          ) : null}

          <div className="space-y-1">
            <Label htmlFor={id('key')}>{t('inspector.key')}</Label>
            <Input
              id={id('key')}
              value={field.key}
              maxLength={64}
              disabled={disabled}
              aria-describedby={id('key-hint')}
              onChange={(event) => update({ ...field, key: event.target.value.toLowerCase() })}
            />
            <p id={id('key-hint')} className="text-xs text-muted-foreground">
              {t('inspector.keyHint')}
            </p>
            {publishedKey !== undefined && publishedKey !== field.key ? (
              <Alert>
                <AlertDescription>{t('inspector.keyRenameWarning')}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </>
      ) : null}

      {field.type !== 'hidden' ? (
        <div className="space-y-1">
          <Label htmlFor={id('width')}>{t('inspector.width')}</Label>
          <Select
            id={id('width')}
            value={Math.min(field.width, columns)}
            disabled={disabled || columns === 1}
            onChange={(event) => update({ ...field, width: Number(event.target.value) })}
          >
            {Array.from({ length: columns }, (_, index) => index + 1).map((width) => (
              <option key={width} value={width}>
                {t('inspector.widthOption', { width, columns })}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {field.type === 'text' || field.type === 'email' || field.type === 'phone' || field.type === 'textarea'
        ? textInput('defaultText', 'inspector.defaultValue')
        : null}

      {field.type === 'text' || field.type === 'textarea' ? (
        <div className="grid grid-cols-2 gap-2">
          {numberInput('minLength', 'inspector.minLength', field.minLength, (value) => update(withOptional(field, 'minLength', value)))}
          {numberInput('maxLength', 'inspector.maxLength', field.maxLength, (value) => update(withOptional(field, 'maxLength', value)))}
        </div>
      ) : null}

      {field.type === 'text' ? (
        <div className="space-y-1">
          <Label htmlFor={id('pattern')}>{t('inspector.pattern')}</Label>
          <Select
            id={id('pattern')}
            value={field.pattern ?? ''}
            disabled={disabled}
            onChange={(event) =>
              update(withOptional(field, 'pattern', event.target.value === '' ? undefined : (event.target.value as typeof field.pattern)))
            }
          >
            <option value="">{t('inspector.pattern.none')}</option>
            {FORM_TEXT_PATTERNS.map((pattern) => (
              <option key={pattern} value={pattern}>
                {t(`inspector.pattern.${pattern}`)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {field.type === 'email'
        ? checkbox('submitter', t('inspector.submitterEmail'), field.submitterEmail, (submitterEmail) => update({ ...field, submitterEmail }))
        : null}

      {field.type === 'number' ? (
        <div className="grid grid-cols-2 gap-2">
          {numberInput('min', 'inspector.min', field.min, (value) => update(withOptional(field, 'min', value)))}
          {numberInput('max', 'inspector.max', field.max, (value) => update(withOptional(field, 'max', value)))}
          {numberInput('step', 'inspector.step', field.step, (value) =>
            update(withOptional(field, 'step', value !== undefined && value > 0 ? value : undefined)),
          )}
          {numberInput('default', 'inspector.defaultValue', field.defaultValue, (value) => update(withOptional(field, 'defaultValue', value)))}
        </div>
      ) : null}

      {field.type === 'checkbox'
        ? checkbox('defaultChecked', t('inspector.defaultChecked'), field.defaultChecked ?? false, (checked) =>
            update(withOptional(field, 'defaultChecked', checked ? true : undefined)),
          )
        : null}

      {field.type === 'select' || field.type === 'radio' || field.type === 'checkboxes' ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('inspector.options')}</legend>
          {field.options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-2">
              <Input
                aria-label={t('inspector.option', { number: index + 1 })}
                value={option.value}
                maxLength={200}
                disabled={disabled}
                onChange={(event) =>
                  update({
                    ...field,
                    options: field.options.map((candidate) => (candidate.id === option.id ? { ...candidate, value: event.target.value } : candidate)),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={t('inspector.removeOption', { number: index + 1 })}
                onClick={() => update({ ...field, options: field.options.filter((candidate) => candidate.id !== option.id) })}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || field.options.length >= 200}
            onClick={() =>
              update({
                ...field,
                options: [...field.options, { id: newElementId('o'), value: t('inspector.option', { number: field.options.length + 1 }) }],
              })
            }
          >
            <Plus size={14} aria-hidden="true" />
            {t('inspector.addOption')}
          </Button>
          {field.type !== 'checkboxes' ? (
            <div className="space-y-1">
              <Label htmlFor={id('default-option')}>{t('inspector.defaultValue')}</Label>
              <Select
                id={id('default-option')}
                value={field.defaultValue ?? ''}
                disabled={disabled}
                onChange={(event) => update(withOptional(field, 'defaultValue', event.target.value === '' ? undefined : event.target.value))}
              >
                <option value="">{t('inspector.noDefault')}</option>
                {field.options.map((option) => (
                  <option key={option.id} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {numberInput('minSelected', 'inspector.minSelected', field.minSelected, (value) => update(withOptional(field, 'minSelected', value)))}
              {numberInput('maxSelected', 'inspector.maxSelected', field.maxSelected, (value) => update(withOptional(field, 'maxSelected', value)))}
            </div>
          )}
        </fieldset>
      ) : null}

      {field.type === 'datetime' ? (
        <>
          <div className="space-y-1">
            <Label htmlFor={id('mode')}>{t('inspector.mode')}</Label>
            <Select
              id={id('mode')}
              value={field.mode}
              disabled={disabled}
              onChange={(event) => {
                const { earliest: _earliest, latest: _latest, ...rest } = field;
                void _earliest;
                void _latest;
                // Bounds are written in the shape of the mode: a new mode starts without them.
                update({ ...rest, mode: event.target.value as typeof field.mode });
              }}
            >
              {FORM_DATETIME_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`inspector.mode.${mode}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['earliest', 'latest'] as const).map((bound) => (
              <div key={bound} className="space-y-1">
                <Label htmlFor={id(bound)}>{t(`inspector.${bound}`)}</Label>
                <Input
                  id={id(bound)}
                  type={field.mode === 'datetime' ? 'datetime-local' : field.mode}
                  value={field[bound] ?? ''}
                  disabled={disabled}
                  onChange={(event) => update(withOptional(field, bound, event.target.value === '' ? undefined : event.target.value.slice(0, 16)))}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {field.type === 'country' ? (
        <CountrySubset
          labelId={id('countries')}
          selected={field.allowedCountries ?? []}
          disabled={disabled}
          onChange={(next) => update(withOptional(field, 'allowedCountries', next.length > 0 ? next : undefined))}
        />
      ) : null}

      {field.type === 'address' ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('inspector.parts')}</legend>
          {FORM_ADDRESS_PARTS.map((part: FormAddressPart) => {
            const settings = field.parts[part];
            const partName = t(`inspector.part.${part}`);
            const fixed = part === 'street' || part === 'city';
            return (
              <div key={part} className="flex flex-wrap items-center gap-4">
                {checkbox(
                  `part-${part}`,
                  t('inspector.partEnabled', { part: partName }),
                  settings.enabled,
                  (enabled) => update({ ...field, parts: { ...field.parts, [part]: { enabled, required: enabled && settings.required } } }),
                  fixed,
                )}
                {checkbox(
                  `part-${part}-required`,
                  t('inspector.partRequired', { part: partName }),
                  settings.required,
                  (required) => update({ ...field, parts: { ...field.parts, [part]: { ...settings, required } } }),
                  !settings.enabled,
                )}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      {field.type === 'hidden' ? (
        <>
          <div className="space-y-1">
            <Label htmlFor={id('source')}>{t('inspector.source')}</Label>
            <Select
              id={id('source')}
              value={field.source}
              disabled={disabled}
              onChange={(event) => update({ ...field, source: event.target.value as typeof field.source })}
            >
              {FORM_HIDDEN_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {t(`inspector.source.${source}`)}
                </option>
              ))}
            </Select>
          </div>
          {field.source === 'static' ? (
            <div className="space-y-1">
              <Label htmlFor={id('static')}>{t('inspector.staticValue')}</Label>
              <Input
                id={id('static')}
                value={field.staticValue ?? ''}
                maxLength={1000}
                disabled={disabled}
                onChange={(event) => update({ ...field, staticValue: event.target.value })}
              />
            </div>
          ) : null}
          {field.source === 'query_param' ? (
            <div className="space-y-1">
              <Label htmlFor={id('param')}>{t('inspector.paramName')}</Label>
              <Input
                id={id('param')}
                value={field.paramName ?? ''}
                maxLength={64}
                disabled={disabled}
                onChange={(event) => update(withOptional(field, 'paramName', event.target.value === '' ? undefined : event.target.value))}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {isInputField(field) ? (
        // FR-064 — off by default and frozen into the version at publish. The disclosure is the
        // switch's description: a shared answer leaves the shop and stays in the delivery records.
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id={id('share')}
              checked={field.shareWithIntegrations}
              disabled={disabled}
              aria-describedby={id('shareHint')}
              onChange={(event) => update({ ...field, shareWithIntegrations: event.target.checked })}
            />
            <Label htmlFor={id('share')} className="font-normal">
              {t('inspector.share')}
            </Label>
          </div>
          <p id={id('shareHint')} className="text-xs text-muted-foreground">
            {t('inspector.shareHint')}
          </p>
        </div>
      ) : null}

      <ConditionRuleEditor
        definition={definition}
        language={language}
        ownerId={field.id}
        rule={field.visibility}
        issues={issues}
        disabled={disabled}
        onChange={(rule) => onChange(setVisibility(definition, field.id, rule))}
      />
    </section>
  );
}

/**
 * The countries a country field offers (FR-028), from the dictionary in the admin's language;
 * none chosen means every active country. Mounted only for a country field, so no other field
 * reads the dictionary.
 */
function CountrySubset(props: {
  readonly labelId: string;
  readonly selected: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (next: string[]) => void;
}): ReactNode {
  const t = useTranslation('forms');
  const { language } = useAppLanguage();
  const { countries } = useCountriesQuery(language);
  return (
    <div className="space-y-1">
      <span id={props.labelId} className="text-sm font-medium">
        {t('inspector.countries')}
      </span>
      <MultiSelect
        ariaLabelledBy={props.labelId}
        placeholder={t('inspector.countriesPlaceholder')}
        searchable
        disabled={props.disabled}
        options={countries.map((country) => ({ value: country.code, label: country.label }))}
        selected={[...props.selected]}
        onChange={props.onChange}
      />
    </div>
  );
}
