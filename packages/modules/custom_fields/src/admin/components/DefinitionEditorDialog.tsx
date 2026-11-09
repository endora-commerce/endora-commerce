import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  ERROR_CODES,
  type CustomFieldDefinitionDto,
  type CustomFieldEntityTypeInfo,
  type SupportedEntityType,
  type UpdateCustomFieldDefinitionRequest,
} from '@endora-commerce/contracts';
import { customFieldsClient } from '../api/custom-fields-client.js';
import {
  carryCounterpartsBrokenBy,
  carryDriftProceed,
  type CarryCounterpart,
  type CarryDriftProceed,
  type DefinitionChange,
} from '../lib/carry-drift.js';
import { entityTypeLabelKey, isCarryRefusal, refusalSentence, shownKey, type Translate } from '../lib/carry-labels.js';
import {
  firstIssue,
  hasIssues,
  hasOptions,
  toCreateOptions,
  trimmedLabel,
  validateDefinitionDraft,
  type DefinitionDraftIssues,
  type OptionIssues,
} from '../lib/definition-draft.js';
import { labelTexts, sameLabel, withLanguages } from './localized-label.js';
import { CarryDriftNotice } from './CarryDriftWarning.js';
import { DefinitionForm, type DefinitionFormErrors, type DefinitionFormValue } from './DefinitionForm.js';
import type { CarryDriftGuard } from './DefinitionOptionsEditor.js';

interface CommonProps {
  /** The entity-types list: the types a field can be created for, and how a carry target is named. */
  entityTypes?: readonly CustomFieldEntityTypeInfo[];
  /** Closed without a save (Cancel, Escape, the scrim) — in the edit view option actions may still have changed it. */
  onClose: () => void;
  /**
   * Feature 162 — every definition the page knows, of every type, so an option
   * or audience change can say which carries it breaks. The edited
   * definition's own entry is replaced by the dialog's latest read.
   */
  definitions?: readonly CustomFieldDefinitionDto[];
}

/** Edits an existing definition. */
export interface EditDefinitionDialogProps extends CommonProps {
  mode?: 'edit';
  definition: CustomFieldDefinitionDto;
  /** The `entity-types` entry of the definition's type. */
  entityTypeInfo: CustomFieldEntityTypeInfo;
  /** Saved; the dialog is done. */
  onSaved: () => void;
}

/** Creates a definition (issue #447). */
export interface CreateDefinitionDialogProps extends CommonProps {
  mode: 'create';
  /** The record type the form starts on — the one the page shows. */
  entityType: SupportedEntityType;
  /** The position a new field of `entityType` takes among that type's fields. */
  sortOrderFor: (entityType: SupportedEntityType) => number;
  /** Created; the dialog is done. Names the record type the field was created for. */
  onSaved: (entityType: SupportedEntityType) => void;
}

export type DefinitionEditorDialogProps = EditDefinitionDialogProps | CreateDefinitionDialogProps;

/** A pending drift warning: what it names, how it reads, and who is waiting for the answer. */
interface PendingDrift {
  counterparts: readonly CarryCounterpart[];
  lead?: string;
  /** The change asked about. */
  action: DefinitionChange['kind'];
  /** The proceed button, named after the change asked about (owner ruling V1). */
  proceed: CarryDriftProceed;
  resolve: (proceed: boolean) => void;
}

const sameTargets = <T extends string>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((target) => b.includes(target));

/** The fields a server refusal can be said next to; anything else is said beside the submit button. */
type RefusalPlace = 'key' | 'labelDefault' | 'options' | 'audience';

/** Where a `VALIDATION_FAILED` issue path points, by its first segment. */
const VALIDATION_PATHS: Readonly<Record<string, RefusalPlace>> = {
  key: 'key',
  labelDefault: 'labelDefault',
  label: 'labelDefault',
  options: 'options',
  audience: 'audience',
};

/**
 * Where a refused save is said, and in which words — never the error code. A
 * taken key is said at the key, in this module's own sentence; stored values
 * left by a deleted field are about the audience; a malformed member is said
 * at the field its path names. A carry refusal is not placed here: it goes
 * beside the carry options (R16).
 */
function placeRefusal(
  t: Translate,
  error: unknown,
  key: string,
): { place: RefusalPlace; sentence: string } | null {
  if (!(error instanceof ApiError)) return null;
  const { code, message, details } = error.envelope.error;
  if (code === ERROR_CODES.CUSTOM_FIELD_KEY_CONFLICT) {
    return { place: 'key', sentence: t('customFields.form.keyTaken', { key: shownKey(key) }) };
  }
  if (code === ERROR_CODES.CUSTOM_FIELD_STORED_VALUES_EXIST) return { place: 'audience', sentence: message };
  if (code === ERROR_CODES.VALIDATION_FAILED && Array.isArray(details)) {
    for (const issue of details) {
      const place = VALIDATION_PATHS[String(issue.path).split('.')[0] ?? ''];
      if (place !== undefined) return { place, sentence: t('customFields.validation.rejected') };
    }
  }
  return null;
}

/** The check results as the form says them, each in a sentence with its own names filled in. */
function issueSentences(
  t: Translate,
  issues: DefinitionDraftIssues,
  value: DefinitionFormValue,
): DefinitionFormErrors {
  const errors: DefinitionFormErrors = {};
  if (issues.key !== undefined) errors.key = t(issues.key);
  if (issues.labelDefault !== undefined) errors.labelDefault = t(issues.labelDefault);
  if (issues.options !== undefined) errors.options = t(issues.options);
  const firstDefault = value.options.find((option) => option.isDefault);
  const rows: Record<number, OptionIssues> = {};
  for (const [index, row] of Object.entries(issues.optionRows)) {
    const option = value.options[Number(index)];
    const sentences: OptionIssues = {};
    if (row.value !== undefined) sentences.value = t(row.value, { value: option?.value.trim() ?? '' });
    if (row.labelDefault !== undefined) sentences.labelDefault = t(row.labelDefault);
    if (row.isDefault !== undefined) {
      sentences.isDefault = t(row.isDefault, {
        label: firstDefault?.labelDefault.trim() || firstDefault?.value.trim() || '',
      });
    }
    rows[Number(index)] = sentences;
  }
  if (Object.keys(rows).length > 0) errors.optionRows = rows;
  return errors;
}

function initialValue(props: DefinitionEditorDialogProps): DefinitionFormValue {
  if (props.mode === 'create') {
    return {
      entityType: props.entityType,
      key: '',
      valueType: 'text',
      labelDefault: '',
      labels: labelTexts({}),
      required: false,
      // `internal` until the administrator says otherwise: a field's values
      // reach a customer only as a decision, never as the form's resting state.
      audience: 'internal',
      listFilter: false,
      carryTo: [],
      // Feature 175 — open on no surface and editable, the server's defaults.
      customerInput: [],
      adminAccess: 'edit',
      options: [],
    };
  }
  const { definition } = props;
  return {
    entityType: definition.entityType,
    key: definition.key,
    valueType: definition.valueType,
    labelDefault: definition.labelDefault,
    labels: labelTexts(definition.label),
    required: definition.required,
    audience: definition.audience,
    listFilter: definition.listFilter,
    carryTo: [...(definition.carryTo ?? [])],
    // `?? …`: a definition read from a server older than feature 175.
    customerInput: [...(definition.customerInput ?? [])],
    adminAccess: definition.adminAccess ?? 'edit',
    options: [],
  };
}

/**
 * Creates a custom-field definition or edits an existing one, in the one
 * definition form both views share (issue #447; feature 157 US3,
 * `specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3).
 *
 * **Create** sends **one** request carrying the whole definition — labels per
 * language, the audience, the behaviour and the options with their labels,
 * default flag and order.
 *
 * **Edit** shows the key, the entity type and the value type, never offers
 * them. *Save* sends **one** `PATCH` holding only the members the operator
 * changed among `labelDefault`, `label`, `required`, `audience`, `listFilter`,
 * `carryTo` (feature 162, as the whole new list), `customerInput` (feature
 * 175, as the whole new list) and `adminAccess` — never `config`,
 * `options`, `valueType` or `key` (threat model F-6); nothing changed sends
 * nothing. Options are edited through their own sub-routes, one action at a
 * time, and the dialog re-reads the definition after each.
 *
 * Both views run the same checks before anything is sent, and say a refusal
 * next to the field it concerns.
 */
export function DefinitionEditorDialog(props: DefinitionEditorDialogProps): ReactNode {
  const { onClose, entityTypes = [], definitions = [] } = props;
  const creating = props.mode === 'create';
  const editedDefinition = props.mode === 'create' ? null : props.definition;
  const t = useTranslation('custom_fields');
  const id = useId();
  const [value, setValue] = useState<DefinitionFormValue>(() => initialValue(props));
  const [current, setCurrent] = useState<CustomFieldDefinitionDto | null>(editedDefinition);
  const [errors, setErrors] = useState<DefinitionFormErrors>({});
  /** A refused save said beside the submit button — one no field is about. */
  const [error, setError] = useState<string | null>(null);
  /**
   * A carry refusal (R16): its sentence beside the carry options, where it is
   * fixed, a summary beside the submit button, and focus on the sentence so it
   * is never left scrolled out of sight at the other end of the dialog.
   */
  const [carryError, setCarryError] = useState<string | null>(null);
  const carryErrorRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  /** An option action applies at once, so after one *Cancel* would undo nothing: it reads *Close*. */
  const [optionsTouched, setOptionsTouched] = useState(false);
  /**
   * Feature 162 — a change that breaks a carry asks first. The question takes
   * the dialog's place rather than opening a second dialog over it: two modals
   * would both answer Escape and both trap focus. The form stays mounted under
   * it (hidden), so a half-typed option survives a *Cancel*.
   */
  const [drift, setDrift] = useState<PendingDrift | null>(null);
  const driftCancelRef = useRef<HTMLButtonElement>(null);
  const driftOpener = useRef<HTMLElement | null>(null);
  const optionsHeadingRef = useRef<HTMLHeadingElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  /** The control focus goes to once the errors it describes are rendered. */
  const [focusField, setFocusField] = useState<string | null>(null);

  const entityTypeInfo: CustomFieldEntityTypeInfo =
    props.mode === 'create'
      ? (entityTypes.find((info) => info.entityType === value.entityType) ?? {
          entityType: value.entityType,
          labelKey: entityTypeLabelKey(value.entityType, entityTypes),
          listFilter: false,
          carryTargets: [],
          customerInputSurfaces: [],
        })
      : props.entityTypeInfo;
  const carryTargets = entityTypeInfo.carryTargets ?? [];
  const offersCarry = carryTargets.length > 0;
  const surfaces = entityTypeInfo.customerInputSurfaces ?? [];

  const typeLabel = useCallback(
    (entityType: SupportedEntityType): string => t(entityTypeLabelKey(entityType, entityTypes)),
    [t, entityTypes],
  );

  const known = useMemo(
    () =>
      current === null
        ? [...definitions]
        : [...definitions.filter((candidate) => candidate.id !== current.id), current],
    [definitions, current],
  );
  const confirmDrift = useCallback(
    (counterparts: readonly CarryCounterpart[], options: { action: DefinitionChange['kind']; lead?: string }) =>
      new Promise<boolean>((resolve) => {
        driftOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setDrift({
          counterparts,
          ...(options.lead ? { lead: options.lead } : {}),
          action: options.action,
          proceed: carryDriftProceed(options.action),
          resolve,
        });
      }),
    [],
  );
  const carryGuard = useMemo<CarryDriftGuard>(
    () => ({ brokenBy: (change) => carryCounterpartsBrokenBy(change, known), confirm: confirmDrift }),
    [known, confirmDrift],
  );

  const settleDrift = useCallback(
    (proceed: boolean): void => {
      // A removed option takes its *Remove* button with it once the definition
      // is re-read, so focus waits on the options heading instead of falling
      // to the page.
      if (proceed && drift?.action === 'remove-option' && optionsHeadingRef.current !== null) {
        driftOpener.current = optionsHeadingRef.current;
      }
      drift?.resolve(proceed);
      setDrift(null);
    },
    [drift],
  );

  // The question opens on *Cancel* — the answer that changes nothing, as Escape
  // and the scrim are — and once answered focus goes back to the control that
  // asked. Focus does not enter the dialog anew, so its description is not
  // re-read: the live region below says the warning appeared.
  useEffect(() => {
    if (drift !== null) {
      driftCancelRef.current?.focus();
      return;
    }
    const opener = driftOpener.current;
    driftOpener.current = null;
    if (opener?.isConnected) opener.focus();
  }, [drift]);

  useEffect(() => {
    if (carryError !== null) carryErrorRef.current?.focus();
  }, [carryError]);

  useEffect(() => {
    if (focusField === null) return;
    formRef.current?.querySelector<HTMLElement>(focusField)?.focus();
    setFocusField(null);
  }, [focusField]);

  const reread = useCallback(async (): Promise<void> => {
    if (editedDefinition === null) return;
    setOptionsTouched(true);
    setCurrent(await customFieldsClient.get(editedDefinition.id));
  }, [editedDefinition]);

  const change = (patch: Partial<DefinitionFormValue>): void => {
    setValue((previous) => ({ ...previous, ...patch }));
    // A refusal is about the value as it was: the field changed says nothing until the next submit.
    setErrors((previous) => {
      const next = { ...previous };
      if (patch.key !== undefined) delete next.key;
      if (patch.labelDefault !== undefined) delete next.labelDefault;
      if (patch.audience !== undefined) delete next.audience;
      if (patch.options !== undefined || patch.valueType !== undefined) {
        delete next.options;
        delete next.optionRows;
      }
      return next;
    });
    if (patch.carryTo !== undefined && !sameTargets(patch.carryTo, value.carryTo)) setCarryError(null);
    // The carry refusal was about the record type it was made for.
    if (patch.entityType !== undefined) setCarryError(null);
  };

  /** Runs the checks; on a refusal says it at its fields and moves focus to the first. */
  const checked = (): boolean => {
    const issues = validateDefinitionDraft(value, creating ? 'create' : 'edit');
    if (!hasIssues(issues)) {
      setErrors({});
      return true;
    }
    setErrors(issueSentences(t, issues, value));
    const first = firstIssue(issues);
    if (first === null) return false;
    setFocusField(
      typeof first === 'string'
        ? `[data-field="${first}"]`
        : `[data-option-index="${first.row}"] [data-field="${first.field}"]`,
    );
    return false;
  };

  /** Says a refused save: at its field, beside the carry options, or beside the submit button. */
  const refused = (err: unknown, fallbackKey: string): void => {
    const sentence = refusalSentence(t, err, typeLabel, t(fallbackKey));
    if (isCarryRefusal(err)) {
      setCarryError(sentence);
      return;
    }
    const placed = placeRefusal(t, err, value.key.trim());
    if (placed === null || (placed.place === 'key' && !creating)) {
      setError(sentence);
      return;
    }
    setErrors((previous) => ({ ...previous, [placed.place]: placed.sentence }));
    setFocusField(`[data-field="${placed.place}"]`);
  };

  const create = async (): Promise<void> => {
    if (props.mode !== 'create' || !checked()) return;
    const { entityType } = value;
    setBusy(true);
    setError(null);
    setCarryError(null);
    try {
      await customFieldsClient.create({
        entityType,
        key: value.key.trim(),
        label: trimmedLabel(value.labels),
        labelDefault: value.labelDefault.trim(),
        valueType: value.valueType,
        required: value.required,
        audience: value.audience,
        sortOrder: props.sortOrderFor(entityType),
        config: {},
        // Feature 162 — `[]` unless the operator ticked a target the type offers.
        carryTo: value.carryTo.filter((target) => carryTargets.includes(target)),
        // Feature 175 — `[]` unless the operator ticked a surface the type offers.
        customerInput: value.customerInput.filter((surface) => surfaces.includes(surface)),
        adminAccess: value.adminAccess,
        options: hasOptions(value.valueType) ? toCreateOptions(value.options) : [],
        // Sent only where the entity type offers the option.
        ...(entityTypeInfo.listFilter ? { listFilter: value.listFilter } : {}),
      });
      props.onSaved(entityType);
    } catch (err) {
      refused(err, 'customFields.form.createFailed');
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    if (props.mode === 'create' || !checked()) return;
    const { definition } = props;
    const patch: UpdateCustomFieldDefinitionRequest = {};
    const trimmedDefault = value.labelDefault.trim();
    if (trimmedDefault !== definition.labelDefault) patch.labelDefault = trimmedDefault;
    const label = withLanguages(definition.label, value.labels);
    if (!sameLabel(label, definition.label)) patch.label = label;
    if (value.required !== definition.required) patch.required = value.required;
    if (value.audience !== definition.audience) patch.audience = value.audience;
    if (value.listFilter !== definition.listFilter) patch.listFilter = value.listFilter;
    if (offersCarry && !sameTargets(value.carryTo, definition.carryTo ?? [])) patch.carryTo = value.carryTo;
    if (surfaces.length > 0 && !sameTargets(value.customerInput, definition.customerInput ?? [])) {
      patch.customerInput = value.customerInput;
    }
    if (value.adminAccess !== (definition.adminAccess ?? 'edit')) patch.adminAccess = value.adminAccess;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    // Feature 162 — an audience change that breaks a carry asks first, as it does from the table.
    if (patch.audience !== undefined) {
      const broken = carryGuard.brokenBy({ kind: 'audience', definitionId: definition.id, audience: patch.audience });
      if (broken.length > 0 && !(await confirmDrift(broken, { action: 'audience' }))) return;
    }
    setBusy(true);
    setError(null);
    setCarryError(null);
    try {
      await customFieldsClient.update(definition.id, patch);
      props.onSaved();
    } catch (err) {
      refused(err, 'customFields.editor.saveFailed');
      setBusy(false);
    }
  };

  const driftNoticeId = `${id}-drift-notice`;
  const title =
    props.mode === 'create'
      ? t('customFields.form.createTitle')
      : t('customFields.editor.title', { key: props.definition.key });
  return (
    <ModalDialog
      title={drift ? t('customFields.carry.warning.title') : title}
      onClose={drift ? (): void => settleDrift(false) : onClose}
      busy={busy}
      {...(creating ? { initialFocusRef: keyInputRef } : {})}
      {...(drift ? { 'aria-describedby': driftNoticeId } : {})}
      footer={
        drift ? (
          <>
            <Button
              ref={driftCancelRef}
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={(): void => settleDrift(false)}
            >
              {t('customFields.carry.warning.cancel')}
            </Button>
            <Button
              type="button"
              variant={drift.proceed.destructive ? 'destructive' : 'default'}
              className="min-h-11 sm:min-h-9"
              onClick={(): void => settleDrift(true)}
            >
              {t(drift.proceed.labelKey)}
            </Button>
          </>
        ) : (
          <>
            {error !== null || carryError !== null ? (
              <p
                data-testid="save-error"
                // A carry refusal's sentence takes the focus, which reads it; the
                // summary is not announced a second time.
                role={carryError === null ? 'alert' : undefined}
                className="min-w-0 basis-full break-words text-sm text-destructive sm:basis-0 sm:flex-1 sm:self-center"
              >
                {carryError !== null
                  ? t('customFields.carry.refusalSummary', { section: t('customFields.carry.legend') })
                  : error}
              </p>
            ) : null}
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
              {optionsTouched ? t('customFields.editor.close') : t('customFields.editor.cancel')}
            </Button>
            <Button
              type="button"
              className="min-h-11 sm:min-h-9"
              disabled={busy}
              aria-busy={busy}
              onClick={(): void => void (creating ? create() : save())}
            >
              {creating ? t('customFields.form.submit') : t('customFields.editor.save')}
            </Button>
          </>
        )
      }
    >
      {/* Mounted before it has anything to say, so the in-place swap is announced. */}
      <p role="status" data-testid="drift-announcement" className="sr-only">
        {drift ? t('customFields.carry.warning.title') : ''}
      </p>
      {drift ? (
        <CarryDriftNotice
          id={driftNoticeId}
          counterparts={drift.counterparts}
          typeLabel={typeLabel}
          destructive={drift.proceed.destructive}
          {...(drift.lead ? { lead: drift.lead } : {})}
        />
      ) : null}
      <div ref={formRef} hidden={drift !== null}>
        {props.mode === 'create' ? (
          <DefinitionForm
            mode="create"
            value={value}
            onChange={change}
            entityTypeInfo={entityTypeInfo}
            entityTypes={entityTypes}
            errors={errors}
            busy={busy}
            carryError={carryError}
            carryErrorRef={carryErrorRef}
            keyInputRef={keyInputRef}
            optionsHeadingRef={optionsHeadingRef}
          />
        ) : (
          <DefinitionForm
            mode="edit"
            definition={current ?? props.definition}
            storedRequired={props.definition.required}
            onOptionsChanged={reread}
            carryGuard={carryGuard}
            value={value}
            onChange={change}
            entityTypeInfo={entityTypeInfo}
            entityTypes={entityTypes}
            errors={errors}
            busy={busy}
            carryError={carryError}
            carryErrorRef={carryErrorRef}
            optionsHeadingRef={optionsHeadingRef}
          />
        )}
      </div>
    </ModalDialog>
  );
}
