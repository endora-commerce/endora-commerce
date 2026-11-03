import { useId, type ReactNode } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
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
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  MultiSelect,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { isInputField, locateField, newElementId, replaceField, setVisibility, textOf } from '../lib/definition-draft.js';
import { FIELD_TYPE_ICONS } from '../lib/field-icons.js';
import { hasDefaultText, hasPlaceholder, writtenErrorCodes } from '../lib/text-catalogue.js';
import { ConditionRuleEditor } from './ConditionRuleEditor.js';
import { PanelSection } from './PanelSection.js';
import { TranslatableText } from './TranslatableText.js';

/**
 * The settings of one field (`specs/170-forms-module/` FR-019 – FR-029, research R-19): a sticky
 * card whose header names the field's type (icon and name), and four groups — **basic** (its texts,
 * whether it is required, its width, its key — with a warning when a published form's key is
 * renamed — and the settings of its type: options, the date mode, the hidden value's source, the
 * address parts, the country subset, the submitter e-mail designation), **validation** (limits,
 * the allowed characters, the date bounds, an operator's own error messages), **conditional logic**
 * (`ConditionRuleEditor`, User Story 3) and **integrations** (the share flag, FR-064).
 *
 * Texts are edited in the builder's content language (User Story 7): in another language than the
 * default only they are editable — every other control is the default language's and disabled,
 * and adding or removing options or the field is not offered — so one structure serves every
 * language. An option has a stored value (structure) and a label (a text) the value stands in for.
 *
 * Every change answers a new definition through `onChange`; the shape stays what the save accepts,
 * and the publish rules stay the server's (FR-011).
 */
export interface FieldInspectorProps {
  readonly definition: FormDefinition;
  readonly fieldId: string;
  /** The content language: the texts edited here. */
  readonly language: string;
  /** The form's default language; the structure is editable only in it. Defaults to `language`. */
  readonly defaultLanguage?: string;
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
  const defaultLanguage = props.defaultLanguage ?? language;
  const t = useTranslation('forms');
  const baseId = useId();
  const place = locateField(definition, fieldId);
  if (!place) return null;
  const field = place.section.fields[place.index]!;
  const columns = place.section.columns;
  const id = (suffix: string): string => `${baseId}-${suffix}`;
  const translating = language !== defaultLanguage;
  // Every control but a text is the structure's, edited in the default language only.
  const structure = disabled || translating;

  const update = (next: FormField): void => onChange(replaceField(definition, next));

  const textInput = (suffix: string, labelKey: string, rows?: number, placeholder?: string): ReactNode => (
    <TranslatableText
      id={id(suffix)}
      label={t(labelKey)}
      definition={definition}
      language={language}
      defaultLanguage={defaultLanguage}
      textId={`fields.${field.id}.${suffix}`}
      disabled={disabled}
      onChange={onChange}
      {...(rows !== undefined ? { rows } : {})}
      {...(placeholder !== undefined ? { placeholder } : {})}
    />
  );

  const numberInput = (name: string, labelKey: string, value: number | undefined, set: (value: number | undefined) => void): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={id(name)}>{t(labelKey)}</Label>
      <Input
        id={id(name)}
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        disabled={structure}
        onChange={(event) => set(numberOrUndefined(event.target.value))}
      />
    </div>
  );

  const checkbox = (name: string, label: string, checked: boolean, set: (checked: boolean) => void, readOnly = false): ReactNode => (
    <div className="flex min-h-9 items-center gap-2">
      <Checkbox id={id(name)} checked={checked} disabled={structure || readOnly} onChange={(event) => set(event.target.checked)} />
      <Label htmlFor={id(name)} className="font-normal">
        {label}
      </Label>
    </div>
  );

  const typeName = t(`fieldTypes.${field.type}`);
  const TypeIcon = FIELD_TYPE_ICONS[field.type];
  const publishedKey = publishedKeys.get(field.id);
  const errorCodes = isInputField(field) ? writtenErrorCodes(definition, field.id) : [];
  const shownText = (textId: string): string => textOf(definition, language, textId) || textOf(definition, defaultLanguage, textId);

  const validation: ReactNode[] = [];
  if (field.type === 'text' || field.type === 'textarea') {
    validation.push(
      <div key="length" className="grid grid-cols-2 gap-2">
        {numberInput('minLength', 'inspector.minLength', field.minLength, (value) => update(withOptional(field, 'minLength', value)))}
        {numberInput('maxLength', 'inspector.maxLength', field.maxLength, (value) => update(withOptional(field, 'maxLength', value)))}
      </div>,
    );
  }
  if (field.type === 'text') {
    validation.push(
      <div key="pattern" className="space-y-1">
        <Label htmlFor={id('pattern')}>{t('inspector.pattern')}</Label>
        <Select
          id={id('pattern')}
          value={field.pattern ?? ''}
          disabled={structure}
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
      </div>,
    );
  }
  if (field.type === 'number') {
    validation.push(
      <div key="range" className="grid grid-cols-2 gap-2">
        {numberInput('min', 'inspector.min', field.min, (value) => update(withOptional(field, 'min', value)))}
        {numberInput('max', 'inspector.max', field.max, (value) => update(withOptional(field, 'max', value)))}
        {numberInput('step', 'inspector.step', field.step, (value) =>
          update(withOptional(field, 'step', value !== undefined && value > 0 ? value : undefined)),
        )}
      </div>,
    );
  }
  if (field.type === 'checkboxes') {
    validation.push(
      <div key="choices" className="grid grid-cols-2 gap-2">
        {numberInput('minSelected', 'inspector.minSelected', field.minSelected, (value) => update(withOptional(field, 'minSelected', value)))}
        {numberInput('maxSelected', 'inspector.maxSelected', field.maxSelected, (value) => update(withOptional(field, 'maxSelected', value)))}
      </div>,
    );
  }
  if (field.type === 'datetime') {
    validation.push(
      <div key="bounds" className="grid grid-cols-2 gap-2">
        {(['earliest', 'latest'] as const).map((bound) => (
          <div key={bound} className="space-y-1">
            <Label htmlFor={id(bound)}>{t(`inspector.${bound}`)}</Label>
            <Input
              id={id(bound)}
              type={field.mode === 'datetime' ? 'datetime-local' : field.mode}
              value={field[bound] ?? ''}
              disabled={structure}
              onChange={(event) => update(withOptional(field, bound, event.target.value === '' ? undefined : event.target.value.slice(0, 16)))}
            />
          </div>
        ))}
      </div>,
    );
  }
  for (const code of errorCodes) {
    validation.push(
      <TranslatableText
        key={`error-${code}`}
        id={id(`error-${code}`)}
        label={t('inspector.errorMessage', { message: t(`validation.${code}`) })}
        definition={definition}
        language={language}
        defaultLanguage={defaultLanguage}
        textId={`fields.${field.id}.errors.${code}`}
        placeholder={t(`validation.${code}`)}
        disabled={disabled}
        onChange={onChange}
      />,
    );
  }

  return (
    <Card role="region" aria-labelledby={id('title')} className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 border-b border-border p-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <TypeIcon size={16} aria-hidden="true" />
          </span>
          <CardTitle className="min-w-0">
            <h2 id={id('title')} className="truncate">
              {t('inspector.title', { type: typeName })}
            </h2>
          </CardTitle>
        </div>
        {translating ? null : (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onRemove(field.id)}>
            <Trash2 size={14} aria-hidden="true" />
            {t('inspector.remove')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6 p-4">
        {translating ? (
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{t('language.lockedShort', { language: defaultLanguage })}</span>
          </p>
        ) : null}

        <PanelSection titleId={id('basic')} title={t('inspector.group.basic')}>
          <div className="space-y-4">
            {field.type === 'content' ? textInput('content', 'inspector.content', 4) : null}
            {field.type === 'section_break' ? textInput('title', 'inspector.heading') : null}

            {isInputField(field) ? (
              <>
                {textInput('label', 'inspector.label')}
                {hasPlaceholder(field) ? textInput('placeholder', 'inspector.placeholder') : null}
                {field.type !== 'hidden' ? textInput('help', 'inspector.help') : null}
                {field.type === 'privacy_consent' || field.type === 'marketing_consent' || field.type === 'terms'
                  ? textInput('content', 'inspector.consentText', 4)
                  : null}
                {hasDefaultText(field) ? textInput('defaultText', 'inspector.defaultValue') : null}

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
                    disabled={structure}
                    aria-describedby={id('key-hint')}
                    className="font-mono text-xs"
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
                  disabled={structure || columns === 1}
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

            {field.type === 'email'
              ? checkbox('submitter', t('inspector.submitterEmail'), field.submitterEmail, (submitterEmail) => update({ ...field, submitterEmail }))
              : null}

            {field.type === 'number'
              ? numberInput('default', 'inspector.defaultValue', field.defaultValue, (value) => update(withOptional(field, 'defaultValue', value)))
              : null}

            {field.type === 'checkbox'
              ? checkbox('defaultChecked', t('inspector.defaultChecked'), field.defaultChecked ?? false, (checked) =>
                  update(withOptional(field, 'defaultChecked', checked ? true : undefined)),
                )
              : null}

            {field.type === 'select' || field.type === 'radio' || field.type === 'checkboxes' ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('inspector.options')}</legend>
                <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 text-xs text-muted-foreground">
                  <span>{t('inspector.label')}</span>
                  <span>{t('inspector.optionValue')}</span>
                </div>
                {field.options.map((option, index) => (
                  <div key={option.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-start gap-2">
                    <TranslatableText
                      id={id(`option-${option.id}`)}
                      ariaLabel={t('inspector.optionLabel', { number: index + 1 })}
                      definition={definition}
                      language={language}
                      defaultLanguage={defaultLanguage}
                      textId={`fields.${field.id}.options.${option.id}`}
                      placeholder={option.value}
                      disabled={disabled}
                      onChange={onChange}
                    />
                    <Input
                      aria-label={t('inspector.option', { number: index + 1 })}
                      value={option.value}
                      maxLength={200}
                      disabled={structure}
                      className="font-mono text-xs"
                      onChange={(event) =>
                        update({
                          ...field,
                          options: field.options.map((candidate) => (candidate.id === option.id ? { ...candidate, value: event.target.value } : candidate)),
                        })
                      }
                    />
                    {translating ? null : (
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
                    )}
                  </div>
                ))}
                {translating ? null : (
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
                )}
                {field.type !== 'checkboxes' ? (
                  <div className="space-y-1 pt-2">
                    <Label htmlFor={id('default-option')}>{t('inspector.defaultValue')}</Label>
                    <Select
                      id={id('default-option')}
                      value={field.defaultValue ?? ''}
                      disabled={structure}
                      onChange={(event) => update(withOptional(field, 'defaultValue', event.target.value === '' ? undefined : event.target.value))}
                    >
                      <option value="">{t('inspector.noDefault')}</option>
                      {field.options.map((option) => (
                        <option key={option.id} value={option.value}>
                          {shownText(`fields.${field.id}.options.${option.id}`) || option.value}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
              </fieldset>
            ) : null}

            {field.type === 'datetime' ? (
              <div className="space-y-1">
                <Label htmlFor={id('mode')}>{t('inspector.mode')}</Label>
                <Select
                  id={id('mode')}
                  value={field.mode}
                  disabled={structure}
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
            ) : null}

            {field.type === 'country' ? (
              <CountrySubset
                labelId={id('countries')}
                selected={field.allowedCountries ?? []}
                disabled={structure}
                onChange={(next) => update(withOptional(field, 'allowedCountries', next.length > 0 ? next : undefined))}
              />
            ) : null}

            {field.type === 'address' ? (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">{t('inspector.parts')}</legend>
                {FORM_ADDRESS_PARTS.map((part: FormAddressPart) => {
                  const settings = field.parts[part];
                  const partName = t(`inspector.part.${part}`);
                  const fixed = part === 'street' || part === 'city';
                  return (
                    <div key={part} className="space-y-1 rounded-md border border-border p-2">
                      <div className="flex flex-wrap items-center gap-x-4">
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
                      {settings.enabled ? (
                        <TranslatableText
                          id={id(`part-${part}-label`)}
                          label={t('inspector.partLabel', { part: partName })}
                          definition={definition}
                          language={language}
                          defaultLanguage={defaultLanguage}
                          textId={`fields.${field.id}.parts.${part}.label`}
                          placeholder={partName}
                          disabled={disabled}
                          onChange={onChange}
                        />
                      ) : null}
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
                    disabled={structure}
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
                      disabled={structure}
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
                      disabled={structure}
                      onChange={(event) => update(withOptional(field, 'paramName', event.target.value === '' ? undefined : event.target.value))}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </PanelSection>

        {validation.length > 0 ? (
          <PanelSection titleId={id('validation')} title={t('inspector.group.validation')}>
            <div className="space-y-4">{validation}</div>
          </PanelSection>
        ) : null}

        <PanelSection titleId={id('logic')} title={t('inspector.group.logic')}>
          <ConditionRuleEditor
            definition={definition}
            language={defaultLanguage}
            ownerId={field.id}
            rule={field.visibility}
            issues={issues}
            disabled={structure}
            onChange={(rule) => onChange(setVisibility(definition, field.id, rule))}
          />
        </PanelSection>

        {isInputField(field) ? (
          // FR-064 — off by default and frozen into the version at publish. The disclosure is the
          // switch's description: a shared answer leaves the shop and stays in the delivery records.
          <PanelSection titleId={id('integrations')} title={t('inspector.group.integrations')}>
            <div className="space-y-1">
              <div className="flex min-h-9 items-center gap-2">
                <Checkbox
                  id={id('share')}
                  checked={field.shareWithIntegrations}
                  disabled={structure}
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
          </PanelSection>
        ) : null}
      </CardContent>
    </Card>
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
