/**
 * The `admin-forms` analysis — field slots, admin forms and input controls,
 * judged across a composition (`specs/193-admin-form-extensions/` FR-002,
 * FR-011, FR-012, FR-031; `contracts/field-slots.md` §5 and §6).
 *
 * **One analysis, two readers** (`field-slots.md` §6, on `palette-coverage`'s
 * precedent): `check:admin-forms` asks it in this repository, for bare core and
 * for every deployment on disk, and `endora generate` asks it in a client's
 * instance, where it exits 1 after writing. What composition can decide alone
 * (an unknown field, a refused override, a grant) is the platform's
 * `FormRegistry.seal` and is not asked again here; what is asked here is what
 * needs the **admin half** — the slots and controls an admin layer contributes
 * and the forms a host screen renders — which no process that composes the
 * backend ever sees.
 *
 * ## The population, and who wrote each half
 *
 *  - **Declarations** — `fieldSets`, `adminForms`, `inputControls` and
 *    `dependencies` — come off the manifests: as the value an import yields for
 *    a module package ({@link formsModuleFromManifest}), as literals in the
 *    source for an overlay module, which neither host can evaluate
 *    ({@link readManifestForms}).
 *  - **Contributions** — `fields` and `controls` — come off each admin layer's
 *    `contributions` object, read as source text ({@link readAdminLayerForms}),
 *    because an admin layer is JSX with lazy screen factories that no Node
 *    process imports.
 *  - **Renders** — the forms a host mounts — come off the host's
 *    `<DeclaredFormProvider form={…}>` (or its compiled `jsx(…)` twin), resolved
 *    through the module the form constant is imported from
 *    ({@link formRenderSitesIn}, {@link resolveFormRenders}).
 *
 * A declaration, a contribution or a render this analysis cannot read is
 * reported as **unreadable**, never skipped: a slot it did not see is a slot it
 * would call placed, and a render it did not resolve is a form it would call
 * unrendered or, worse, rendered (issue #113).
 *
 * ## The layout
 *
 * {@link formLayout} is §5's algorithm, normative and deterministic. The admin
 * kit renders with its own implementation; both run the vectors published as
 * `@endora-commerce/contracts/admin-forms.vectors`, shuffled as well as in
 * order, so registration order, bundle order and process never change a form
 * (SC-005).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  evaluateFieldCondition,
  fieldOverrideKinds,
  PRESENTATION_OVERRIDES,
  type FieldCondition,
  type FieldOverrideKind,
} from '@endora-commerce/contracts';
import type { FormLayoutVectorMove, FormLayoutVectorSlot } from '@endora-commerce/contracts/admin-forms.vectors';

import { parseSource } from './parsed-source.js';

// ---------------------------------------------------------------------------
// 1. The declarations, as data
// ---------------------------------------------------------------------------

/** One field of a field set, as far as this analysis reads it. */
export interface FormsField {
  readonly key: string;
  readonly deprecatedAliases: readonly string[];
}

export interface FormsFieldSet {
  readonly id: string;
  readonly ownerModuleId: string;
  readonly fields: readonly FormsField[];
}

export interface FormsAdminForm {
  readonly id: string;
  readonly fieldSet: string;
  readonly sections: readonly { readonly key: string; readonly keys: readonly string[] }[];
}

/** What one module's manifest declares that this analysis judges. */
export interface FormsModule {
  readonly moduleId: string;
  /** Where it was read — a message names it. */
  readonly where: string;
  readonly dependencies: readonly string[];
  readonly fieldSets: readonly FormsFieldSet[];
  readonly adminForms: readonly FormsAdminForm[];
  /** The ids of its `inputControls`. */
  readonly inputControls: readonly string[];
}

/** A slot's anchor as written: the pairing of kind and position is a finding of its own. */
export type FormsSlotAnchor =
  | { readonly field: string; readonly position: string }
  | { readonly section: string; readonly position: string };

/** One slot field an admin layer contributes (`field-slots.md` §1). */
export interface FormsSlot {
  readonly moduleId: string;
  readonly where: string;
  readonly fieldSet: string;
  /** Absent: every form of the set. */
  readonly forms?: readonly string[];
  readonly key: string;
  readonly anchor: FormsSlotAnchor;
  readonly weight: number;
}

/** What one module's admin layer contributes that this analysis judges. */
export interface FormsLayer {
  readonly moduleId: string;
  readonly where: string;
  readonly slots: readonly FormsSlot[];
  /** The ids of its `controls`. */
  readonly controls: readonly string[];
}

/** One form a host screen renders. */
export interface FormRender {
  readonly formId: string;
  readonly where: string;
}

// ---------------------------------------------------------------------------
// 2. The findings
// ---------------------------------------------------------------------------

export type AdminFormsFindingKind =
  | 'unknown-field-set'
  | 'unknown-form'
  | 'unknown-anchor'
  | 'foreign-slot-anchor'
  | 'position-anchor-mismatch'
  | 'duplicate-slot-key'
  | 'slot-owner-not-a-dependency'
  | 'undeclared-form'
  | 'unrendered-form'
  | 'control-without-declaration'
  | 'declaration-without-control'
  | 'ambiguous-slot-order'
  | 'deprecated-anchor';

/** §6's two severities: a refusal fails the run, a warning is printed and fails nothing. */
export const ADMIN_FORMS_WARNINGS: ReadonlySet<AdminFormsFindingKind> = new Set([
  'ambiguous-slot-order',
  'deprecated-anchor',
]);

export interface AdminFormsFinding {
  readonly kind: AdminFormsFindingKind;
  readonly severity: 'refusal' | 'warning';
  /** The module the remedy belongs to. */
  readonly moduleId: string;
  /** The slot's wire key, the form id or the control id. */
  readonly subject: string;
  /** Where it was read. */
  readonly where: string;
  readonly detail: string;
}

/** What each finding means and what to do about it. */
export const ADMIN_FORMS_REMEDIES: Readonly<Record<AdminFormsFindingKind, string>> = {
  'unknown-field-set':
    'A slot (or a form) names a field set no manifest in this composition declares. Check the id ' +
    "against the owner's `defineFieldSet` constant, and that the owner is installed.",
  'unknown-form':
    "A slot's `forms` names a form its field set does not have. Use the ids of the owner's " +
    '`defineAdminForm` constants, or drop `forms` to target every form of the set.',
  'unknown-anchor':
    'A slot is anchored on a field key or section that the field set does not declare, or that a ' +
    'form it targets does not show — so it has no place in that form. Anchor it on a key the form ' +
    "shows, or narrow the slot's `forms` to the forms that show its anchor.",
  'foreign-slot-anchor':
    "A slot is anchored on another module's slot. A slot may anchor on a core key, a section or a " +
    "slot of its own module only (FR-011): one package's rename would otherwise break another's layout.",
  'position-anchor-mismatch':
    "A slot's position does not fit its anchor: a field anchor takes `before` or `after`, a section " +
    'anchor `start` or `end`.',
  'duplicate-slot-key':
    'One module declares the same slot key twice on forms that overlap. The wire key is ' +
    '`extensions.<moduleId>.<key>`, so the two would be one value rendered twice. Rename one, or narrow ' +
    'their `forms` so they do not overlap.',
  'slot-owner-not-a-dependency':
    "A slot module does not declare the field set's owner in its manifest `dependencies`. Its hook on " +
    "the owner's writers is refused at composition for the same reason (`HookOwnerNotDependedOnError`); " +
    'add the owner to `dependencies`.',
  'undeclared-form':
    'A host renders a form no manifest lists in `adminForms`. List it in the manifest of the module ' +
    'whose screen renders it, which depends on the field set\'s owner (FR-083).',
  'unrendered-form':
    'A manifest lists a form no host renders — a promise to every slot author that nothing keeps. ' +
    'Render it through `DeclaredFormProvider`, or remove it from `adminForms`.',
  'control-without-declaration':
    "An admin layer's `controls` supplies a component for an id its manifest's `inputControls` does " +
    'not declare. Declare it (id, output type, format) in the manifest.',
  'declaration-without-control':
    "A manifest declares an input control its admin layer's `controls` supplies no component for. " +
    'Add the component, or remove the declaration.',
  'ambiguous-slot-order':
    'Two modules place a slot on one anchor and position with one weight. The order is still ' +
    'deterministic — `(weight, moduleId, localKey)` — but neither author chose it. Give one a ' +
    'different weight if the order matters.',
  'deprecated-anchor':
    'A slot is anchored on a renamed key that is still accepted as a deprecated alias for one ' +
    'release (FR-071). It resolves to the live key now and is refused once the alias is removed; ' +
    'anchor it on the live key.',
};

/** 1 when any finding is a refusal or anything was unreadable; warnings alone pass. */
export function adminFormsExitCode(
  findings: readonly Pick<AdminFormsFinding, 'severity'>[],
  unreadable: readonly string[],
): 0 | 1 {
  return unreadable.length > 0 || findings.some((finding) => finding.severity === 'refusal') ? 1 : 0;
}

/** One line per finding, in the words a reader can act on. */
export function describeAdminFormsFinding(finding: AdminFormsFinding): string {
  return `[${finding.kind}] ${finding.where}: ${finding.detail}`;
}

export interface AdminFormsInput {
  readonly modules: readonly FormsModule[];
  readonly layers: readonly FormsLayer[];
  readonly renders: readonly FormRender[];
  /**
   * The modules whose declared forms this run can see the hosts of. Absent:
   * every module. An instance passes its overlay modules only — an installed
   * package's host is compiled into its release and was judged there.
   */
  readonly rendersJudgedFor?: ReadonlySet<string>;
}

/** Codepoint order, never a locale's: the same answer in every process. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function quoted(values: Iterable<string>): string {
  return [...values].map((value) => `'${value}'`).join(', ');
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  return left.some((form) => right.includes(form));
}

type ResolvedAnchor =
  | { readonly kind: 'field'; readonly key: string; readonly position: 'before' | 'after' }
  | { readonly kind: 'section'; readonly key: string; readonly position: 'start' | 'end' }
  | { readonly kind: 'own-slot'; readonly key: string; readonly position: 'before' | 'after' };

/**
 * Every §6 finding over one composition, sorted so the answer does not depend
 * on the order anything was registered in.
 *
 * Pure over the declarations, so a fixture enters where a real run enters.
 */
export function adminFormsFindings(input: AdminFormsInput): AdminFormsFinding[] {
  const findings: AdminFormsFinding[] = [];
  const note = (
    kind: AdminFormsFindingKind,
    moduleId: string,
    subject: string,
    where: string,
    detail: string,
  ): void => {
    findings.push({ kind, severity: ADMIN_FORMS_WARNINGS.has(kind) ? 'warning' : 'refusal', moduleId, subject, where, detail });
  };

  const modules = [...input.modules].sort((a, b) => compare(a.moduleId, b.moduleId));
  const moduleById = new Map(modules.map((module) => [module.moduleId, module]));
  // The first declaration of an id wins; a second is composition's
  // `duplicate-field-set` / `duplicate-form`, refused there.
  const sets = new Map<string, FormsFieldSet>();
  const forms = new Map<string, { readonly form: FormsAdminForm; readonly moduleId: string; readonly where: string }>();
  for (const module of modules) {
    for (const set of module.fieldSets) if (!sets.has(set.id)) sets.set(set.id, set);
    for (const form of module.adminForms) {
      if (!forms.has(form.id)) forms.set(form.id, { form, moduleId: module.moduleId, where: module.where });
    }
  }
  const formsOfSet = (setId: string): string[] =>
    [...forms.values()].filter((entry) => entry.form.fieldSet === setId).map((entry) => entry.form.id).sort(compare);

  // A form over a field set nobody declares has no keys to show and no owner.
  for (const { form, moduleId, where } of [...forms.values()].sort((a, b) => compare(a.form.id, b.form.id))) {
    if (!sets.has(form.fieldSet)) {
      note('unknown-field-set', moduleId, form.id, where, `form '${form.id}' is laid out over field set '${form.fieldSet}', which no manifest in this composition declares`);
    }
  }

  const slots = input.layers
    .flatMap((layer) => layer.slots)
    .sort(
      (a, b) =>
        compare(a.moduleId, b.moduleId) || compare(a.fieldSet, b.fieldSet) || compare(a.key, b.key) || compare(a.where, b.where),
    );
  const slotsOf = new Map<string, FormsSlot[]>();
  for (const slot of slots) {
    const id = `${slot.fieldSet} ${slot.moduleId}`;
    slotsOf.set(id, [...(slotsOf.get(id) ?? []), slot]);
  }
  const layerModules = new Set(input.layers.map((layer) => layer.moduleId));

  interface Placed {
    readonly slot: FormsSlot;
    readonly anchor: ResolvedAnchor;
    readonly targets: readonly string[];
  }
  const placed: Placed[] = [];

  for (const slot of slots) {
    const wire = `${slot.moduleId}.${slot.key}`;
    const set = sets.get(slot.fieldSet);
    if (set === undefined) {
      note('unknown-field-set', slot.moduleId, wire, slot.where, `slot '${wire}' names field set '${slot.fieldSet}', which no manifest in this composition declares`);
      continue;
    }
    if (slot.moduleId !== set.ownerModuleId) {
      const dependencies = moduleById.get(slot.moduleId)?.dependencies ?? [];
      if (!dependencies.includes(set.ownerModuleId)) {
        note(
          'slot-owner-not-a-dependency',
          slot.moduleId,
          wire,
          slot.where,
          `slot '${wire}' extends field set '${set.id}', owned by '${set.ownerModuleId}', and '${slot.moduleId}' does not declare '${set.ownerModuleId}' in its dependencies`,
        );
      }
    }

    const setForms = formsOfSet(set.id);
    let targets: string[] = setForms;
    if (slot.forms !== undefined) {
      const unknown = slot.forms.filter((form) => !setForms.includes(form));
      if (unknown.length > 0) {
        note(
          'unknown-form',
          slot.moduleId,
          wire,
          slot.where,
          `slot '${wire}' targets ${quoted(unknown)}, which field set '${set.id}' does not have (its forms: ${setForms.join(', ') || 'none'})`,
        );
      }
      targets = [...new Set(slot.forms.filter((form) => setForms.includes(form)))].sort(compare);
    }

    const anchor = slot.anchor;
    if ('field' in anchor) {
      if (anchor.position !== 'before' && anchor.position !== 'after') {
        note('position-anchor-mismatch', slot.moduleId, wire, slot.where, `slot '${wire}' is anchored on field '${anchor.field}' at '${anchor.position}'; a field anchor takes 'before' or 'after'`);
        continue;
      }
      const position = anchor.position;
      const live = set.fields.map((field) => field.key);
      const aliasOf = new Map(set.fields.flatMap((field) => field.deprecatedAliases.map((alias) => [alias, field.key] as const)));
      const reference = anchor.field;
      let resolved: ResolvedAnchor | null = null;
      if (live.includes(reference)) {
        resolved = { kind: 'field', key: reference, position };
      } else if (aliasOf.has(reference)) {
        const key = aliasOf.get(reference)!;
        note('deprecated-anchor', slot.moduleId, wire, slot.where, `slot '${wire}' is anchored on '${reference}', a deprecated alias of '${key}' in field set '${set.id}'`);
        resolved = { kind: 'field', key, position };
      } else if (reference.includes('.')) {
        const prefix = reference.slice(0, reference.indexOf('.'));
        const local = reference.slice(prefix.length + 1);
        if (live.includes(`${prefix}.*`)) {
          // One member of a declared family: placed beside the family.
          resolved = { kind: 'field', key: `${prefix}.*`, position };
        } else if (prefix === slot.moduleId) {
          const own = (slotsOf.get(`${set.id} ${slot.moduleId}`) ?? []).find((candidate) => candidate.key === local);
          if (own === undefined || own === slot) {
            note('unknown-anchor', slot.moduleId, wire, slot.where, `slot '${wire}' is anchored on '${reference}', which '${slot.moduleId}' does not contribute to field set '${set.id}'`);
          } else {
            resolved = { kind: 'own-slot', key: reference, position };
          }
        } else if ((slotsOf.get(`${set.id} ${prefix}`) ?? []).some((candidate) => candidate.key === local) || layerModules.has(prefix)) {
          note('foreign-slot-anchor', slot.moduleId, wire, slot.where, `slot '${wire}' is anchored on '${reference}', a slot of '${prefix}'; anchor it on a core key, a section or a slot of '${slot.moduleId}'`);
        } else {
          note('unknown-anchor', slot.moduleId, wire, slot.where, `slot '${wire}' is anchored on '${reference}', which field set '${set.id}' does not declare (its keys: ${live.join(', ')})`);
        }
      } else {
        note('unknown-anchor', slot.moduleId, wire, slot.where, `slot '${wire}' is anchored on '${reference}', which field set '${set.id}' does not declare (its keys: ${live.join(', ')})`);
      }
      if (resolved === null) continue;
      if (resolved.kind === 'field') {
        const key = resolved.key;
        const missing = targets.filter((formId) => !forms.get(formId)!.form.sections.some((section) => section.keys.includes(key)));
        if (missing.length > 0) {
          note(
            'unknown-anchor',
            slot.moduleId,
            wire,
            slot.where,
            `slot '${wire}' is anchored on '${key}', which ${quoted(missing)} does not show — narrow its forms to the ones that show it`,
          );
          continue;
        }
      }
      placed.push({ slot, anchor: resolved, targets });
    } else {
      if (anchor.position !== 'start' && anchor.position !== 'end') {
        note('position-anchor-mismatch', slot.moduleId, wire, slot.where, `slot '${wire}' is anchored on section '${anchor.section}' at '${anchor.position}'; a section anchor takes 'start' or 'end'`);
        continue;
      }
      const missing = targets.filter((formId) => !forms.get(formId)!.form.sections.some((section) => section.key === anchor.section));
      if (missing.length > 0) {
        note('unknown-anchor', slot.moduleId, wire, slot.where, `slot '${wire}' is anchored on section '${anchor.section}', which ${quoted(missing)} does not have`);
        continue;
      }
      placed.push({ slot, anchor: { kind: 'section', key: anchor.section, position: anchor.position }, targets });
    }
  }

  // An own-slot anchor is placed only if its chain of own-slot anchors ends on a
  // core key or a section: a cycle has no root the layout can reach, so neither
  // member would ever render.
  const placedOf = (moduleId: string, fieldSet: string, key: string): Placed | undefined =>
    placed.find((candidate) => candidate.slot.moduleId === moduleId && candidate.slot.fieldSet === fieldSet && candidate.slot.key === key);
  const cyclic = new Set<Placed>();
  for (const entry of placed) {
    const seen = new Set<Placed>();
    let current: Placed | undefined = entry;
    while (current !== undefined && current.anchor.kind === 'own-slot' && !seen.has(current)) {
      seen.add(current);
      current = placedOf(current.slot.moduleId, current.slot.fieldSet, current.anchor.key.slice(current.slot.moduleId.length + 1));
    }
    if (current !== undefined && seen.has(current)) {
      cyclic.add(entry);
      const wire = `${entry.slot.moduleId}.${entry.slot.key}`;
      note('unknown-anchor', entry.slot.moduleId, wire, entry.slot.where, `slot '${wire}' is anchored on '${entry.anchor.key}', in a cycle of '${entry.slot.moduleId}' slots that reaches no core key or section, so no form can place it`);
    }
  }

  // An own-slot anchor is placed only if the slot it names is placed in every
  // form this one targets; otherwise it has nowhere to go there.
  for (const entry of placed) {
    if (entry.anchor.kind !== 'own-slot' || cyclic.has(entry)) continue;
    const local = entry.anchor.key.slice(entry.slot.moduleId.length + 1);
    const target = placed.find((candidate) => candidate.slot.moduleId === entry.slot.moduleId && candidate.slot.fieldSet === entry.slot.fieldSet && candidate.slot.key === local);
    const missing = target === undefined ? entry.targets : entry.targets.filter((form) => !target.targets.includes(form));
    if (missing.length > 0) {
      const wire = `${entry.slot.moduleId}.${entry.slot.key}`;
      note('unknown-anchor', entry.slot.moduleId, wire, entry.slot.where, `slot '${wire}' is anchored on '${entry.anchor.key}', which is not placed in ${quoted(missing)}`);
    }
  }

  // One key, one module, one field set: one wire key. Twice on forms that
  // overlap is one value rendered twice.
  for (const [id, group] of [...slotsOf].sort(([a], [b]) => compare(a, b))) {
    const set = sets.get(id.slice(0, id.indexOf(' ')));
    if (set === undefined) continue;
    const setForms = formsOfSet(set.id);
    const byKey = new Map<string, FormsSlot[]>();
    for (const slot of group) byKey.set(slot.key, [...(byKey.get(slot.key) ?? []), slot]);
    for (const [key, same] of [...byKey].sort(([a], [b]) => compare(a, b))) {
      if (same.length < 2) continue;
      const targetsOf = (slot: FormsSlot): readonly string[] => slot.forms ?? setForms;
      const clash = same.some((left, i) => same.slice(i + 1).some((right) => overlaps(targetsOf(left), targetsOf(right))));
      if (clash) {
        const wire = `${same[0]!.moduleId}.${key}`;
        note('duplicate-slot-key', same[0]!.moduleId, wire, same[0]!.where, `'${same[0]!.moduleId}' declares slot key '${key}' on field set '${set.id}' ${String(same.length)} times, on forms that overlap`);
      }
    }
  }

  // Two modules, one anchor, one position, one weight: deterministic by the
  // tie-break, chosen by neither author (R-4).
  const ambiguous = new Map<string, Placed[]>();
  for (const entry of placed) {
    if (entry.anchor.kind === 'own-slot') continue;
    const id = [entry.slot.fieldSet, entry.anchor.kind, entry.anchor.key, entry.anchor.position, String(entry.slot.weight)].join(' ');
    ambiguous.set(id, [...(ambiguous.get(id) ?? []), entry]);
  }
  for (const [, group] of [...ambiguous].sort(([a], [b]) => compare(a, b))) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i]!;
        const right = group[j]!;
        if (left.slot.moduleId === right.slot.moduleId || !overlaps(left.targets, right.targets)) continue;
        const leftWire = `${left.slot.moduleId}.${left.slot.key}`;
        const rightWire = `${right.slot.moduleId}.${right.slot.key}`;
        note(
          'ambiguous-slot-order',
          right.slot.moduleId,
          rightWire,
          right.slot.where,
          `slots '${leftWire}' and '${rightWire}' are both ${left.anchor.position} ${left.anchor.kind} '${left.anchor.key}' of field set '${left.slot.fieldSet}' with weight ${String(left.slot.weight)}; the tie-break renders '${leftWire}' first`,
        );
      }
    }
  }

  // FR-002, both directions, on `check:admin-zones`' terms.
  const rendered = new Set(input.renders.map((render) => render.formId));
  for (const render of [...input.renders].sort((a, b) => compare(a.formId, b.formId) || compare(a.where, b.where))) {
    if (forms.has(render.formId)) continue;
    note('undeclared-form', '(host)', render.formId, render.where, `form '${render.formId}' is rendered here and no manifest lists it in \`adminForms\``);
  }
  for (const [formId, { moduleId, where }] of [...forms].sort(([a], [b]) => compare(a, b))) {
    if (input.rendersJudgedFor !== undefined && !input.rendersJudgedFor.has(moduleId)) continue;
    if (rendered.has(formId)) continue;
    note('unrendered-form', moduleId, formId, where, `'${moduleId}' lists form '${formId}' and no host renders it`);
  }

  // FR-031, both directions, per module.
  const controlsOf = new Map(input.layers.map((layer) => [layer.moduleId, layer] as const));
  for (const layer of [...input.layers].sort((a, b) => compare(a.moduleId, b.moduleId))) {
    const declared = moduleById.get(layer.moduleId)?.inputControls ?? [];
    for (const id of [...new Set(layer.controls)].sort(compare)) {
      if (!declared.includes(id)) {
        note('control-without-declaration', layer.moduleId, id, layer.where, `'${layer.moduleId}' supplies a component for input control '${id}', which its manifest does not declare in \`inputControls\``);
      }
    }
  }
  for (const module of modules) {
    const supplied = controlsOf.get(module.moduleId)?.controls ?? [];
    for (const id of [...new Set(module.inputControls)].sort(compare)) {
      if (!supplied.includes(id)) {
        note('declaration-without-control', module.moduleId, id, module.where, `'${module.moduleId}' declares input control '${id}' and its admin layer supplies no component for it`);
      }
    }
  }

  return findings.sort(
    (a, b) =>
      compare(a.kind, b.kind) || compare(a.moduleId, b.moduleId) || compare(a.subject, b.subject) || compare(a.where, b.where) || compare(a.detail, b.detail),
  );
}

// ---------------------------------------------------------------------------
// 3. The layout (`field-slots.md` §5)
// ---------------------------------------------------------------------------

export type FormLayoutSlot = FormLayoutVectorSlot;
export type FormLayoutMove = FormLayoutVectorMove;

export interface FormLayoutInput {
  /** The form's sections, in declared order, each with its core keys in order. */
  readonly sections: readonly { readonly key: string; readonly keys: readonly string[] }[];
  /** Effective `position` overrides. */
  readonly moves?: readonly FormLayoutMove[];
  /** Core keys hidden by an override: rendered as nothing, anchors kept. */
  readonly hidden?: readonly string[];
  /** Effective `visibleWhen` per core key. */
  readonly visibleWhen?: Readonly<Record<string, FieldCondition>>;
  readonly slots?: readonly FormLayoutSlot[];
  /** The form's current values, which every condition reads. */
  readonly values?: Readonly<Record<string, unknown>>;
}

export interface FormLayoutItem {
  readonly kind: 'field' | 'slot';
  /** A core key, or a slot's wire key `<moduleId>.<key>`. */
  readonly key: string;
}

export interface FormLayoutSection {
  readonly key: string;
  readonly items: readonly FormLayoutItem[];
}

const bySlotOrder = (a: FormLayoutSlot, b: FormLayoutSlot): number =>
  a.weight - b.weight || compare(a.moduleId, b.moduleId) || compare(a.key, b.key);

/**
 * §5, deterministic: sections in declared order; core keys in declared order
 * after `position` overrides (moved keys applied in `(moduleId, key)` order);
 * around each key the slots anchored before it, the key unless hidden, the
 * slots anchored after it, each sorted `(weight, moduleId, localKey)` and each
 * followed recursively by the slots of its own module anchored on it; section
 * `start` and `end` slots outermost; then items whose `visibleWhen` is false
 * are dropped, and a section left with no item with them.
 *
 * Input order is never read: every list is sorted before it is used.
 */
export function formLayout(input: FormLayoutInput): FormLayoutSection[] {
  const order = input.sections.map((section) => ({ key: section.key, keys: [...section.keys] }));
  const sectionOf = (key: string) => order.find((section) => section.keys.includes(key)) ?? null;

  // 1. Position overrides, in (moduleId, key) order. Keys moved after one
  //    anchor keep that order by following the last key placed there.
  const moves = [...(input.moves ?? [])].sort((a, b) => compare(a.moduleId, b.moduleId) || compare(a.key, b.key));
  const lastAfter = new Map<string, string>();
  for (const move of moves) {
    const from = sectionOf(move.key);
    if (from === null) continue;
    const anchor = move.before ?? move.after;
    const target = anchor !== undefined ? sectionOf(anchor) : order.find((section) => section.key === move.section) ?? null;
    if (target === null || anchor === move.key) continue;
    from.keys.splice(from.keys.indexOf(move.key), 1);
    if (move.before !== undefined) {
      target.keys.splice(target.keys.indexOf(move.before), 0, move.key);
    } else if (move.after !== undefined) {
      const behind = lastAfter.get(move.after);
      const at = behind !== undefined && target.keys.includes(behind) ? target.keys.indexOf(behind) : target.keys.indexOf(move.after);
      target.keys.splice(at + 1, 0, move.key);
      lastAfter.set(move.after, move.key);
    } else {
      target.keys.push(move.key);
    }
  }

  // 2 – 3. Slots around their anchors.
  const slots = [...(input.slots ?? [])].sort(bySlotOrder);
  const around = new Map<string, FormLayoutSlot[]>();
  for (const slot of slots) {
    const anchor = slot.anchor;
    const id = 'field' in anchor ? `field ${anchor.field} ${anchor.position}` : `section ${anchor.section} ${anchor.position}`;
    around.set(id, [...(around.get(id) ?? []), slot]);
  }
  const hidden = new Set(input.hidden ?? []);
  const values = input.values ?? {};
  const visible = (condition: FieldCondition | undefined): boolean =>
    condition === undefined || evaluateFieldCondition(condition, values);

  const rendered: FormLayoutSection[] = [];
  for (const section of order) {
    const items: FormLayoutItem[] = [];
    const emitSlot = (slot: FormLayoutSlot): void => {
      const wire = `${slot.moduleId}.${slot.key}`;
      for (const child of around.get(`field ${wire} before`) ?? []) if (child.moduleId === slot.moduleId) emitSlot(child);
      if (visible(slot.visibleWhen)) items.push({ kind: 'slot', key: wire });
      for (const child of around.get(`field ${wire} after`) ?? []) if (child.moduleId === slot.moduleId) emitSlot(child);
    };
    for (const slot of around.get(`section ${section.key} start`) ?? []) emitSlot(slot);
    for (const key of section.keys) {
      const family = key.endsWith('.*') ? key.slice(0, -1) : null;
      const anchoredOn = (position: 'before' | 'after'): FormLayoutSlot[] =>
        family === null
          ? around.get(`field ${key} ${position}`) ?? []
          : slots.filter((slot) => 'field' in slot.anchor && slot.anchor.position === position && slot.anchor.field.startsWith(family));
      for (const slot of anchoredOn('before')) emitSlot(slot);
      if (!hidden.has(key) && visible(input.visibleWhen?.[key])) items.push({ kind: 'field', key });
      for (const slot of anchoredOn('after')) emitSlot(slot);
    }
    for (const slot of around.get(`section ${section.key} end`) ?? []) emitSlot(slot);
    // 4. A section with no item is dropped.
    if (items.length > 0) rendered.push({ key: section.key, items });
  }
  return rendered;
}

// ---------------------------------------------------------------------------
// 4. The readers
// ---------------------------------------------------------------------------

/** A value the reader could not evaluate as a literal. */
const OPAQUE: unique symbol = Symbol('opaque');
type Literal = unknown;

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function nameOf(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

/** Calls that return their argument unchanged, so a declaration may be wrapped in one. */
const IDENTITY_CALLS = new Set(['defineFieldSet', 'defineAdminForm', 'defineModuleManifest']);

/** Top-level `const` initialisers, so a value may be a same-file constant. */
function constantsOf(tree: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
  const found = new Map<string, ts.Expression>();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
        found.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return found;
}

/**
 * A literal value, or {@link OPAQUE}: strings, numbers, booleans, `null`,
 * arrays and objects of those, a same-file constant, a member of one, and the
 * identity calls. A function is opaque — a component factory is never read.
 */
function literalOf(node: ts.Expression, constants: ReadonlyMap<string, ts.Expression>, depth = 0): Literal {
  if (depth > 16) return OPAQUE;
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) {
    return -Number(value.operand.text);
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(value)) {
    const initializer = constants.get(value.text);
    return initializer === undefined ? OPAQUE : literalOf(initializer, constants, depth + 1);
  }
  if (ts.isArrayLiteralExpression(value)) {
    const out: Literal[] = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) return OPAQUE;
      out.push(literalOf(element, constants, depth + 1));
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const out: Record<string, Literal> = {};
    for (const property of value.properties) {
      if (ts.isPropertyAssignment(property)) {
        const key = nameOf(property.name);
        if (key === null) return OPAQUE;
        out[key] = literalOf(property.initializer, constants, depth + 1);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        out[property.name.text] = literalOf(property.name, constants, depth + 1);
      } else if (ts.isMethodDeclaration(property)) {
        const key = nameOf(property.name);
        if (key === null) return OPAQUE;
        out[key] = OPAQUE;
      } else {
        return OPAQUE;
      }
    }
    return out;
  }
  if (ts.isPropertyAccessExpression(value)) {
    const owner = literalOf(value.expression, constants, depth + 1);
    return isRecord(owner) && value.name.text in owner ? owner[value.name.text] : OPAQUE;
  }
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && IDENTITY_CALLS.has(value.expression.text) && value.arguments[0] !== undefined) {
    return literalOf(value.arguments[0], constants, depth + 1);
  }
  return OPAQUE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

/** The object literal `export const <name> = …` holds, through the identity calls. */
function exportedLiteral(tree: ts.SourceFile, name: string): ts.ObjectLiteralExpression | 'absent' | 'unreadable' {
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      if (declaration.initializer === undefined) return 'unreadable';
      let value = unwrap(declaration.initializer);
      if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && IDENTITY_CALLS.has(value.expression.text) && value.arguments[0] !== undefined) {
        value = unwrap(value.arguments[0]);
      }
      return ts.isObjectLiteralExpression(value) ? value : 'unreadable';
    }
  }
  return 'absent';
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && nameOf(property.name) === name) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) return property.name;
  }
  return null;
}

function lineOf(tree: ts.SourceFile, node: ts.Node): number {
  return tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
}

/** A slot entry as data, or why it is not one. */
function slotOf(moduleId: string, where: string, value: Literal): FormsSlot | string {
  if (!isRecord(value)) return 'not an object literal';
  const { fieldSet, forms, key, anchor, weight } = value;
  if (!isString(fieldSet)) return '`fieldSet` is not a string literal or a same-file constant';
  if (!isString(key)) return '`key` is not a string literal or a same-file constant';
  if (forms !== undefined && !isStrings(forms)) return '`forms` is not a literal array of form ids';
  if (typeof weight !== 'number') return '`weight` is not a number literal';
  if (!isRecord(anchor)) return '`anchor` is not an object literal';
  const position = anchor['position'];
  if (!isString(position)) return '`anchor.position` is not a string literal';
  const field = anchor['field'];
  const section = anchor['section'];
  if (isString(field) === isString(section)) return '`anchor` names neither or both of `field` and `section` as literals';
  return {
    moduleId,
    where,
    fieldSet,
    ...(forms === undefined ? {} : { forms }),
    key,
    anchor: isString(field) ? { field, position } : { section: section as string, position },
    weight,
  };
}

/**
 * One admin layer's `fields` and `controls`, read off its `contributions`
 * object literal — TypeScript source or the compiled JavaScript a package
 * ships, which keeps the object literal.
 */
export function readAdminLayerForms(
  moduleId: string,
  file: string,
  source: string,
): { readonly layer: FormsLayer; readonly unreadable: readonly string[] } {
  const tree = parseSource(file, source);
  const constants = constantsOf(tree);
  const unreadable: string[] = [];
  const slots: FormsSlot[] = [];
  const controls: string[] = [];
  const contributions = exportedLiteral(tree, 'contributions');
  if (contributions === 'unreadable') unreadable.push(`${file}: \`contributions\` is not an object literal`);
  if (typeof contributions !== 'string') {
    const fields = propertyOf(contributions, 'fields');
    if (fields !== null) {
      const list = unwrap(fields);
      if (!ts.isArrayLiteralExpression(list)) {
        unreadable.push(`${file}:${String(lineOf(tree, fields))}: \`fields\` is not an array literal`);
      } else {
        for (const element of list.elements) {
          const where = `${file}:${String(lineOf(tree, element))}`;
          const slot = ts.isSpreadElement(element) ? 'a spread' : slotOf(moduleId, where, literalOf(element, constants));
          if (typeof slot === 'string') unreadable.push(`${where}: a slot field this analysis cannot read — ${slot}`);
          else slots.push(slot);
        }
      }
    }
    const declared = propertyOf(contributions, 'controls');
    if (declared !== null) {
      const list = unwrap(declared);
      if (!ts.isArrayLiteralExpression(list)) {
        unreadable.push(`${file}:${String(lineOf(tree, declared))}: \`controls\` is not an array literal`);
      } else {
        for (const element of list.elements) {
          const value = ts.isSpreadElement(element) ? OPAQUE : literalOf(element, constants);
          const id = isRecord(value) ? value['id'] : OPAQUE;
          if (isString(id)) controls.push(id);
          else unreadable.push(`${file}:${String(lineOf(tree, element))}: an input control whose \`id\` is not a literal`);
        }
      }
    }
  }
  return { layer: { moduleId, where: file, slots, controls }, unreadable };
}

function fieldSetOf(value: unknown): FormsFieldSet | null {
  if (!isRecord(value) || !isString(value['id']) || !isString(value['ownerModuleId']) || !Array.isArray(value['fields'])) return null;
  const fields: FormsField[] = [];
  for (const field of value['fields']) {
    if (!isRecord(field) || !isString(field['key'])) return null;
    const aliases = field['deprecatedAliases'];
    fields.push({
      key: field['key'],
      deprecatedAliases: Array.isArray(aliases) ? aliases.filter(isRecord).map((alias) => alias['key']).filter(isString) : [],
    });
  }
  return { id: value['id'], ownerModuleId: value['ownerModuleId'], fields };
}

function adminFormOf(value: unknown): FormsAdminForm | null {
  if (!isRecord(value) || !isString(value['id']) || !isString(value['fieldSet']) || !Array.isArray(value['sections'])) return null;
  const sections: { key: string; keys: string[] }[] = [];
  for (const section of value['sections']) {
    if (!isRecord(section) || !isString(section['key']) || !isStrings(section['keys'])) return null;
    sections.push({ key: section['key'], keys: section['keys'] });
  }
  return { id: value['id'], fieldSet: value['fieldSet'], sections };
}

/**
 * A manifest value — what importing a module package's manifest yields — as
 * the declarations this analysis judges. `null` for a value with no module id.
 */
export function formsModuleFromManifest(
  manifest: unknown,
  where: string,
): { readonly module: FormsModule | null; readonly unreadable: readonly string[] } {
  if (!isRecord(manifest) || !isString(manifest['id'])) {
    return { module: null, unreadable: [`${where}: no manifest with a module id`] };
  }
  const unreadable: string[] = [];
  const listOf = <T>(field: string, read: (value: unknown) => T | null): T[] => {
    const value = manifest[field];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      unreadable.push(`${where}: \`${field}\` is not an array`);
      return [];
    }
    const out: T[] = [];
    value.forEach((entry, index) => {
      const item = read(entry);
      if (item === null) unreadable.push(`${where}: \`${field}[${String(index)}]\` cannot be read as literals`);
      else out.push(item);
    });
    return out;
  };
  const dependencies = manifest['dependencies'];
  if (dependencies !== undefined && !isStrings(dependencies)) unreadable.push(`${where}: \`dependencies\` is not an array of module ids`);
  return {
    module: {
      moduleId: manifest['id'],
      where,
      dependencies: isStrings(dependencies) ? dependencies : [],
      fieldSets: listOf('fieldSets', fieldSetOf),
      adminForms: listOf('adminForms', adminFormOf),
      inputControls: listOf('inputControls', (value) => (isRecord(value) && isString(value['id']) ? value['id'] : null)),
    },
    unreadable,
  };
}

/**
 * An overlay module's `manifest.ts`, read as source text: neither host can
 * import TypeScript an instance ships unbuilt. A declaration written other than
 * as literals — a field set imported from another file — is named.
 */
export function readManifestForms(
  moduleId: string,
  file: string,
  source: string,
): { readonly module: FormsModule; readonly unreadable: readonly string[] } {
  const tree = parseSource(file, source);
  const constants = constantsOf(tree);
  const manifest = exportedLiteral(tree, 'manifest');
  if (typeof manifest === 'string') {
    return {
      module: { moduleId, where: file, dependencies: [], fieldSets: [], adminForms: [], inputControls: [] },
      unreadable: [`${file}: no \`export const manifest\` object literal`],
    };
  }
  const value: Record<string, unknown> = { id: moduleId };
  const unreadable: string[] = [];
  for (const field of ['dependencies', 'fieldSets', 'adminForms', 'inputControls']) {
    const node = propertyOf(manifest, field);
    if (node === null) continue;
    const literal = literalOf(node, constants);
    const opaque = (candidate: unknown): boolean =>
      candidate === OPAQUE || (Array.isArray(candidate) ? candidate.some(opaque) : isRecord(candidate) ? Object.values(candidate).some(opaque) : false);
    if (opaque(literal)) {
      unreadable.push(`${file}:${String(lineOf(tree, node))}: \`${field}\` is not written as literals in the manifest`);
      continue;
    }
    value[field] = literal;
  }
  const read = formsModuleFromManifest(value, file);
  return { module: read.module!, unreadable: [...unreadable, ...read.unreadable] };
}

/** The element that renders a declared form (`field-slots.md` §3). */
export const FORM_RENDERER = 'DeclaredFormProvider';

/** A render site's form, as far as the source spells it. */
export type FormRenderReference =
  | { readonly where: string; readonly kind: 'import'; readonly file: string; readonly specifier: string; readonly path: readonly string[] };

/** Every `form` a host file hands {@link FORM_RENDERER}, unresolved. */
export function formRenderSitesIn(
  file: string,
  source: string,
): { readonly references: readonly FormRenderReference[]; readonly unreadable: readonly string[] } {
  if (!source.includes(FORM_RENDERER)) return { references: [], unreadable: [] };
  const tree = parseSource(file, source);
  const constants = constantsOf(tree);
  const imports = new Map<string, { readonly specifier: string; readonly name: string | null }>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const specifier = statement.moduleSpecifier.text;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, { specifier, name: (element.propertyName ?? element.name).text });
      }
    } else if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, { specifier, name: null });
    }
  }
  const references: FormRenderReference[] = [];
  const unreadable: string[] = [];

  const resolveForm = (node: ts.Expression, where: string, depth: number): void => {
    const value = unwrap(node);
    if (ts.isConditionalExpression(value)) {
      resolveForm(value.whenTrue, where, depth + 1);
      resolveForm(value.whenFalse, where, depth + 1);
      return;
    }
    const path: string[] = [];
    let root: ts.Expression = value;
    for (;;) {
      root = unwrap(root);
      if (ts.isPropertyAccessExpression(root)) {
        path.unshift(root.name.text);
        root = root.expression;
      } else if (ts.isElementAccessExpression(root) && ts.isStringLiteral(root.argumentExpression)) {
        path.unshift(root.argumentExpression.text);
        root = root.expression;
      } else {
        break;
      }
    }
    if (ts.isIdentifier(root)) {
      const imported = imports.get(root.text);
      if (imported !== undefined) {
        references.push({ where, kind: 'import', file, specifier: imported.specifier, path: imported.name === null ? path : [imported.name, ...path] });
        return;
      }
      const local = constants.get(root.text);
      if (local !== undefined && path.length === 0 && depth < 4) {
        resolveForm(local, where, depth + 1);
        return;
      }
    }
    unreadable.push(`${where}: \`${FORM_RENDERER}\` is handed a form this analysis cannot resolve to an imported declaration: ${value.getText(tree).slice(0, 120)}`);
  };

  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === FORM_RENDERER) {
      const where = `${file}:${String(lineOf(tree, node))}`;
      const attribute = node.attributes.properties.find(
        (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(tree) === 'form',
      );
      const expression = attribute?.initializer !== undefined && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
      if (expression === undefined) unreadable.push(`${where}: \`${FORM_RENDERER}\` with no \`form={…}\` expression`);
      else resolveForm(expression, where, 0);
    }
    // The compiled twin: `jsx(DeclaredFormProvider, { form: … })`.
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const [component, props] = node.arguments;
      if (component !== undefined && ts.isIdentifier(component) && component.text === FORM_RENDERER && props !== undefined) {
        const where = `${file}:${String(lineOf(tree, node))}`;
        const object = unwrap(props);
        const form = ts.isObjectLiteralExpression(object) ? propertyOf(object, 'form') : null;
        if (form === null) unreadable.push(`${where}: \`${FORM_RENDERER}\` with no literal \`form\` property`);
        else resolveForm(form, where, 0);
      }
    }
    node.forEachChild(visit);
  };
  tree.forEachChild(visit);
  return { references, unreadable };
}

/** How a host's form constant is loaded; the default resolves it from the host file. */
export type FormModuleImporter = (specifier: string, fromFile: string) => Promise<unknown>;

/**
 * The default importer: the specifier resolved **from the host file**, so a
 * bare specifier finds the package the host itself depends on.
 */
export const importFormModule: FormModuleImporter = async (specifier, fromFile) => {
  const target = specifier.startsWith('.')
    ? resolve(dirname(fromFile), specifier)
    : createRequire(resolve(fromFile)).resolve(specifier);
  return import(pathToFileURL(target).href);
};

/** Each reference's form id, through the module it is imported from. */
export async function resolveFormRenders(
  references: readonly FormRenderReference[],
  importer: FormModuleImporter = importFormModule,
): Promise<{ readonly renders: readonly FormRender[]; readonly unreadable: readonly string[] }> {
  // Per host file, then per specifier: one import per pair, and no composite key to spell.
  const loaded = new Map<string, Map<string, unknown>>();
  for (const reference of references) {
    const ofFile = loaded.get(reference.file) ?? new Map<string, unknown>();
    loaded.set(reference.file, ofFile);
    if (!ofFile.has(reference.specifier)) {
      ofFile.set(reference.specifier, await importer(reference.specifier, reference.file).catch((error: unknown) => error));
    }
  }
  return resolveFormRendersWith(references, (specifier, fromFile) => loaded.get(fromFile)?.get(specifier));
}

/**
 * {@link resolveFormRenders} over modules already loaded: `load` answers the
 * module a specifier names from a host file, or an `Error` for one that would
 * not load. Synchronous, so a red proof enters with source text and the
 * modules' exports and nothing else.
 */
export function resolveFormRendersWith(
  references: readonly FormRenderReference[],
  load: (specifier: string, fromFile: string) => unknown,
): { readonly renders: readonly FormRender[]; readonly unreadable: readonly string[] } {
  const renders: FormRender[] = [];
  const unreadable: string[] = [];
  for (const reference of references) {
    let value: unknown = load(reference.specifier, reference.file);
    const failed = value instanceof Error ? value.message : null;
    for (const segment of reference.path) value = isRecord(value) ? value[segment] : undefined;
    const form = failed === null ? adminFormOf(value) : null;
    if (form === null) {
      unreadable.push(
        `${reference.where}: \`${[reference.specifier, ...reference.path].join(' → ')}\` is not an admin form declaration` +
          (failed === null ? '' : ` (${failed})`),
      );
    } else {
      renders.push({ formId: form.id, where: reference.where });
    }
  }
  return { renders, unreadable };
}

/**
 * The whole analysis over source text, for a proof that must enter at the top
 * (issue #130): manifests as the values their import yields, admin layers and
 * host screens as source, and the modules the hosts import as their exports.
 */
export function adminFormsOverSources(input: {
  readonly manifests: readonly unknown[];
  readonly layers?: Readonly<Record<string, { readonly file: string; readonly source: string }>>;
  readonly hosts?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
}): { readonly findings: readonly AdminFormsFinding[]; readonly unreadable: readonly string[] } {
  const unreadable: string[] = [];
  const modules: FormsModule[] = [];
  input.manifests.forEach((manifest, index) => {
    const read = formsModuleFromManifest(manifest, `manifest[${String(index)}]`);
    unreadable.push(...read.unreadable);
    if (read.module !== null) modules.push(read.module);
  });
  const layers = Object.entries(input.layers ?? {}).map(([moduleId, { file, source }]) => {
    const read = readAdminLayerForms(moduleId, file, source);
    unreadable.push(...read.unreadable);
    return read.layer;
  });
  const references = Object.entries(input.hosts ?? {}).flatMap(([file, source]) => {
    const read = formRenderSitesIn(file, source);
    unreadable.push(...read.unreadable);
    return read.references;
  });
  const exportsOf = input.exports ?? {};
  const resolved = resolveFormRendersWith(references, (specifier) =>
    specifier in exportsOf ? exportsOf[specifier] : new Error(`no module ${specifier}`),
  );
  unreadable.push(...resolved.unreadable);
  return { findings: adminFormsFindings({ modules, layers, renders: resolved.renders }), unreadable };
}

// ---------------------------------------------------------------------------
// 5. The populations: a composition and the deployments over it
// ---------------------------------------------------------------------------

export interface AdminFormsPopulation {
  readonly modules: readonly FormsModule[];
  readonly layers: readonly FormsLayer[];
  readonly renders: readonly FormRender[];
  readonly unreadable: readonly string[];
  /** Files this read opened. */
  readonly files: number;
}

/** One composition's verdict, as either host prints it. */
export interface AdminFormsJudgement {
  /** `null` for the base composition (bare core, or an instance's installed packages). */
  readonly deployment: string | null;
  readonly findings: readonly AdminFormsFinding[];
  readonly unreadable: readonly string[];
  /** Declarations this composition judged: field sets, forms, slots, controls and renders. */
  readonly sites: number;
}

const SOURCE_FILE = /\.(?:tsx?|jsx?|mjs)$/;
const NOT_A_HOST = /(?:\.test|\.spec)\.[cm]?[jt]sx?$|\.d\.ts$/;
const PRUNED = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo', 'test', '__tests__']);

/** Every host source under `root`, sorted; tests are not hosts. */
export function hostSourcesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      let directory: boolean;
      try {
        directory = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (directory) {
        if (!PRUNED.has(name) && !name.startsWith('.')) walk(path);
      } else if (SOURCE_FILE.test(name) && !NOT_A_HOST.test(name)) {
        out.push(path);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

function sitesOf(population: Pick<AdminFormsPopulation, 'modules' | 'layers' | 'renders'>): number {
  return (
    population.modules.reduce((sum, module) => sum + module.fieldSets.length + module.adminForms.length + module.inputControls.length, 0) +
    population.layers.reduce((sum, layer) => sum + layer.slots.length + layer.controls.length, 0) +
    population.renders.length
  );
}

/** Repository-relative, `/`-separated — what a message names. */
function displayPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

/**
 * Host files' render sites, resolved: the walk every population shares.
 * `display` is how a message names a file; resolution reads the real path.
 */
export async function readRenders(
  files: readonly string[],
  display: (path: string) => string,
  importer: FormModuleImporter = importFormModule,
): Promise<{ readonly renders: readonly FormRender[]; readonly unreadable: readonly string[] }> {
  const references: FormRenderReference[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes(FORM_RENDERER)) continue;
    const read = formRenderSitesIn(file, source);
    references.push(...read.references);
    unreadable.push(...read.unreadable);
  }
  const resolved = await resolveFormRenders(references, importer);
  return {
    renders: resolved.renders.map((render) => ({ ...render, where: displayWhere(render.where, display) })),
    unreadable: [...unreadable, ...resolved.unreadable].map((line) => displayWhere(line, display)),
  };
}

/** `<absolute path>:<line>: …` → `<display path>:<line>: …`. */
function displayWhere(line: string, display: (path: string) => string): string {
  const match = /^(\/[^:]+)(.*)$/s.exec(line);
  return match === null ? line : `${display(match[1]!)}${match[2]!}`;
}

/** The overlay module directories of one deployment, sorted. */
function overlayModulesOf(appsRoot: string, deployment: string): string[] {
  const root = join(appsRoot, deployment, 'modules');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** The admin entry of an overlay module (`specs/190-overlay-full-modules/` FR-080). */
export const OVERLAY_ADMIN_ENTRY_FILE = join('admin', 'index.tsx');

/**
 * One deployment's overlay modules under `appsRoot` — `<deployment>/modules/<id>/`
 * with `manifest.ts`, `admin/index.tsx` and the admin sources as hosts. The same
 * layout in this repository (`backend/src/apps`) and in an instance (`apps`).
 */
export async function readOverlayDeployment(
  appsRoot: string,
  deployment: string,
  displayRoot: string,
  importer: FormModuleImporter = importFormModule,
): Promise<AdminFormsPopulation & { readonly overlayModules: readonly string[]; readonly adminLayers: number }> {
  const display = (path: string): string => displayPath(displayRoot, path);
  const modules: FormsModule[] = [];
  const layers: FormsLayer[] = [];
  const unreadable: string[] = [];
  const hosts: string[] = [];
  let files = 0;
  const overlayModules = overlayModulesOf(appsRoot, deployment);
  for (const moduleId of overlayModules) {
    const dir = join(appsRoot, deployment, 'modules', moduleId);
    const manifest = join(dir, 'manifest.ts');
    if (existsSync(manifest)) {
      files += 1;
      const read = readManifestForms(moduleId, display(manifest), readFileSync(manifest, 'utf8'));
      modules.push(read.module);
      unreadable.push(...read.unreadable);
    }
    const layer = join(dir, OVERLAY_ADMIN_ENTRY_FILE);
    if (existsSync(layer)) {
      const read = readAdminLayerForms(moduleId, display(layer), readFileSync(layer, 'utf8'));
      layers.push(read.layer);
      unreadable.push(...read.unreadable);
    }
    hosts.push(...hostSourcesUnder(join(dir, 'admin')));
  }
  files += hosts.length;
  const rendered = await readRenders(hosts, display, importer);
  return {
    modules,
    layers,
    renders: rendered.renders,
    unreadable: [...unreadable, ...rendered.unreadable],
    files,
    overlayModules,
    adminLayers: layers.length,
  };
}

/** Every deployment directory under `appsRoot`, sorted. */
export function deploymentsUnder(appsRoot: string): string[] {
  if (!existsSync(appsRoot)) return [];
  return readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * The base composition and each deployment over it, judged.
 *
 * A deployment is judged over the base **plus** its overlay modules, and
 * reports only what the base alone does not: a finding about a core slot is the
 * base's, and repeating it once per deployment is noise that trains a reader to
 * skip the list. What a deployment adds — its own slots, a pair it makes
 * ambiguous, a form it renders — is its own.
 */
export function judgeAdminForms(
  base: AdminFormsPopulation,
  deployments: ReadonlyArray<{ readonly deployment: string; readonly population: AdminFormsPopulation }>,
  options: { readonly baseRendersJudged?: boolean } = {},
): AdminFormsJudgement[] {
  const baseIds = new Set(base.modules.map((module) => module.moduleId));
  const baseFindings = adminFormsFindings({
    modules: base.modules,
    layers: base.layers,
    renders: base.renders,
    ...(options.baseRendersJudged === false ? { rendersJudgedFor: new Set<string>() } : {}),
  });
  const judgements: AdminFormsJudgement[] = [
    { deployment: null, findings: baseFindings, unreadable: base.unreadable, sites: sitesOf(base) },
  ];
  const seen = new Set(baseFindings.map((finding) => JSON.stringify(finding)));
  for (const { deployment, population } of deployments) {
    const overlayIds = new Set(population.modules.map((module) => module.moduleId).filter((id) => !baseIds.has(id)));
    const findings = adminFormsFindings({
      modules: [...base.modules, ...population.modules],
      layers: [...base.layers, ...population.layers],
      renders: [...base.renders, ...population.renders],
      ...(options.baseRendersJudged === false ? { rendersJudgedFor: overlayIds } : {}),
    }).filter((finding) => !seen.has(JSON.stringify(finding)));
    judgements.push({ deployment, findings, unreadable: population.unreadable, sites: sitesOf(population) });
  }
  return judgements;
}

/** The report lines for a set of judgements: a summary per composition, then each line. */
export function adminFormsReport(judgements: readonly AdminFormsJudgement[]): string[] {
  const lines: string[] = [];
  for (const judgement of judgements) {
    if (judgement.sites === 0 && judgement.findings.length === 0 && judgement.unreadable.length === 0) continue;
    const name = judgement.deployment ?? 'the base composition';
    const refusals = judgement.findings.filter((finding) => finding.severity === 'refusal').length + judgement.unreadable.length;
    const warnings = judgement.findings.length - (refusals - judgement.unreadable.length);
    lines.push(`admin forms of ${name}: ${String(judgement.sites)} declaration(s), ${refusals === 0 ? 'clean' : `${String(refusals)} refusal(s)`}${warnings === 0 ? '' : `, ${String(warnings)} warning(s)`}`);
    for (const finding of judgement.findings) lines.push(`  ${describeAdminFormsFinding(finding)}`);
    for (const line of judgement.unreadable) lines.push(`  [admin-forms-unreadable] ${line}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 6. `formOverrides`, for the divergence derivation (`field-overrides.md` §5)
// ---------------------------------------------------------------------------

/** One manifest `formOverrides` entry, as far as the divergence report reads it. */
export interface StaticFormOverride {
  /** `<fieldSetId>.<fieldReference>`. */
  readonly target: string;
  /** The override kinds it sets, in `FIELD_OVERRIDE_KINDS` order. */
  readonly kinds: readonly FieldOverrideKind[];
  readonly line: number;
}

/**
 * The `formOverrides` declarations of the manifest written in `source`, read
 * without running it, as `command-middleware`'s are. Only the target's value
 * is read: which **kinds** an entry sets is which properties it writes, so a
 * computed value of a kind is still that kind. An entry whose target is not a
 * literal, or which is not written in place, is `unresolved` — never "no
 * override", the direction that agrees with the defect.
 */
export function formOverrideDeclarationsIn(
  source: string,
  file: string,
): { readonly declarations: readonly StaticFormOverride[]; readonly unresolved: readonly { readonly line: number; readonly text: string }[] } {
  const tree = parseSource(file, source);
  const constants = constantsOf(tree);
  const declarations: StaticFormOverride[] = [];
  const unresolved: { line: number; text: string }[] = [];
  const textOf = (node: ts.Node): string => {
    const text = node.getText(tree).replace(/\s+/g, ' ');
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === 'formOverrides') {
      const list = unwrap(node.initializer);
      if (!ts.isArrayLiteralExpression(list)) {
        unresolved.push({ line: lineOf(tree, node), text: textOf(node) });
        return;
      }
      for (const element of list.elements) {
        const entry = ts.isSpreadElement(element) ? null : unwrap(element);
        if (entry === null || !ts.isObjectLiteralExpression(entry) || entry.properties.some((property) => !ts.isPropertyAssignment(property))) {
          unresolved.push({ line: lineOf(tree, element), text: textOf(element) });
          continue;
        }
        const present: Record<string, true> = {};
        for (const property of entry.properties) {
          const key = nameOf((property as ts.PropertyAssignment).name);
          if (key !== null) present[key] = true;
        }
        const targetNode = propertyOf(entry, 'target');
        const target = targetNode === null ? OPAQUE : literalOf(targetNode, constants);
        if (!isString(target)) {
          unresolved.push({ line: lineOf(tree, element), text: textOf(element) });
          continue;
        }
        declarations.push({ target, kinds: fieldOverrideKinds(present), line: lineOf(tree, element) });
      }
      return;
    }
    node.forEachChild(visit);
  };
  tree.forEachChild(visit);
  return { declarations, unresolved };
}

/** True when every kind changes only what a form shows (FR-062). */
export function presentationOnly(kinds: readonly FieldOverrideKind[]): boolean {
  return kinds.every((kind) => (PRESENTATION_OVERRIDES as readonly string[]).includes(kind));
}
