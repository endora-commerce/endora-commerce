import {
  ORGANIZATION_MERGE_PHASES,
  RECORD_MERGE_HOST_STRUCTURE_KEY,
  type OrganizationMergePreview,
  type RecordMergeStep,
  type RecordMergeRecord,
} from '@endora-commerce/contracts';

/**
 * Pure helpers of the merge screens (`specs/192-organization-merge/` T076):
 * what a refusal says, whether a merge may still be cancelled, and the steps
 * grouped by phase. No React here, so the rules are tested without a DOM.
 */

/** The admin translation lookup: `(scope, key, params)`; an unknown key answers `scope.key`. */
export type Translate = (scope: string, key: string, params?: Record<string, string | number>) => string;

/** The code the start is refused with while a present module cannot move its rows yet. */
export const PARTICIPATION_INCOMPLETE = 'RECORD_MERGE_PARTICIPATION_INCOMPLETE';

const resolved = (t: Translate, scope: string, key: string, params?: Record<string, string | number>): string | null => {
  const value = t(scope, key, params);
  return value === `${scope}.${key}` ? null : value;
};

/** A module's display name from its own bundle (`module.name`), else its id. */
export function moduleName(t: Translate, moduleId: string): string {
  return resolved(t, moduleId, 'module.name') ?? moduleId;
}

/**
 * A refusal's sentence, in the reader's language. The platform's codes live in
 * the `core` bundle, the host's in `organizations`, and a participant's in its
 * own module's bundle (`details.module`); a code no bundle knows shows as is.
 */
export function refusalMessage(t: Translate, refusal: { code: string; details?: Record<string, unknown> | undefined }): string {
  const details = refusal.details ?? {};
  const modules = Array.isArray(details['modules']) ? (details['modules'] as unknown[]).map(String) : [];
  const module = typeof details['module'] === 'string' ? details['module'] : null;
  const params: Record<string, string> = {
    modules: modules.map((id) => moduleName(t, id)).join(', '),
    module: module === null ? '' : moduleName(t, module),
  };
  const key = `errors.${refusal.code}`;
  const token = typeof details['code'] === 'string' ? details['code'] : null;
  const scopes = ['core', ...(module === null ? [] : [module]), 'organizations'];
  for (const scope of scopes) {
    if (token !== null) {
      const specific = resolved(t, scope, `${key}.${token}`, params);
      if (specific !== null) return specific;
    }
    const general = resolved(t, scope, key, params);
    if (general !== null) return general;
  }
  return refusal.code;
}

/** Detail values a notice sentence may name: strings and numbers only, never a list of ids. */
function noticeParams(details: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  }
  return out;
}

/**
 * A participant's preview warning or conflict, in words. Participants add codes
 * this screen was not built with, so the sentence is looked up generically:
 * `merge.<kind>.<CODE>` in the participant's own bundle, then in this module's
 * (which carries the sentences of the participants shipped with the platform),
 * then the other kind's, then `errors.<CODE>` in `core`; a code nobody translated shows as itself. The
 * template may name any string or number of `details` (`{count}`).
 */
export function noticeMessage(
  t: Translate,
  kind: 'warning' | 'conflict',
  moduleId: string,
  notice: { code: string; details?: Record<string, unknown> | undefined },
): string {
  const params = noticeParams(notice.details);
  // A participant may report one code as either kind; the other kind's sentence is the next best.
  const other = kind === 'warning' ? 'conflict' : 'warning';
  return (
    resolved(t, moduleId, `merge.${kind}.${notice.code}`, params) ??
    resolved(t, 'organizations', `merge.${kind}.${notice.code}`, params) ??
    resolved(t, moduleId, `merge.${other}.${notice.code}`, params) ??
    resolved(t, 'organizations', `merge.${other}.${notice.code}`, params) ??
    resolved(t, 'core', `errors.${notice.code}`, params) ??
    notice.code
  );
}

/**
 * A participant or a step, named for the operator: the module's own name, and its
 * participation key beside it when the key is not just the module's id (a module
 * may take part more than once). Works for modules this screen does not know.
 */
export function participantLabel(t: Translate, moduleId: string, key: string): string {
  const name = moduleName(t, moduleId);
  const plain = key === moduleId || key === moduleId.replaceAll('_', '-');
  return plain ? name : `${name} (${key})`;
}

/** May the operator start? Only a preview with no refusal. */
export function canStart(preview: OrganizationMergePreview | null): boolean {
  return preview !== null && preview.refusals.length === 0;
}

/** The modules the start waits for (`RECORD_MERGE_PARTICIPATION_INCOMPLETE`), from the preview. */
export function incompleteModules(preview: OrganizationMergePreview): readonly string[] {
  if (preview.incomplete.length > 0) return preview.incomplete;
  const refusal = preview.refusals.find((r) => r.code === PARTICIPATION_INCOMPLETE);
  const modules = refusal?.details?.['modules'];
  return Array.isArray(modules) ? modules.map(String) : [];
}

/** Rows that would follow the survivor, over every participant. */
export function totalMoving(preview: OrganizationMergePreview): number {
  return preview.participants.reduce(
    (sum, participant) => sum + Object.values(participant.counts).reduce((a, b) => a + b, 0),
    0,
  );
}

/**
 * Can this merge still be cancelled? Only while it runs or needs attention and
 * no step has started moving records — the rule the server applies, so the
 * button is not offered where it would be refused.
 */
export function isCancellable(merge: Pick<RecordMergeRecord, 'state' | 'steps'>): boolean {
  if (merge.state !== 'running' && merge.state !== 'needs_attention') return false;
  return merge.steps.every((step) => (step.state === 'pending' || step.state === 'deferred') && step.movedCount === 0);
}

export interface MergePhaseView {
  readonly phase: string;
  readonly steps: readonly RecordMergeStep[];
  /** `done` when every step is done or deferred; `failed` when one failed; `running` when one runs; else `pending`. */
  readonly state: 'pending' | 'running' | 'done' | 'failed';
}

/**
 * The steps in phase order, the host's own `finalize` last with no step of its
 * own: it is done when the merge completed. A phase with no step is left out,
 * except `finalize`.
 */
export function phasesOf(merge: Pick<RecordMergeRecord, 'state' | 'steps'>): MergePhaseView[] {
  const out: MergePhaseView[] = [];
  for (const phase of ORGANIZATION_MERGE_PHASES) {
    if (phase === 'finalize') {
      out.push({ phase, steps: [], state: merge.state === 'completed' ? 'done' : 'pending' });
      continue;
    }
    const steps = merge.steps.filter((step) => step.phase === phase);
    if (steps.length === 0) continue;
    const state = steps.some((s) => s.state === 'failed')
      ? 'failed'
      : steps.every((s) => s.state === 'done' || s.state === 'deferred')
        ? 'done'
        : steps.some((s) => s.state === 'running' || s.state === 'done')
          ? 'running'
          : 'pending';
    out.push({ phase, steps, state });
  }
  return out;
}

/** How far the merge is: finished steps (done or deferred) of all, finalize counted as one. */
export function progressOf(merge: Pick<RecordMergeRecord, 'state' | 'steps'>): { done: number; total: number } {
  const done = merge.steps.filter((s) => s.state === 'done' || s.state === 'deferred').length + (merge.state === 'completed' ? 1 : 0);
  return { done, total: merge.steps.length + 1 };
}

/** Whether a step is the host's own structure work rather than a module's. */
export function isHostStep(step: Pick<RecordMergeStep, 'key'>): boolean {
  return step.key === RECORD_MERGE_HOST_STRUCTURE_KEY;
}

/** A value of a field the operator chooses between, as one line of text; `null` when empty. */
export function fieldValueText(
  code: string,
  value: unknown,
  own: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (code === 'vatStatus' && typeof value === 'string') return own(`vatStatus.${value}`);
  if (code === 'registeredAddress' && typeof value === 'object') {
    const a = value as Record<string, unknown>;
    const parts = [a['street'], [a['postalCode'], a['city']].filter(Boolean).join(' '), a['country']]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (code === 'fulfilmentStrategy' && typeof value === 'object') {
    const f = value as { strategy?: unknown; warehouseOrder?: unknown };
    if (f.strategy === null || f.strategy === undefined) return null;
    const warehouses = Array.isArray(f.warehouseOrder) ? f.warehouseOrder.length : 0;
    return warehouses > 0
      ? own('merge.value.fulfilmentWithWarehouses', { strategy: String(f.strategy), count: warehouses })
      : String(f.strategy);
  }
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(', ') : null;
  if (typeof value === 'boolean') return own(value ? 'merge.value.yes' : 'merge.value.no');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
