import { describe, expect, it } from 'vitest';
import {
  applyFieldMoves,
  defineAdminForm,
  type EffectiveField,
  type EffectiveFormsResponse,
  type FormLayoutSection,
} from '@endora-commerce/contracts';
import { FORM_LAYOUT_VECTORS, type FormLayoutVector } from '@endora-commerce/contracts/admin-forms.vectors';
import { declaredFormLayout, declaredFormSections } from '@endora-commerce/admin-kit/lib';

/**
 * `specs/193-admin-form-extensions/` T037 — the admin kit's layout
 * (`contracts/field-slots.md` §5, D-300.14).
 *
 * The algorithm has one implementation, the contracts' `formLayout`. The kit
 * calls it with **the server's order and no moves**: `position` overrides were
 * applied by `GET /api/v1/admin/effective-forms` (`applyFieldMoves`, per key,
 * operator over code), and the kit must neither apply them a second time nor
 * re-derive them. So each shared vector is run end to end the way it runs in
 * production — the vector's moves through the server half to an effective
 * form, then that form through the kit — and must give the vector's answer,
 * with the slots in any registration order (SC-005).
 */

type EffectiveForm = EffectiveFormsResponse['forms'][number];

/** The server half, as `effective-forms.ts` computes `section` and `order` (one counter across sections). */
function serverEffectiveForm(vector: FormLayoutVector): EffectiveForm {
  const laid = applyFieldMoves(vector.sections, vector.moves ?? []);
  const fields: EffectiveField[] = [];
  let order = 0;
  for (const section of laid) {
    for (const key of section.keys) {
      fields.push({
        key,
        section: section.key,
        order: order++,
        readOnly: false,
        hidden: (vector.hidden ?? []).includes(key),
        control: null,
        ...(vector.visibleWhen?.[key] === undefined ? {} : { visibleWhen: vector.visibleWhen[key] }),
        overriddenBy: [],
        operatorKinds: [],
      });
    }
  }
  // The response's field order is not the layout's: the kit must sort by `order`.
  return { id: 'organization.edit', fieldSet: 'organization', fields: [...fields].reverse() };
}

function formOf(vector: FormLayoutVector) {
  return defineAdminForm({
    id: 'organization.edit',
    fieldSet: 'organization',
    mode: 'edit',
    sections: vector.sections.map((section) => ({ key: section.key, keys: [...section.keys] })),
  });
}

const flat = (sections: readonly FormLayoutSection[]) =>
  sections.map((section) => ({ section: section.key, items: section.items.map((item) => item.key) }));

/** Deterministic permutations: reversed, rotated, and interleaved. */
function shuffles<T>(list: readonly T[]): (readonly T[])[] {
  if (list.length < 2) return [list];
  const reversed = [...list].reverse();
  const rotated = [...list.slice(1), list[0]!];
  const interleaved = [...list.filter((_, i) => i % 2 === 1), ...list.filter((_, i) => i % 2 === 0)];
  return [list, reversed, rotated, interleaved];
}

describe('declaredFormLayout — the shared vectors through the server half and the kit (T037)', () => {
  for (const vector of FORM_LAYOUT_VECTORS) {
    it(vector.name, () => {
      const effective = serverEffectiveForm(vector);
      for (const slots of shuffles(vector.slots ?? [])) {
        const layout = declaredFormLayout({
          form: formOf(vector),
          effective,
          slots,
          values: vector.values ?? {},
        });
        expect(flat(layout)).toEqual(vector.expected);
      }
    });
  }
});

describe('declaredFormSections — the server order is the order (D-300.14)', () => {
  const form = defineAdminForm({
    id: 'organization.edit',
    fieldSet: 'organization',
    mode: 'edit',
    sections: [
      { key: 'identity', keys: ['name', 'taxId', 'parentId'] },
      { key: 'address', keys: ['registeredAddress'] },
    ],
  });
  const field = (key: string, section: string, order: number): EffectiveField => ({
    key,
    section,
    order,
    readOnly: false,
    hidden: false,
    control: null,
    overriddenBy: [],
    operatorKinds: [],
  });

  it('places each key in the section and at the order the server answered, sections in declared order', () => {
    const effective: EffectiveForm = {
      id: form.id,
      fieldSet: 'organization',
      fields: [
        field('registeredAddress', 'address', 3),
        field('taxId', 'address', 2),
        field('parentId', 'identity', 0),
        field('name', 'identity', 1),
      ],
    };
    expect(declaredFormSections(form, effective)).toEqual([
      { key: 'identity', keys: ['parentId', 'name'] },
      { key: 'address', keys: ['taxId', 'registeredAddress'] },
    ]);
  });

  it('is the declaration itself while no effective form is known (loading, failed, not served)', () => {
    expect(declaredFormSections(form, undefined)).toEqual([
      { key: 'identity', keys: ['name', 'taxId', 'parentId'] },
      { key: 'address', keys: ['registeredAddress'] },
    ]);
  });

  it('keeps a declared key the response does not carry at its declared place, and drops a key the form does not declare', () => {
    const effective: EffectiveForm = {
      id: form.id,
      fieldSet: 'organization',
      fields: [field('taxId', 'identity', 0), field('name', 'identity', 1), field('nickname', 'identity', 2)],
    };
    expect(declaredFormSections(form, effective)).toEqual([
      { key: 'identity', keys: ['taxId', 'name', 'parentId'] },
      { key: 'address', keys: ['registeredAddress'] },
    ]);
  });
});
