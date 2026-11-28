/**
 * The declared form's layout on the admin's side (`specs/193-admin-form-extensions/`
 * `contracts/field-slots.md` §5, D-300.14).
 *
 * The algorithm has **one** implementation, the contracts' `formLayout`, and
 * this file only feeds it. `position` overrides — deployment code, a granted
 * package, the operator layer — were applied by the server
 * (`GET /api/v1/admin/effective-forms` runs `applyFieldMoves` per key, operator
 * over code) and arrive as each field's `section` and `order`. So the kit
 * hands `formLayout` the server's order and **no moves**: applying them here a
 * second time would move a key twice, and re-deriving them would be a second
 * copy of step 1 that the vectors could only hold where they look.
 */
import {
  formLayout,
  type AdminFormDeclaration,
  type EffectiveFormsResponse,
  type FieldCondition,
  type FormLayoutSection,
  type FormLayoutSectionKeys,
  type FormLayoutSlot,
} from '@endora-commerce/contracts';

/** One form of the effective-forms response. */
export type EffectiveForm = EffectiveFormsResponse['forms'][number];

/**
 * The form's sections with their core keys, in the server's order.
 *
 * Sections stay in **declared** order — a move changes a key's section, never
 * the sections' order. Each section holds the effective fields the server
 * placed in it, by `order`. A key the declaration shows but the response does
 * not carry (a version skew between the bundle and the server) keeps its
 * declared section, after the placed keys; a key the response carries but the
 * form does not declare is not this form's and is dropped. Without an
 * effective form — still loading, failed, or not served — the declaration is
 * the layout: overrides are presentation, and the server enforces its rules
 * whatever the form showed (FR-062).
 */
export function declaredFormSections(
  form: Pick<AdminFormDeclaration, 'sections'>,
  effective: EffectiveForm | undefined,
): FormLayoutSectionKeys[] {
  if (effective === undefined) return form.sections.map((section) => ({ key: section.key, keys: [...section.keys] }));
  const declared = new Map<string, string>();
  for (const section of form.sections) for (const key of section.keys) declared.set(key, section.key);
  const sectionKeys = new Set(form.sections.map((section) => section.key));
  const placed = new Set<string>();
  const bySection = new Map<string, { key: string; order: number }[]>();
  for (const field of effective.fields) {
    if (!declared.has(field.key)) continue;
    // A section the form does not declare cannot be rendered: keep the declared one.
    const section = sectionKeys.has(field.section) ? field.section : declared.get(field.key)!;
    bySection.set(section, [...(bySection.get(section) ?? []), { key: field.key, order: field.order }]);
    placed.add(field.key);
  }
  return form.sections.map((section) => ({
    key: section.key,
    keys: [
      ...(bySection.get(section.key) ?? []).sort((a, b) => a.order - b.order).map((entry) => entry.key),
      ...section.keys.filter((key) => !placed.has(key)),
    ],
  }));
}

export interface DeclaredFormLayoutInput {
  readonly form: Pick<AdminFormDeclaration, 'sections'>;
  readonly effective: EffectiveForm | undefined;
  /** The present, permitted slots of this form (`<moduleId>.<key>` on the wire). */
  readonly slots: readonly FormLayoutSlot[];
  /** Core values and slot values (`<moduleId>.<key>`), which every condition reads. */
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * `formLayout` over the server's order: hidden keys and `visibleWhen` from the
 * effective form, the slots as given, no moves (D-300.14).
 */
export function declaredFormLayout(input: DeclaredFormLayoutInput): FormLayoutSection[] {
  const hidden: string[] = [];
  const visibleWhen: Record<string, FieldCondition> = {};
  for (const field of input.effective?.fields ?? []) {
    if (field.hidden) hidden.push(field.key);
    if (field.visibleWhen !== undefined) visibleWhen[field.key] = field.visibleWhen;
  }
  return formLayout({
    sections: declaredFormSections(input.form, input.effective),
    hidden,
    visibleWhen,
    slots: input.slots,
    values: input.values,
  });
}
