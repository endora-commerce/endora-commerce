/**
 * What a declared form submits (`specs/193-admin-form-extensions/`
 * `contracts/field-slots.md` §3, FR-013, FR-016, FR-062, D-300.12).
 *
 * One request, the host's: its core fields, and the slot values folded in
 * under `extensions.<moduleId>` — a slot is never a save-session participant.
 *
 * - A field hidden by `hidden` or by a false `visibleWhen` is **never** sent,
 *   derived or not, so the host endpoint keeps the stored value.
 * - A read-only field is not sent either — except one that a present
 *   derivation targets on this form and that is visible: that one is sent
 *   with its derived value, always on create and on edit when it differs from
 *   the loaded value. The replacement pattern relies on it.
 * - A slot value is sent on create when it is set, and on edit when the
 *   operator changed it. A module nobody changed a value of is not named, so
 *   an untouched form sends exactly what the host sent before it adopted.
 *
 * None of this is access control: hidden and read-only are presentation, and
 * an API caller may write the same fields (FR-062).
 */
import { fieldValueChanged } from './rules.js';

export interface SubmissionFieldState {
  /** Hidden by an override, or not visible for the current values. */
  readonly hidden: boolean;
  /** Read-only by an override, by the host, or for want of the field's writePermission. */
  readonly readOnly: boolean;
  /** A present derivation targets the field on this form. */
  readonly derived: boolean;
}

export interface SubmissionSlot {
  readonly moduleId: string;
  readonly key: string;
  /** Rendered (present, permitted, visible) and writable. */
  readonly submittable: boolean;
}

export interface DeclaredFormSubmission {
  readonly core: Readonly<Record<string, unknown>>;
  /** `undefined` when no slot value is sent: the host's body then carries no `extensions`. */
  readonly extensions: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
}

export interface DeclaredFormSubmissionInput {
  readonly mode: 'create' | 'edit';
  /** Every core key the form shows. */
  readonly keys: readonly string[];
  readonly state: (key: string) => SubmissionFieldState;
  readonly values: Readonly<Record<string, unknown>>;
  readonly initialValues: Readonly<Record<string, unknown>>;
  readonly slots: readonly SubmissionSlot[];
  /** Keyed by the wire key `<moduleId>.<key>`. */
  readonly slotValues: Readonly<Record<string, unknown>>;
  readonly initialSlotValues: Readonly<Record<string, unknown>>;
}

const own = (values: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;

export function declaredFormSubmission(input: DeclaredFormSubmissionInput): DeclaredFormSubmission {
  const isCreate = input.mode === 'create';
  const core: Record<string, unknown> = {};
  for (const key of input.keys) {
    const state = input.state(key);
    if (state.hidden) continue;
    const value = own(input.values, key);
    if (state.readOnly) {
      if (!state.derived) continue;
      if (!isCreate && !fieldValueChanged(own(input.initialValues, key), value)) continue;
    }
    if (value === undefined) continue;
    core[key] = value;
  }

  const extensions: Record<string, Record<string, unknown>> = {};
  for (const slot of input.slots) {
    if (!slot.submittable) continue;
    const wire = `${slot.moduleId}.${slot.key}`;
    const value = own(input.slotValues, wire);
    const send = isCreate ? value !== undefined : fieldValueChanged(own(input.initialSlotValues, wire), value);
    if (!send) continue;
    (extensions[slot.moduleId] ??= {})[slot.key] = value === undefined ? null : value;
  }
  return { core, extensions: Object.keys(extensions).length === 0 ? undefined : extensions };
}
