import { describe, expect, it } from 'vitest';
import { applyFieldMoves, formLayout, type FieldOverride, type ModuleOrigin } from '@endora-commerce/contracts';
import { FORM_LAYOUT_VECTORS } from '@endora-commerce/contracts/admin-forms.vectors';
import { computeEffectiveForms } from './effective-forms.js';
import { sealForms } from './seal.js';

/**
 * `specs/193-admin-form-extensions/` D-300.14 (`contracts/field-slots.md` §5):
 * the effective-forms response lays a form out with the one layout
 * implementation in contracts. On every shared layout vector, slots left out —
 * the response carries core keys only — each field's `section` and `order` are
 * `applyFieldMoves`', and the keys a form renders, in order, are `formLayout`'s.
 */

const OWNER = 'widgets';

function effectiveFor(vector: (typeof FORM_LAYOUT_VECTORS)[number]) {
  const keys = vector.sections.flatMap((section) => section.keys);
  const moduleIds = [...new Set((vector.moves ?? []).map((move) => move.moduleId).concat('acme'))];
  const overrides: { moduleId: string; override: FieldOverride }[] = [];
  for (const move of vector.moves ?? []) {
    const position = {
      ...(move.section === undefined ? {} : { section: move.section }),
      ...(move.before === undefined ? {} : { before: move.before }),
      ...(move.after === undefined ? {} : { after: move.after }),
    };
    overrides.push({ moduleId: move.moduleId, override: { target: `vector.${move.key}`, position, reason: 'Vector move.' } as FieldOverride });
  }
  for (const key of vector.hidden ?? []) {
    overrides.push({ moduleId: 'acme', override: { target: `vector.${key}`, hidden: true, reason: 'Vector hide.' } as FieldOverride });
  }
  for (const [key, condition] of Object.entries(vector.visibleWhen ?? {})) {
    overrides.push({ moduleId: 'acme', override: { target: `vector.${key}`, visibleWhen: condition, reason: 'Vector condition.' } as FieldOverride });
  }
  const origins: Record<string, ModuleOrigin> = { [OWNER]: 'core' };
  const moduleDependencies: Record<string, readonly string[]> = { [OWNER]: [] };
  for (const id of moduleIds) {
    origins[id] = 'deployment';
    moduleDependencies[id] = [OWNER];
  }
  const sealed = sealForms({
    fieldSets: [
      {
        moduleId: OWNER,
        set: { id: 'vector', ownerModuleId: OWNER, fields: keys.map((key) => ({ key, type: 'string' as const, required: false, accepts: ['position', 'hidden', 'visibleWhen'] as const })) },
      },
    ],
    adminForms: [{ moduleId: OWNER, form: { id: 'vector.edit', fieldSet: 'vector', mode: 'edit', sections: vector.sections } }],
    formOverrides: overrides,
    inputControls: [],
    hookableActions: [],
    moduleDependencies,
    permissionCodes: [],
    origins,
    installedPackageNames: {},
    writers: [],
    formats: [],
  });
  return computeEffectiveForms(sealed, () => true, []).forms[0]!.fields;
}

describe('effective forms lay out with contracts’ formLayout (193 D-300.14)', () => {
  for (const vector of FORM_LAYOUT_VECTORS) {
    it(vector.name, () => {
      const fields = effectiveFor(vector);
      const byOrder = [...fields].sort((a, b) => a.order - b.order);
      const moved = applyFieldMoves(vector.sections, vector.moves ?? []);
      expect(byOrder.map((field) => [field.section, field.key])).toEqual(moved.flatMap((section) => section.keys.map((key) => [section.key, key])));
      const rendered = formLayout({
        sections: vector.sections,
        ...(vector.moves === undefined ? {} : { moves: vector.moves }),
        ...(vector.hidden === undefined ? {} : { hidden: vector.hidden }),
        ...(vector.visibleWhen === undefined ? {} : { visibleWhen: vector.visibleWhen }),
        ...(vector.values === undefined ? {} : { values: vector.values }),
      });
      const shown = new Set(rendered.flatMap((section) => section.items.map((item) => item.key)));
      expect(byOrder.filter((field) => shown.has(field.key)).map((field) => field.key)).toEqual(rendered.flatMap((section) => section.items.map((item) => item.key)));
    });
  }
});
