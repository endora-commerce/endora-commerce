import { useId, type ReactNode, type Ref } from 'react';
import { Checkbox, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  CustomFieldAdminAccess,
  CustomFieldAudience,
  CustomFieldDefinitionDto,
  CustomFieldEntityTypeInfo,
  CustomFieldInputSurface,
  CustomFieldOptionDto,
  CustomFieldValueType,
  SupportedEntityType,
} from '@endora-commerce/contracts';
import { ADMIN_ACCESS_LEVELS, adminAccessAllowed, hasOptions, type OptionIssues } from '../lib/definition-draft.js';
import { DefinitionBehaviourFields, type DefinitionBehaviourValue } from './DefinitionBehaviourFields.js';
import { DefinitionOptionsEditor, type CarryDriftGuard } from './DefinitionOptionsEditor.js';
import { LABEL_LANGUAGES, useLanguageName } from './localized-label.js';

export const VALUE_TYPES: readonly CustomFieldValueType[] = [
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
];
export const AUDIENCES: readonly CustomFieldAudience[] = ['internal', 'customer'];

/** Everything the form edits. In the edit view `entityType`, `key` and `valueType` are shown, not offered. */
export interface DefinitionFormValue {
  entityType: SupportedEntityType;
  key: string;
  valueType: CustomFieldValueType;
  labelDefault: string;
  /** One text per label language; an empty one is not stored. */
  labels: Record<string, string>;
  required: boolean;
  audience: CustomFieldAudience;
  listFilter: boolean;
  carryTo: SupportedEntityType[];
  /** Feature 175 — the buyer input surfaces the field is open on. */
  customerInput: CustomFieldInputSurface[];
  /** Feature 175 — how the admin panel offers the field; not access control. */
  adminAccess: CustomFieldAdminAccess;
  /** The draft options of a field being created; an existing field's options are edited live. */
  options: CustomFieldOptionDto[];
}

/** What the form says next to a field — sentences, already in the operator's language. */
export interface DefinitionFormErrors {
  key?: string;
  labelDefault?: string;
  options?: string;
  audience?: string;
  optionRows?: Record<number, OptionIssues>;
}

interface CommonProps {
  value: DefinitionFormValue;
  onChange: (patch: Partial<DefinitionFormValue>) => void;
  /** The `entity-types` entry of the type the definition is for. */
  entityTypeInfo: CustomFieldEntityTypeInfo;
  /** The entity-types list: the record types a field can be created for, and how a carry target is named. */
  entityTypes: readonly CustomFieldEntityTypeInfo[];
  errors: DefinitionFormErrors;
  busy: boolean;
  /** A refused save's carry sentence (R16), said beside the carry options. */
  carryError: string | null;
  carryErrorRef: Ref<HTMLParagraphElement>;
  /** The key input in the create view, focused when the dialog opens. */
  keyInputRef?: Ref<HTMLInputElement>;
  /** The options heading, which takes focus when the list or a removed option leaves none to hold it. */
  optionsHeadingRef?: Ref<HTMLHeadingElement>;
}

export type DefinitionFormProps = CommonProps &
  (
    | { mode: 'create' }
    | {
        mode: 'edit';
        /** The definition as last read — its options are edited live, one action at a time. */
        definition: CustomFieldDefinitionDto;
        /** Whether the stored definition is already required (the notice is about turning it on). */
        storedRequired: boolean;
        onOptionsChanged: () => Promise<void>;
        carryGuard?: CarryDriftGuard;
      }
  );

/**
 * One definition form for creating and editing a custom field (issue #447).
 * Both views show the same sections in the same order:
 *
 * 1. **Definition** — record type, key and type: offered on create, shown as
 *    fixed text on edit.
 * 2. **Labels** — the default label and one per label language.
 * 3. **Options** (choice types) — a local draft list on create, sent with the
 *    field; saved one action at a time on edit.
 * 4. **Rules** — required (with its notice on edit), who can see the value and
 *    the admin access (feature 175; `read`/`hidden` and required exclude each
 *    other, SD-2).
 * 5. **Behaviour** — list filter, carry targets and buyer input.
 *
 * The form holds no state of its own beyond ids: the dialog owns the value,
 * the checks and the save, so both views refuse the same things the same way.
 * Every control the dialog may move focus to carries `data-field`.
 */
export function DefinitionForm(props: DefinitionFormProps): ReactNode {
  const { value, onChange, entityTypeInfo, entityTypes, errors, busy, carryError, carryErrorRef } = props;
  const t = useTranslation('custom_fields');
  const languageName = useLanguageName();
  const id = useId();
  const editing = props.mode === 'edit';
  const errorId = (field: string): string => `${id}-${field}-error`;
  const describedBy = (...ids: ReadonlyArray<string | false | undefined>): string | undefined =>
    ids.filter(Boolean).join(' ') || undefined;
  const errorLine = (field: 'key' | 'labelDefault' | 'options' | 'audience'): ReactNode =>
    errors[field] !== undefined ? (
      <p id={errorId(field)} className="break-words text-sm text-destructive">
        {errors[field]}
      </p>
    ) : null;

  const offersCarry = (entityTypeInfo.carryTargets ?? []).length > 0;
  const offersCustomerInput = (entityTypeInfo.customerInputSurfaces ?? []).length > 0;
  const adminAccessHelpId = `${id}-admin-access-help`;
  const adminAccessReasonId = `${id}-admin-access-reason`;
  const requiredReasonId = `${id}-required-reason`;
  const requiredBlocked = value.adminAccess !== 'edit';
  const showRequiredNotice = props.mode === 'edit' && value.required && !props.storedRequired;
  const requiredNoticeId = `${id}-required-notice`;
  const audienceHelpId = `${id}-audience-help`;
  // Only record types this module manages can take a new field here.
  const creatableTypes = entityTypes.filter((info) => !info.managedBy);

  return (
    <div className="space-y-5">
      <section aria-labelledby={`${id}-identity`} className="space-y-2">
        <h3 id={`${id}-identity`} className="text-sm font-semibold">
          {t('customFields.editor.section.identity')}
        </h3>
        {props.mode === 'edit' ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('customFields.editor.key')}</dt>
              <dd>
                <code className="font-mono text-xs">{props.definition.key}</code>
              </dd>
              <dt className="text-muted-foreground">{t('customFields.editor.entityType')}</dt>
              <dd>{t(entityTypeInfo.labelKey)}</dd>
              <dt className="text-muted-foreground">{t('customFields.editor.valueType')}</dt>
              <dd>{t(`customFields.valueType.${props.definition.valueType}`)}</dd>
            </dl>
            <p className="break-words text-sm text-muted-foreground">{t('customFields.editor.keyReadOnly')}</p>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`${id}-entity`}>{t('customFields.form.entity')}</Label>
              <Select
                id={`${id}-entity`}
                value={value.entityType}
                disabled={busy}
                onChange={(event): void => onChange({ entityType: event.target.value as SupportedEntityType })}
              >
                {creatableTypes.map((info) => (
                  <option key={info.entityType} value={info.entityType}>
                    {t(info.labelKey)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`${id}-value-type`}>{t('customFields.form.valueType')}</Label>
              <Select
                id={`${id}-value-type`}
                value={value.valueType}
                disabled={busy}
                onChange={(event): void => onChange({ valueType: event.target.value as CustomFieldValueType })}
              >
                {VALUE_TYPES.map((valueType) => (
                  <option key={valueType} value={valueType}>
                    {t(`customFields.valueType.${valueType}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-0 space-y-1 sm:col-span-2">
              <Label htmlFor={`${id}-key`}>{t('customFields.form.key')}</Label>
              <Input
                ref={props.keyInputRef}
                id={`${id}-key`}
                data-field="key"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                value={value.key}
                disabled={busy}
                placeholder={t('customFields.form.keyPlaceholder')}
                aria-invalid={errors.key !== undefined || undefined}
                aria-describedby={describedBy(errors.key !== undefined && errorId('key'), `${id}-key-help`)}
                onChange={(event): void => onChange({ key: event.target.value })}
              />
              {errorLine('key')}
              <p id={`${id}-key-help`} className="break-words text-sm text-muted-foreground">
                {t('customFields.form.keyHelp')}
              </p>
            </div>
          </div>
        )}
      </section>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t('customFields.editor.section.labels')}</legend>
        <div className="space-y-1">
          <Label htmlFor={`${id}-default`}>{t('customFields.editor.labelDefault')}</Label>
          <Input
            id={`${id}-default`}
            data-field="labelDefault"
            value={value.labelDefault}
            disabled={busy}
            aria-invalid={errors.labelDefault !== undefined || undefined}
            aria-describedby={errors.labelDefault !== undefined ? errorId('labelDefault') : undefined}
            onChange={(event): void => onChange({ labelDefault: event.target.value })}
          />
          {errors.labelDefault !== undefined ? (
            <p id={errorId('labelDefault')} role="alert" className="break-words text-sm text-destructive">
              {errors.labelDefault}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {LABEL_LANGUAGES.map((language) => (
            <div key={language} className="min-w-0 space-y-1">
              <Label htmlFor={`${id}-label-${language}`}>
                {t('customFields.editor.labelIn', { language: languageName(language) })}
              </Label>
              <Input
                id={`${id}-label-${language}`}
                value={value.labels[language] ?? ''}
                disabled={busy}
                onChange={(event): void => onChange({ labels: { ...value.labels, [language]: event.target.value } })}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {hasOptions(editing ? props.definition.valueType : value.valueType) ? (
        <section aria-labelledby={`${id}-options`} className="space-y-2">
          <h3
            id={`${id}-options`}
            ref={props.optionsHeadingRef}
            data-field="options"
            tabIndex={-1}
            aria-describedby={errors.options !== undefined ? errorId('options') : undefined}
            className="rounded-sm text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('customFields.editor.section.options')}
          </h3>
          <p className="break-words text-sm text-muted-foreground">
            {editing ? t('customFields.editor.optionsNote') : t('customFields.editor.optionsDraftNote')}
          </p>
          {errorLine('options')}
          {props.mode === 'edit' ? (
            <DefinitionOptionsEditor
              definition={props.definition}
              onChanged={props.onOptionsChanged}
              disabled={busy}
              {...(props.carryGuard ? { carryGuard: props.carryGuard } : {})}
            />
          ) : (
            <DefinitionOptionsEditor
              mode="draft"
              valueType={value.valueType}
              options={value.options}
              onChange={(options): void => onChange({ options })}
              errors={errors.optionRows ?? {}}
              disabled={busy}
            />
          )}
        </section>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t('customFields.editor.section.rules')}</legend>
        <div>
          <label htmlFor={`${id}-required`} className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox
              id={`${id}-required`}
              checked={value.required}
              // A read-only or hidden field cannot be required (SD-2) — unless it
              // already is, so the operator can still untick it.
              disabled={busy || (requiredBlocked && !value.required)}
              aria-describedby={describedBy(showRequiredNotice && requiredNoticeId, requiredBlocked && requiredReasonId)}
              onChange={(event): void => onChange({ required: event.target.checked })}
            />
            {t('customFields.form.required')}
          </label>
          {requiredBlocked ? (
            <p id={requiredReasonId} className="break-words text-sm text-muted-foreground">
              {t('customFields.form.requiredAccessReason')}
            </p>
          ) : null}
          {editing ? (
            // A live region mounted before it has anything to say, so the notice is announced.
            <p
              id={requiredNoticeId}
              data-testid="required-notice"
              role="status"
              className={
                showRequiredNotice ? 'break-words rounded-md border bg-muted p-3 text-sm' : 'break-words text-sm'
              }
            >
              {showRequiredNotice ? t('customFields.editor.requiredNotice') : ''}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-audience`}>{t('customFields.audience.label')}</Label>
          <Select
            id={`${id}-audience`}
            data-field="audience"
            value={value.audience}
            disabled={busy}
            aria-invalid={errors.audience !== undefined || undefined}
            aria-describedby={describedBy(errors.audience !== undefined && errorId('audience'), audienceHelpId)}
            onChange={(event): void => onChange({ audience: event.target.value as CustomFieldAudience })}
          >
            {AUDIENCES.map((audience) => (
              <option key={audience} value={audience}>
                {t(`customFields.audience.${audience}`)}
              </option>
            ))}
          </Select>
          {errorLine('audience')}
          <p id={audienceHelpId} className="break-words text-sm text-muted-foreground">
            {t('customFields.audience.help')}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-admin-access`}>{t('customFields.adminAccess.label')}</Label>
          <Select
            id={`${id}-admin-access`}
            data-field="adminAccess"
            value={value.adminAccess}
            disabled={busy}
            aria-describedby={describedBy(adminAccessHelpId, value.required && adminAccessReasonId)}
            onChange={(event): void => onChange({ adminAccess: event.target.value as CustomFieldAdminAccess })}
          >
            {ADMIN_ACCESS_LEVELS.map((level) => (
              <option
                key={level}
                value={level}
                disabled={!adminAccessAllowed(level, value.required) && level !== value.adminAccess}
              >
                {t(`customFields.adminAccess.${level}`)}
              </option>
            ))}
          </Select>
          <p id={adminAccessHelpId} className="break-words text-sm text-muted-foreground">
            {t('customFields.adminAccess.help')}
          </p>
          {value.required ? (
            <p id={adminAccessReasonId} className="break-words text-sm text-muted-foreground">
              {t('customFields.adminAccess.requiredReason')}
            </p>
          ) : null}
        </div>
      </fieldset>

      <DefinitionBehaviourFields
        definition={
          props.mode === 'edit'
            ? // The audience is the form's, not the stored one: the buyer-input
              // option follows the select above as the operator changes it.
              { ...props.definition, audience: value.audience }
            : { key: value.key.trim(), valueType: value.valueType, options: value.options, audience: value.audience }
        }
        entityTypeInfo={entityTypeInfo}
        value={{
          listFilter: value.listFilter,
          ...(offersCarry ? { carryTo: value.carryTo } : {}),
          ...(offersCustomerInput ? { customerInput: value.customerInput } : {}),
        }}
        onChange={(next: DefinitionBehaviourValue): void =>
          onChange({
            listFilter: next.listFilter,
            ...(next.carryTo !== undefined ? { carryTo: next.carryTo } : {}),
            ...(next.customerInput !== undefined ? { customerInput: next.customerInput } : {}),
          })
        }
        entityTypes={entityTypes}
        disabled={busy}
        carryError={carryError}
        carryErrorRef={carryErrorRef}
      />
    </div>
  );
}
