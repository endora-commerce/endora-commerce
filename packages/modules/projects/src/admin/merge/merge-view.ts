import {
  PROJECT_MERGE_PHASES,
  RECORD_MERGE_HOST_STRUCTURE_KEY,
  type ProjectMergePreview,
  type RecordMergeRecord,
  type RecordMergeStep,
} from '@endora-commerce/contracts';

/**
 * Pure helpers of the Project merge screens (`specs/192-organization-merge/`
 * US6, T087): what a refusal says, whether a merge may still be cancelled, and
 * the steps grouped by phase. The Organization merge's screens have their own
 * (`organizations/src/admin/merge/merge-view.ts`) — the rules are the
 * platform's, the wording each host's. No React here, so the rules are tested
 * without a DOM.
 */

/** The admin translation lookup: `(scope, key, params)`; an unknown key answers `scope.key`. */
export type Translate = (scope: string, key: string, params?: Record<string, string | number>) => string;

const HOST = 'projects';

const resolved = (t: Translate, scope: string, key: string, params?: Record<string, string | number>): string | null => {
  const value = t(scope, key, params);
  return value === `${scope}.${key}` ? null : value;
};

/** A module's display name from its own bundle (`module.name`), else its id. */
export function moduleName(t: Translate, moduleId: string): string {
  return resolved(t, moduleId, 'module.name') ?? moduleId;
}

/**
 * A refusal's sentence, in the reader's language: the platform's codes in the
 * `core` bundle, a participant's in its own module's (`details.module`), the
 * host's in `projects`; a code no bundle knows shows as is.
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
  for (const scope of ['core', ...(module === null ? [] : [module]), HOST]) {
    const sentence = resolved(t, scope, key, params);
    if (sentence !== null) return sentence;
  }
  return refusal.code;
}

/** A participant's preview warning or conflict, looked up in its own bundle, then the host's; else its code. */
export function noticeMessage(
  t: Translate,
  kind: 'warning' | 'conflict',
  moduleId: string,
  notice: { code: string; details?: Record<string, unknown> | undefined },
): string {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(notice.details ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') params[key] = value;
  }
  return (
    resolved(t, moduleId, `merge.${kind}.${notice.code}`, params) ??
    resolved(t, HOST, `merge.${kind}.${notice.code}`, params) ??
    resolved(t, 'core', `errors.${notice.code}`, params) ??
    notice.code
  );
}

/** A participant or a step, named by its module, with its key beside it when the key says more. */
export function participantLabel(t: Translate, moduleId: string, key: string): string {
  const name = moduleName(t, moduleId);
  const plain = key === moduleId || key === moduleId.replaceAll('_', '-');
  return plain ? name : `${name} (${key})`;
}

/** May the operator start? Only a preview with no refusal. */
export function canStart(preview: ProjectMergePreview | null): boolean {
  return preview !== null && preview.refusals.length === 0;
}

/** Rows that would follow the survivor, over every participant. */
export function totalMoving(preview: ProjectMergePreview): number {
  return preview.participants.reduce(
    (sum, participant) => sum + Object.values(participant.counts).reduce((a, b) => a + b, 0),
    0,
  );
}

/** Can this merge still be cancelled? The server's rule: running or needing attention, and nothing moved yet. */
export function isCancellable(merge: Pick<RecordMergeRecord, 'state' | 'steps'>): boolean {
  if (merge.state !== 'running' && merge.state !== 'needs_attention') return false;
  return merge.steps.every((step) => (step.state === 'pending' || step.state === 'deferred') && step.movedCount === 0);
}

export interface MergePhaseView {
  readonly phase: string;
  readonly steps: readonly RecordMergeStep[];
  readonly state: 'pending' | 'running' | 'done' | 'failed';
}

/** The steps in the Project merge's phase order, the host's `finalize` last (done when the merge completed). */
export function phasesOf(merge: Pick<RecordMergeRecord, 'state' | 'steps'>): MergePhaseView[] {
  const out: MergePhaseView[] = [];
  for (const phase of PROJECT_MERGE_PHASES) {
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

/** A Project value the operator chooses between, as one line of text; `null` when empty. */
export function fieldValueText(
  code: string,
  value: unknown,
  own: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (code === 'visibility' && typeof value === 'string') return own(`visibility.option.${value}`);
  if (code === 'value' && typeof value === 'object') {
    const v = value as { amount?: unknown; currency?: unknown };
    if (v.amount === null || v.amount === undefined) return null;
    return own('merge.value.valueWithCurrency', { amount: String(v.amount), currency: String(v.currency ?? '') });
  }
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(', ') : null;
  if (typeof value === 'boolean') return own(value ? 'merge.value.yes' : 'merge.value.no');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
