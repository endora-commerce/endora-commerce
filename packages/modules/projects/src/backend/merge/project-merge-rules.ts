import { isDeepStrictEqual } from 'node:util';
import {
  ERROR_CODES,
  PROJECT_MERGE_FIELD_CODES,
  type ProjectMergeFieldCode,
  type RecordMergeChoice,
  type RecordMergeFieldDifference,
  type RecordMergeNotice,
} from '@endora-commerce/contracts';
import type { Project } from '../entities/project.entity.js';

/**
 * The Project host's own merge rules (`specs/192-organization-merge/` US6,
 * FR-090, FR-031), as pure functions of the two rows. The preview asks them on
 * a read and the start Command asks them again on the two rows it locked, so
 * the start can never accept what the preview refused.
 *
 * Both Projects may be in any state; the survivor keeps its state, its current
 * Stage, its Stages and its Template, none of which is offered for choice.
 */

/** The columns the rules read. The entity satisfies it. */
export type MergeableProject = Pick<Project, 'id' | 'title' | 'description' | 'visibility' | 'customFieldValues'> & {
  valueAmount?: string | null | undefined;
  valueCurrency?: string | null | undefined;
  startOn?: string | undefined;
  mergedIntoProjectId?: string | null | undefined;
};

/**
 * Every host refusal (`contracts/project-merge.md` §2): the same Project, a
 * missing one, an already merged one. Visibility and edit of both are the
 * route's and the start Command's (`404 PROJECT_NOT_FOUND`, indistinguishable
 * from absence), never a refusal here.
 */
export function projectMergeRefusals(
  survivor: MergeableProject | null,
  loser: MergeableProject | null,
  ids: { readonly survivorId: string; readonly loserId: string },
): RecordMergeNotice[] {
  if (ids.survivorId === ids.loserId) return [{ code: ERROR_CODES.RECORD_MERGE_SAME_RECORD }];
  const unavailable = (record: 'survivor' | 'loser', reason: string): RecordMergeNotice => ({
    code: ERROR_CODES.RECORD_MERGE_RECORD_UNAVAILABLE,
    details: { record, reason },
  });
  if (survivor === null) return [unavailable('survivor', 'missing')];
  if (loser === null) return [unavailable('loser', 'missing')];
  if (survivor.mergedIntoProjectId) return [unavailable('survivor', 'merged')];
  if (loser.mergedIntoProjectId) return [unavailable('loser', 'merged')];
  return [];
}

/** Is a value "empty" for the fill-gaps rule: absent, null, a blank string or an empty list. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** One offered field's value, as the preview shows it and the finalize applies it. */
export function fieldValue(project: MergeableProject, code: ProjectMergeFieldCode): unknown {
  switch (code) {
    case 'title':
      return project.title;
    case 'description':
      return project.description ?? '';
    case 'value':
      return project.valueAmount === null || project.valueAmount === undefined
        ? null
        : { amount: project.valueAmount, currency: project.valueCurrency ?? null };
    case 'startOn':
      return project.startOn ?? null;
    case 'visibility':
      return project.visibility;
  }
}

/**
 * The offered fields whose values differ. The survivor's wins by default; a
 * survivor field that is empty (a blank description, no value) takes the
 * loser's.
 */
export function fieldDifferences(survivor: MergeableProject, loser: MergeableProject): RecordMergeFieldDifference[] {
  const out: RecordMergeFieldDifference[] = [];
  for (const code of PROJECT_MERGE_FIELD_CODES) {
    const s = fieldValue(survivor, code);
    const l = fieldValue(loser, code);
    if (isDeepStrictEqual(s, l)) continue;
    out.push({ code, survivor: s, loser: l, default: isEmptyValue(s) && !isEmptyValue(l) ? 'loser' : 'survivor' });
  }
  return out;
}

/** The field choices the finalize applies: the operator's, else each differing field's default. */
export function effectiveFieldChoices(
  survivor: MergeableProject,
  loser: MergeableProject,
  chosen: Readonly<Partial<Record<string, RecordMergeChoice>>>,
): Partial<Record<ProjectMergeFieldCode, RecordMergeChoice>> {
  const out: Partial<Record<ProjectMergeFieldCode, RecordMergeChoice>> = {};
  for (const difference of fieldDifferences(survivor, loser)) {
    const code = difference.code as ProjectMergeFieldCode;
    out[code] = chosen[code] ?? difference.default;
  }
  return out;
}

/** The custom-field keys whose values differ, with the same default rule (FR-031). */
export function customFieldDifferences(
  survivor: MergeableProject,
  loser: MergeableProject,
): { key: string; survivor: unknown; loser: unknown; default: RecordMergeChoice }[] {
  const keys = [
    ...new Set([...Object.keys(survivor.customFieldValues ?? {}), ...Object.keys(loser.customFieldValues ?? {})]),
  ].sort();
  const out: { key: string; survivor: unknown; loser: unknown; default: RecordMergeChoice }[] = [];
  for (const key of keys) {
    const s = survivor.customFieldValues?.[key];
    const l = loser.customFieldValues?.[key];
    if (isDeepStrictEqual(s ?? null, l ?? null)) continue;
    out.push({ key, survivor: s ?? null, loser: l ?? null, default: isEmptyValue(s) && !isEmptyValue(l) ? 'loser' : 'survivor' });
  }
  return out;
}

/**
 * The survivor's custom-field bag after the merge (FR-031): per key the
 * survivor's value, an empty survivor value filled from the loser, and the
 * loser's where the operator chose it. Values are taken whole.
 */
export function resolvedCustomFieldValues(
  survivor: MergeableProject,
  loser: MergeableProject,
  chosen: Readonly<Record<string, RecordMergeChoice>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(survivor.customFieldValues ?? {}) };
  for (const difference of customFieldDifferences(survivor, loser)) {
    const choice = chosen[difference.key] ?? difference.default;
    if (choice === 'loser') out[difference.key] = difference.loser;
  }
  return out;
}

/** Sorted keys whose value differs between two bags. */
export function changedKeys(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !isDeepStrictEqual(before[key], after[key]))
    .sort();
}
