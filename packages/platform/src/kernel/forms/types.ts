import type { FieldSetDeclaration, HookableActionRef } from '@endora-commerce/contracts';

/**
 * What an owner registers through `ctx.fieldSets` and `ctx.fieldFormats`
 * (`specs/193-admin-form-extensions/` `contracts/field-rules.md` §2,
 * `input-controls.md` §1) — the backend half of a field set.
 */

/** The field values one write leaves, and what it was before (or what changed). */
export type FieldProjection =
  | {
      /** `null` on create. */
      readonly before: Readonly<Record<string, unknown>> | null;
      readonly after: Readonly<Record<string, unknown>>;
    }
  | {
      readonly after: Readonly<Record<string, unknown>>;
      /**
       * The keys whose value this write set or cleared. For hook data that
       * carries no before-state (`changedFields`), field-rules.md §2.
       */
      readonly changed: readonly string[];
    };

/**
 * One saved scope of a scoped writer (FR-124). `scope` is `null` for the
 * global value — the only one a tightened `required` binds — and otherwise a
 * label for the scope, which nothing reads but a diagnostic.
 */
export type FieldScopedProjection = FieldProjection & { readonly scope: string | null };

// A ref's data types are the owner's; `any` is the bound that lets any ref through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHookableActionRef = HookableActionRef<any, any>;

/** One action that writes the field set's entity (field-rules.md §2). */
export interface FieldSetWriter {
  /**
   * The action. A hookable action that offers `beforeCommit`, or — with
   * `ruleCheckOnly` — a module-local action that is **not** declared hookable.
   */
  readonly on: AnyHookableActionRef;
  /**
   * FR-113: a Command that a stored-revert undo reverses runs under an action
   * of its own that is never hookable. It admits the field-rule check alone,
   * and must still supply `hookData`.
   */
  readonly ruleCheckOnly?: boolean;
  /** FR-124: `project` returns one entry per saved scope. */
  readonly scoped?: boolean;
  readonly mode: 'create' | 'update';
  /**
   * Pure: the Command's hook data → field values. Keys outside the set are
   * ignored. A scoped writer returns an array, one entry per saved scope.
   */
  readonly project: (data: unknown) => FieldProjection | readonly FieldScopedProjection[];
  /** The keys this writer can change **and projects**; nothing else is checked on it. */
  readonly writes: readonly string[];
}

/** One `ctx.fieldSets` entry: the owner's own field set and its writers. */
export interface FieldSetRegistration {
  readonly set: FieldSetDeclaration;
  readonly writers: readonly FieldSetWriter[];
}

/** One `ctx.fieldFormats` entry: a module format's server validator (FR-033). */
export interface FieldFormatRegistration {
  /** `<moduleId>.<name>`, where `<moduleId>` is the registering module. */
  readonly id: string;
  readonly validate: (value: string) => boolean;
}
