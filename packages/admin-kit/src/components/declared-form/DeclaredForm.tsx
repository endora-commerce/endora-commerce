/**
 * The declared form — the one layout primitive a host renders a declared
 * form's fields through (`specs/193-admin-form-extensions/` FR-004, FR-011,
 * FR-016, FR-044, FR-052, FR-061, FR-062; `contracts/field-slots.md` §2 – §3,
 * `field-rules.md` §4 and §6, D-300.11, D-300.12, D-300.14).
 *
 * A host keeps its own state and its own request. It hands the kit its form
 * declaration, its values and a renderer per field, and gets back:
 *
 * - the **layout**: its fields in the server's order with every effective
 *   override applied — label, help and placeholder (code keys from the
 *   declaring module's bundle, operator text in the reader's language), hidden,
 *   read-only, `visibleWhen`, a replacing control — and the slot fields of
 *   present modules the operator may see, at their anchors;
 * - **client rules** over the server's held set, before the round trip;
 * - a **submission**: `{ core, extensions }`, which the host merges into the
 *   body it already sends — slots fold into the host's one request and take no
 *   part in a save session (FR-016);
 * - an **error mapper** from a refused save onto the fields, slots included,
 *   which also drops the fields of a module switched off while the form was
 *   open and says so.
 *
 * ```tsx
 * const declared = useDeclaredForm({
 *   form: ORGANIZATION_FORMS.edit, fieldSet: ORGANIZATION_FIELD_SET, recordId: id,
 *   values, initialValues: loaded, onChange: (key, value) => setValues((v) => ({ ...v, [key]: value })),
 *   extensions: record.extensions, readOnly: !canManage,
 *   render: {
 *     name:  { label: t('fields.name'), input: (p) => <Input {...p.control} value={…} readOnly={p.readOnly} onChange={…} /> },
 *     taxId: { label: t('fields.taxId'), input: (p) => … },
 *   },
 * });
 * // on save: if (!declared.validate()) return;
 * //          const { core, extensions } = declared.submission();
 * //          try { await save({ ...core, ...(extensions ? { extensions } : {}) }) } catch (e) { if (!declared.applyError(e)) throw e }
 * <DeclaredFormProvider declared={declared}>
 *   <DeclaredFormNotices />
 *   <EditorSection title={t('sections.identity')}><DeclaredFormSection section="identity" /></EditorSection>
 * </DeclaredFormProvider>
 * ```
 *
 * **Renderers are given once, for the whole form**, not per section: a
 * `position` override may move a key into another section (§5 step 1), and the
 * section it lands in must be able to render it.
 */
import {
  Fragment,
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  isEmptyFieldValue,
  type AdminComponentFactory,
  type AdminFormDeclaration,
  type EffectiveField,
  type EffectiveText,
  type FieldDeclaration,
  type FieldKeyOf,
  type FieldSetDeclaration,
  type FieldSlotProps,
  type FormLayoutSection,
  type FormLayoutSlot,
} from '@endora-commerce/contracts';

import { useTranslationContext } from '../../i18n/TranslationProvider.js';
import { useAuth } from '../../lib/auth.js';
import { useEffectiveForm } from '../../lib/forms/EffectiveFormsProvider.js';
import { mapDeclaredFormError } from '../../lib/forms/errors.js';
import { declaredFormLayout } from '../../lib/forms/layout.js';
import { clientFieldViolations, fieldValueChanged, isEffectivelyRequired } from '../../lib/forms/rules.js';
import { declaredFormSubmission, type DeclaredFormSubmission } from '../../lib/forms/submission.js';
import { useModulePresence } from '../../lib/module-presence/ModulePresenceProvider.js';
import { useSurfaceVisibility } from '../../lib/surface-visibility.js';
import { cn } from '../../lib/utils.js';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { FormField, type FormFieldControlProps } from '../../ui/form-field.js';
import {
  useAdminFormContributions,
  type OwnedFieldBehaviour,
  type OwnedFieldContribution,
  type OwnedInputControlContribution,
} from '../../zones/AdminContributionsProvider.js';
import { ZoneErrorBoundary } from '../../zones/ZoneErrorBoundary.js';
import {
  PLATFORM_CONTROL_COMPONENTS,
  PLATFORM_GROUP_CONTROLS,
  isPlatformControlId,
  type DeclaredControlProps,
} from '../controls/PlatformControl.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What a field's renderer receives. */
export interface DeclaredFieldInputProps {
  readonly fieldKey: string;
  readonly value: unknown;
  /** Applies a present mask, clears the field's error and calls the host's `onChange`. */
  readonly onChange: (next: unknown) => void;
  /** An override, the host's `readOnly`, or a `writePermission` the operator lacks (FR-061). */
  readonly readOnly: boolean;
  /** Core `required`, a tightened `required`, or a `requiredWhen` that holds. */
  readonly required: boolean;
  /** The effective placeholder, when an override set one. */
  readonly placeholder: string | undefined;
  /** The wiring `FormField` puts on its control; spread it onto the input. */
  readonly control: FormFieldControlProps;
  readonly error: string | undefined;
  /** The effective label and help when an override set them — for a `field` renderer that draws its own label. */
  readonly labelOverride: string | undefined;
  readonly helpOverride: string | undefined;
  /** Core values and slot values (`<moduleId>.<key>`), read-only. */
  readonly formValues: Readonly<Record<string, unknown>>;
  /** A `control` override's input, for a `field` renderer to place; `null` when the host's own input applies. */
  readonly overrideControl: ReactNode;
}

interface RendererCommon {
  /** For a select-like `control` override: the options and their labels (default: the declared values). */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

/**
 * How a host renders one of its fields:
 *
 * - `{ label, input }` — the kit wraps `input` in `FormField` with the label,
 *   help, hint, error and required marker (the common case);
 * - `{ field }` — the renderer draws the whole field itself and receives the
 *   effective label and help to apply (the product editor's `EditorField`).
 */
export type DeclaredFieldRenderer = RendererCommon &
  (
    | {
        /** The host's own label, from its own bundle; an override replaces it. */
        readonly label: ReactNode;
        readonly help?: ReactNode;
        readonly hint?: ReactNode;
        /** A composite control with no single labellable element (`FormField`'s `group`). */
        readonly group?: boolean;
        readonly input: (props: DeclaredFieldInputProps) => ReactNode;
      }
    | { readonly field: (props: DeclaredFieldInputProps) => ReactNode }
  );

/** One renderer per key the form shows — a missing one is a type error. */
export type DeclaredFieldRenderers<F> = { readonly [K in FieldKeyOf<F>]: DeclaredFieldRenderer };

export interface UseDeclaredFormOptions<F extends AdminFormDeclaration> {
  readonly form: F;
  /** The form's field set: its keys' value types, core required-ness and options. */
  readonly fieldSet: Pick<FieldSetDeclaration, 'id' | 'fields'>;
  /** `null` on create. */
  readonly recordId?: string | null;
  /** The host's current core values. */
  readonly values: Readonly<Record<string, unknown>>;
  /** The loaded values, on an edit form (default: `values` at the first render). "Changed" is measured against them. */
  readonly initialValues?: Readonly<Record<string, unknown>>;
  readonly onChange: (key: FieldKeyOf<F>, value: unknown) => void;
  /** The host read's `extensions` (`?extensions=`): `{ <moduleId>: { <key>: value } }`. */
  readonly extensions?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null;
  /** The whole form is read-only for this operator. */
  readonly readOnly?: boolean;
  readonly render: DeclaredFieldRenderers<F>;
}

export interface DeclaredFormController {
  readonly formId: string;
  readonly mode: 'create' | 'edit';
  readonly recordId: string | null;
  /** The modules whose slots the form renders — exactly what the host reads with `?extensions=`. */
  readonly extensionModules: readonly string[];
  /** Field key or slot wire key → message. */
  readonly errors: Readonly<Record<string, string>>;
  /** Discarded-change notices: a slot's module switched off with an unsaved value. */
  readonly notices: readonly string[];
  /** `{ core, extensions }` for the host's request (`field-slots.md` §3). */
  submission(): DeclaredFormSubmission;
  /** Run the client rules; show and return whether the submission passes them. */
  validate(): boolean;
  /** Map a refused save onto the fields. `false` when the error is not one the form can place. */
  applyError(error: unknown): boolean;
  clearErrors(): void;
  /** @internal — read by `DeclaredFormSection`. */
  readonly sections: readonly FormLayoutSection[];
  /** @internal */
  renderItem(kind: 'field' | 'slot', key: string): ReactNode;
}

// ---------------------------------------------------------------------------
// Lazy factories: one component and one module per factory, for the page's life
// ---------------------------------------------------------------------------

type AnyComponent = ComponentType<Record<string, unknown>>;
const lazyComponents = new WeakMap<AdminComponentFactory, AnyComponent>();

function lazyComponentOf(load: AdminComponentFactory): AnyComponent {
  const known = lazyComponents.get(load);
  if (known !== undefined) return known;
  // `{ default: unknown }` by construction (see `AdminComponentFactory`): the
  // contribution's type was held at its declaration, as a zone's is.
  const built = lazy(async () => ({ default: (await load()).default as AnyComponent }));
  lazyComponents.set(load, built);
  return built;
}

/** A behaviour module's default export (`field-rules.md` §4). */
interface FieldBehaviourModule {
  readonly mask?: (raw: string) => string;
  readonly derive?: { readonly from: readonly string[]; readonly compute: (values: Readonly<Record<string, unknown>>) => unknown };
}

const loadedBehaviours = new WeakMap<AdminComponentFactory, FieldBehaviourModule>();
const loadingBehaviours = new WeakMap<AdminComponentFactory, Promise<FieldBehaviourModule>>();

function loadBehaviour(load: AdminComponentFactory): Promise<FieldBehaviourModule> {
  const pending = loadingBehaviours.get(load);
  if (pending !== undefined) return pending;
  const promise = load().then((module) => {
    const behaviour = (module.default ?? {}) as FieldBehaviourModule;
    loadedBehaviours.set(load, behaviour);
    return behaviour;
  });
  loadingBehaviours.set(load, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

const own = (values: Readonly<Record<string, unknown>> | null | undefined, key: string): unknown =>
  values != null && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;

function flattenExtensions(
  extensions: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null | undefined,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [moduleId, slice] of Object.entries(extensions ?? {})) {
    if (slice === null || typeof slice !== 'object') continue;
    for (const [key, value] of Object.entries(slice)) flat[`${moduleId}.${key}`] = value;
  }
  return flat;
}

const wireOf = (slot: OwnedFieldContribution): string => `${slot.module}.${slot.key}`;

/**
 * The field a behaviour targets on this field set, or `null`. A dotted target
 * is a member of a family the set declares (`attributeValues.color`), or a slot
 * — and a slot only of the behaviour's own module (`field-rules.md` §4).
 */
function behaviourTarget(behaviour: OwnedFieldBehaviour, fieldSet: Pick<FieldSetDeclaration, 'id' | 'fields'>): string | null {
  const prefix = `${fieldSet.id}.`;
  if (!behaviour.target.startsWith(prefix)) return null;
  const key = behaviour.target.slice(prefix.length);
  const dot = key.indexOf('.');
  if (dot === -1) return key;
  const head = key.slice(0, dot);
  if (fieldSet.fields.some((field) => field.key === `${head}.*`)) return key;
  return head === behaviour.module ? key : null;
}

export function useDeclaredForm<F extends AdminFormDeclaration>(options: UseDeclaredFormOptions<F>): DeclaredFormController {
  const { form, fieldSet } = options;
  const mode = form.mode;
  const { form: effective } = useEffectiveForm(form.id);
  const contributions = useAdminFormContributions();
  const isVisible = useSurfaceVisibility();
  const { hasPermission } = useAuth();
  const { isPresent, refresh: refreshPresence } = useModulePresence();
  const { t, language } = useTranslationContext();

  const firstValues = useRef(options.values);
  const initialValues = options.initialValues ?? firstValues.current;

  // Slot values: the host read's, then what the operator staged. A new read
  // (by content, so an inline `{}` does not reset anything) replaces the staged.
  const extensionsKey = JSON.stringify(options.extensions ?? null);
  const loadedSlots = useMemo(() => flattenExtensions(options.extensions), [extensionsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [staged, setStaged] = useState<Readonly<Record<string, unknown>>>({});
  const stagedFor = useRef(extensionsKey);
  if (stagedFor.current !== extensionsKey) {
    stagedFor.current = extensionsKey;
    if (Object.keys(staged).length > 0) setStaged({});
  }
  const slotValues = useMemo(() => ({ ...loadedSlots, ...staged }), [loadedSlots, staged]);

  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const touched = useRef(new Set<string>());

  // --- slots -----------------------------------------------------------------
  const formSlots = contributions.fields.filter(
    (slot) => slot.fieldSet === fieldSet.id && (slot.forms === undefined || slot.forms.includes(form.id)),
  );
  // Presence and permission decided before any chunk is loaded (as `useAdminZone`).
  const slots = formSlots.filter(
    (slot) =>
      !dropped.has(slot.module) &&
      isVisible({ module: slot.module, ...(slot.requiredPermission === undefined ? {} : { requiredPermission: slot.requiredPermission }) }),
  );
  const slotByWire = new Map(slots.map((slot) => [wireOf(slot), slot]));
  const extensionModules = [...new Set(slots.map((slot) => slot.module))].sort();

  // --- behaviours (masks and derivations; UI only) ----------------------------
  const behaviours = contributions.fieldBehaviours.filter(
    (behaviour) =>
      isPresent(behaviour.module) &&
      (behaviour.forms === undefined || behaviour.forms.includes(form.id)) &&
      behaviourTarget(behaviour, fieldSet) !== null,
  );
  const [, setBehaviourTick] = useState(0);
  const behaviourKey = behaviours.map((behaviour) => `${behaviour.module}:${behaviour.target}`).join('|');
  useEffect(() => {
    let cancelled = false;
    for (const behaviour of behaviours) {
      if (loadedBehaviours.has(behaviour.behaviour)) continue;
      void loadBehaviour(behaviour.behaviour).then(
        () => {
          if (!cancelled) setBehaviourTick((n) => n + 1);
        },
        (err: unknown) => {
          if (import.meta.env.DEV) console.warn(`[declared-form] '${behaviour.module}' behaviour for '${behaviour.target}' failed to load`, err);
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [behaviourKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const behavioursOf = new Map<string, FieldBehaviourModule[]>();
  for (const behaviour of behaviours) {
    const loaded = loadedBehaviours.get(behaviour.behaviour);
    const target = behaviourTarget(behaviour, fieldSet);
    if (loaded === undefined || target === null) continue;
    behavioursOf.set(target, [...(behavioursOf.get(target) ?? []), loaded]);
  }
  const derivedKeys = new Set([...behavioursOf].filter(([, modules]) => modules.some((m) => m.derive !== undefined)).map(([key]) => key));

  // --- layout -------------------------------------------------------------------
  const conditionValues = useMemo(() => ({ ...options.values, ...slotValues }), [options.values, slotValues]);
  const initialConditionValues = useMemo(() => ({ ...initialValues, ...loadedSlots }), [initialValues, loadedSlots]);
  const layoutSlots = slots.map(
    (slot): FormLayoutSlot => ({
      moduleId: slot.module,
      key: slot.key,
      anchor: slot.anchor,
      weight: slot.weight,
      ...(slot.visibleWhen === undefined ? {} : { visibleWhen: slot.visibleWhen }),
    }),
  );
  const sections = declaredFormLayout({ form, effective, slots: layoutSlots, values: conditionValues });
  const rendered = new Set(sections.flatMap((section) => section.items.map((item) => item.key)));
  const coreKeys = form.sections.flatMap((section) => [...section.keys] as string[]);

  const effectiveOf = new Map((effective?.fields ?? []).map((field) => [field.key, field]));
  const declOf = new Map(fieldSet.fields.map((field) => [field.key as string, field as FieldDeclaration]));
  const writePermissionOf = (key: string): string | undefined => effectiveOf.get(key)?.writePermission ?? declOf.get(key)?.writePermission;
  const coreReadOnly = (key: string): boolean => {
    const permission = writePermissionOf(key);
    return options.readOnly === true || effectiveOf.get(key)?.readOnly === true || (permission !== undefined && !hasPermission(permission));
  };
  const slotReadOnly = (slot: OwnedFieldContribution): boolean =>
    options.readOnly === true || (slot.writePermission !== undefined && !hasPermission(slot.writePermission));

  // --- writes ---------------------------------------------------------------------
  const masked = (key: string, next: unknown): unknown => {
    if (typeof next !== 'string') return next;
    let value = next;
    for (const behaviour of behavioursOf.get(key) ?? []) if (behaviour.mask !== undefined) value = behaviour.mask(value);
    return value;
  };
  const clearError = (key: string): void => {
    if (errors[key] !== undefined) {
      setErrors((current) => {
        const rest = { ...current };
        delete rest[key];
        return rest;
      });
    }
  };
  const setCore = (key: string, next: unknown, by: 'operator' | 'form'): void => {
    if (by === 'operator') touched.current.add(key);
    clearError(key);
    options.onChange(key as FieldKeyOf<F>, by === 'operator' ? masked(key, next) : next);
  };
  const setSlot = (wire: string, next: unknown, by: 'operator' | 'form'): void => {
    if (by === 'operator') touched.current.add(wire);
    clearError(wire);
    const value = by === 'operator' ? masked(wire, next) : next;
    setStaged((current) => ({ ...current, [wire]: value }));
  };

  // Derivations pre-fill a target while the operator has not edited it in this
  // session; on an edit form only once a field they derive from changed, so
  // opening a record never rewrites what it stored. The server never runs them.
  const derivationKey = JSON.stringify(conditionValues) + behaviourKey + String(derivedKeys.size);
  useEffect(() => {
    for (const [target, modules] of behavioursOf) {
      for (const behaviour of modules) {
        if (behaviour.derive === undefined || touched.current.has(target)) continue;
        if (mode === 'edit' && !behaviour.derive.from.some((key) => fieldValueChanged(own(initialConditionValues, key), own(conditionValues, key)))) continue;
        const next = behaviour.derive.compute(conditionValues);
        const isSlot = slotByWire.has(target);
        const current = isSlot ? own(slotValues, target) : own(options.values, target);
        if (!fieldValueChanged(current, next)) continue;
        if (isSlot) setSlot(target, next, 'form');
        else if (declOf.has(target)) setCore(target, next, 'form');
      }
    }
  }, [derivationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A `default` override fills an empty field of a create form, once.
  const defaulted = useRef(new Set<string>());
  useEffect(() => {
    if (mode !== 'create') return;
    for (const field of effective?.fields ?? []) {
      if (field.default === undefined || defaulted.current.has(field.key) || touched.current.has(field.key)) continue;
      defaulted.current.add(field.key);
      if (isEmptyFieldValue(own(options.values, field.key))) setCore(field.key, field.default, 'form');
    }
  }, [effective]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- text -------------------------------------------------------------------------
  const textOf = (text: EffectiveText | undefined): string | undefined => {
    if (text === undefined) return undefined;
    if (text.source === 'code') return t(text.module, text.key);
    // Never another language's text (FR-092): without the reader's, the host's own.
    return text.text[language];
  };
  const slotLabel = (slot: OwnedFieldContribution): string => t(slot.module, slot.labelKey);

  // --- the submission, the rules, the errors ------------------------------------
  const submission = (): DeclaredFormSubmission =>
    declaredFormSubmission({
      mode,
      keys: coreKeys,
      state: (key) => ({ hidden: !rendered.has(key), readOnly: coreReadOnly(key), derived: derivedKeys.has(key) }),
      values: options.values,
      initialValues,
      slots: formSlots.map((slot) => ({
        moduleId: slot.module,
        key: slot.key,
        submittable: slotByWire.has(wireOf(slot)) && rendered.has(wireOf(slot)) && !slotReadOnly(slot),
      })),
      slotValues,
      initialSlotValues: loadedSlots,
    });

  const submittedKeys = (): string[] => {
    const core = submission().core;
    return coreKeys.filter((key) => Object.prototype.hasOwnProperty.call(core, key) || (rendered.has(key) && !coreReadOnly(key)));
  };

  const validate = (): boolean => {
    const violations = clientFieldViolations({
      mode,
      fieldSet,
      fields: effective?.fields ?? [],
      keys: submittedKeys(),
      values: conditionValues,
      initialValues: initialConditionValues,
    });
    const next: Record<string, string> = {};
    for (const violation of violations) {
      const params = violation.params?.limit !== undefined ? { limit: violation.params.limit } : violation.params?.format !== undefined ? { format: violation.params.format } : undefined;
      next[violation.path] ??=
        violation.messageKey !== undefined && violation.messageModule !== undefined
          ? t(violation.messageModule, violation.messageKey, params)
          : t('_lifecycle', `fieldRules.${violation.code}`, params);
    }
    setErrors(next);
    return violations.length === 0;
  };

  const applyError = (error: unknown): boolean => {
    const mapped = mapDeclaredFormError(error, [...coreKeys, ...formSlots.map(wireOf)]);
    if (mapped === null) return false;
    if (mapped.unclaimedModules.length > 0) {
      setDropped((current) => new Set([...current, ...mapped.unclaimedModules]));
      void refreshPresence();
    }
    setErrors(mapped.fields);
    return Object.keys(mapped.fields).length > 0 || mapped.unclaimedModules.length > 0;
  };

  // A slot whose module left — switched off, or refused as unclaimed — with a
  // value the operator staged: its change is discarded, and the form says so
  // with the save session's own sentence.
  const notices = formSlots
    .filter((slot) => (dropped.has(slot.module) || !isPresent(slot.module)) && Object.prototype.hasOwnProperty.call(staged, wireOf(slot)))
    .filter((slot) => fieldValueChanged(own(loadedSlots, wireOf(slot)), own(staged, wireOf(slot))))
    .map((slot) => t('core', 'saveSession.notice.moduleOff', { label: slotLabel(slot) }));

  // --- rendering ------------------------------------------------------------------
  const controlFor = (field: EffectiveField | undefined): { readonly id: string; readonly component: AnyComponent | ComponentType<DeclaredControlProps>; readonly module: string | null } | null => {
    const id = field?.control ?? null;
    if (id === null) return null;
    if (isPlatformControlId(id)) return { id, component: PLATFORM_CONTROL_COMPONENTS[id], module: null };
    // A module's control renders only while its module is present; otherwise
    // the field falls back to the host's own input (`input-controls.md` §3).
    const owned: OwnedInputControlContribution | undefined = contributions.controls.find((control) => control.id === id && isPresent(control.module));
    return owned === undefined ? null : { id, component: lazyComponentOf(owned.component), module: owned.module };
  };

  const renderItem = (kind: 'field' | 'slot', key: string): ReactNode => {
    if (kind === 'slot') {
      const slot = slotByWire.get(key);
      if (slot === undefined) return null;
      return (
        <DeclaredSlotField
          formId={form.id}
          mode={mode}
          recordId={options.recordId ?? null}
          slot={slot}
          label={slotLabel(slot)}
          help={slot.helpKey === undefined ? undefined : t(slot.module, slot.helpKey)}
          value={own(slotValues, key)}
          readOnly={slotReadOnly(slot)}
          error={errors[key]}
          formValues={options.values}
          onChange={(next) => setSlot(key, next, 'operator')}
        />
      );
    }
    const renderer = (options.render as Readonly<Record<string, DeclaredFieldRenderer | undefined>>)[key];
    if (renderer === undefined) {
      if (import.meta.env.DEV) console.warn(`[declared-form] no renderer for '${key}' on '${form.id}'`);
      return null;
    }
    const field = effectiveOf.get(key);
    const decl = declOf.get(key);
    const narrowed = field?.validation?.options;
    const fieldOptions = (renderer.options ?? (decl?.options ?? []).map((value) => ({ value, label: value }))).filter(
      (option) => narrowed === undefined || narrowed.includes(option.value),
    );
    return (
      <DeclaredCoreField
        fieldKey={key}
        renderer={renderer}
        labelOverride={textOf(field?.label)}
        helpOverride={textOf(field?.help)}
        placeholder={textOf(field?.placeholder)}
        required={decl?.required === true || isEffectivelyRequired(field, conditionValues)}
        readOnly={coreReadOnly(key)}
        error={errors[key]}
        value={own(options.values, key)}
        formValues={conditionValues}
        options={fieldOptions}
        control={controlFor(field)}
        onChange={(next) => setCore(key, next, 'operator')}
      />
    );
  };

  return {
    formId: form.id,
    mode,
    recordId: options.recordId ?? null,
    extensionModules,
    errors,
    notices,
    submission,
    validate,
    applyError,
    clearErrors: () => setErrors({}),
    sections,
    renderItem,
  };
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

interface DeclaredCoreFieldProps {
  readonly fieldKey: string;
  readonly renderer: DeclaredFieldRenderer;
  readonly labelOverride: string | undefined;
  readonly helpOverride: string | undefined;
  readonly placeholder: string | undefined;
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly error: string | undefined;
  readonly value: unknown;
  readonly formValues: Readonly<Record<string, unknown>>;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly control: { readonly id: string; readonly component: ComponentType<DeclaredControlProps> | AnyComponent; readonly module: string | null } | null;
  readonly onChange: (next: unknown) => void;
}

function DeclaredCoreField(props: DeclaredCoreFieldProps): ReactNode {
  const bareId = useId();
  const { renderer } = props;
  const accessibleName = props.labelOverride ?? ('label' in renderer && typeof renderer.label === 'string' ? renderer.label : props.fieldKey);

  const overrideControl = (control: FormFieldControlProps): ReactNode => {
    if (props.control === null) return null;
    const Component = props.control.component as ComponentType<DeclaredControlProps>;
    const element = (
      <Component
        value={props.value}
        onChange={props.onChange}
        control={control}
        readOnly={props.readOnly}
        label={accessibleName}
        placeholder={props.placeholder}
        options={props.options}
      />
    );
    if (props.control.module === null) return element;
    return (
      <ZoneErrorBoundary module={props.control.module} zone={`control:${props.control.id}`}>
        <Suspense fallback={null}>{element}</Suspense>
      </ZoneErrorBoundary>
    );
  };

  const inputProps = (control: FormFieldControlProps): DeclaredFieldInputProps => ({
    fieldKey: props.fieldKey,
    value: props.value,
    onChange: props.onChange,
    readOnly: props.readOnly,
    required: props.required,
    placeholder: props.placeholder,
    control,
    error: props.error,
    labelOverride: props.labelOverride,
    helpOverride: props.helpOverride,
    formValues: props.formValues,
    overrideControl: overrideControl(control),
  });

  if ('field' in renderer) return renderer.field(inputProps({ id: `${bareId}-control` }));

  const group = renderer.group === true || (props.control !== null && isPlatformControlId(props.control.id) && PLATFORM_GROUP_CONTROLS.has(props.control.id));
  return (
    <FormField
      label={props.labelOverride ?? renderer.label}
      help={props.helpOverride ?? renderer.help}
      {...(renderer.hint === undefined ? {} : { hint: renderer.hint })}
      error={props.error}
      required={props.required}
      group={group}
    >
      {(control) => overrideControl(control) ?? renderer.input(inputProps(control))}
    </FormField>
  );
}

interface DeclaredSlotFieldProps {
  readonly formId: string;
  readonly mode: 'create' | 'edit';
  readonly recordId: string | null;
  readonly slot: OwnedFieldContribution;
  readonly label: string;
  readonly help: string | undefined;
  readonly value: unknown;
  readonly readOnly: boolean;
  readonly error: string | undefined;
  readonly formValues: Readonly<Record<string, unknown>>;
  readonly onChange: (next: unknown) => void;
}

/** A slot field: the kit renders the label, help and error; the module's component the input only. */
function DeclaredSlotField(props: DeclaredSlotFieldProps): ReactNode {
  const Component = lazyComponentOf(props.slot.component) as unknown as ComponentType<FieldSlotProps>;
  return (
    <FormField label={props.label} help={props.help} error={props.error}>
      {(control) => (
        <ZoneErrorBoundary module={props.slot.module} zone={`field:${props.formId}`}>
          {/* `null`, not a spinner: a slot is an addition and must not push the host's fields around. */}
          <Suspense fallback={null}>
            <Component
              formId={props.formId}
              mode={props.mode}
              recordId={props.recordId}
              value={props.value}
              onChange={props.onChange}
              readOnly={props.readOnly}
              error={props.error}
              control={control}
              formValues={props.formValues}
            />
          </Suspense>
        </ZoneErrorBoundary>
      )}
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Provider, section, notices
// ---------------------------------------------------------------------------

const DeclaredFormContext = createContext<DeclaredFormController | null>(null);

export interface DeclaredFormProviderProps {
  readonly declared: DeclaredFormController;
  readonly children: ReactNode;
}

export function DeclaredFormProvider({ declared, children }: DeclaredFormProviderProps): ReactNode {
  return <DeclaredFormContext.Provider value={declared}>{children}</DeclaredFormContext.Provider>;
}

function useDeclaredFormContext(): DeclaredFormController {
  const declared = useContext(DeclaredFormContext);
  if (declared === null) {
    throw new Error('[declared-form] DeclaredFormSection was rendered outside <DeclaredFormProvider declared={useDeclaredForm(…)}>.');
  }
  return declared;
}

/** The submission of the form around this component (`field-slots.md` §3). */
export function useDeclaredFormSubmission(): DeclaredFormSubmission {
  return useDeclaredFormContext().submission();
}

export interface DeclaredFormSectionProps {
  /** A section key of the form. */
  readonly section: string;
  /**
   * Wraps the section's fields — the host's `EditorSection`, a fieldset. A
   * section left with no visible item renders nothing, its frame included (§5 step 4).
   */
  readonly frame?: (content: ReactNode) => ReactNode;
  readonly className?: string;
}

/** One section of the declared form, laid out (`field-slots.md` §5). */
export function DeclaredFormSection({ section, frame, className }: DeclaredFormSectionProps): ReactNode {
  const declared = useDeclaredFormContext();
  const laid = declared.sections.find((candidate) => candidate.key === section);
  if (laid === undefined) return null;
  const content = (
    <div className={cn('space-y-4', className)} data-declared-section={section}>
      {laid.items.map((item) => (
        <Fragment key={`${item.kind}:${item.key}`}>{declared.renderItem(item.kind, item.key)}</Fragment>
      ))}
    </div>
  );
  return frame === undefined ? content : frame(content);
}

/** The form's discarded-change notices (a slot module switched off), as the save session words them. */
export function DeclaredFormNotices(): ReactNode {
  const { notices } = useDeclaredFormContext();
  if (notices.length === 0) return null;
  return (
    <Alert variant="warning" live="polite">
      <AlertDescription>
        <ul className="list-disc pl-5">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
