import { describe, expect, it } from 'vitest';
import type { ProjectMergePreview, RecordMergeStep } from '@endora-commerce/contracts';
import {
  canStart,
  fieldValueText,
  isCancellable,
  noticeMessage,
  participantLabel,
  phasesOf,
  progressOf,
  refusalMessage,
  participantCounts,
  shownInPreview,
  totalMoving,
  type Translate,
} from './merge-view.js';

/** `specs/192-organization-merge/` US6, T087 — the Project merge screens' rules, without a DOM. */

const BUNDLES: Record<string, Record<string, string>> = {
  core: { 'errors.RECORD_MERGE_RECORD_UNAVAILABLE': 'Unavailable.' },
  projects: {
    'errors.PROJECT_MERGED': 'Merged.',
    'visibility.option.everyone': 'Everyone',
    'merge.value.valueWithCurrency': '{amount} {currency}',
    'merge.participation.project-records': 'comments',
  },
  tasks: { 'module.name': 'Tasks' },
};

const t: Translate = (scope, key, params) => {
  const template = BUNDLES[scope]?.[key];
  if (template === undefined) return `${scope}.${key}`;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));
};

const step = (overrides: Partial<RecordMergeStep>): RecordMergeStep => ({
  moduleId: 'tasks',
  key: 'project-tasks',
  phase: 'records',
  state: 'pending',
  movedCount: 0,
  deferredReason: null,
  lastErrorCode: null,
  trailing: false,
  ...overrides,
});

const preview = (overrides: Partial<ProjectMergePreview> = {}): ProjectMergePreview => ({
  refusals: [],
  fields: [],
  customFields: [],
  participants: [],
  incomplete: [],
  organizationsGainingAccess: [],
  ...overrides,
});

describe('Project merge view helpers', () => {
  it('words a refusal from the platform’s, the module’s or the host’s bundle, else shows its code', () => {
    expect(refusalMessage(t, { code: 'RECORD_MERGE_RECORD_UNAVAILABLE' })).toBe('Unavailable.');
    expect(refusalMessage(t, { code: 'PROJECT_MERGED' })).toBe('Merged.');
    expect(refusalMessage(t, { code: 'SOMETHING_NEW' })).toBe('SOMETHING_NEW');
  });

  it('names a participant by its module, with the module’s own words for the part when it has them, never by its key', () => {
    expect(participantLabel(t, 'tasks', 'project-tasks')).toBe('Tasks');
    expect(participantLabel(t, 'projects', 'project-records')).toBe('projects — comments');
    expect(participantLabel(t, 'tasks', 'tasks')).toBe('Tasks');
    expect(noticeMessage(t, 'warning', 'tasks', { code: 'X' })).toBe('X');
  });

  it('starts only with no refusal, and counts what moves', () => {
    expect(canStart(null)).toBe(false);
    expect(canStart(preview({ refusals: [{ code: 'RECORD_MERGE_SAME_RECORD' }] }))).toBe(false);
    const ready = preview({
      participants: [
        { moduleId: 'projects', key: 'project-records', phase: 'records', counts: { a: 2, b: 1 }, conflicts: [], warnings: [] },
        { moduleId: 'tasks', key: 'project-tasks', phase: 'records', counts: { c: 4 }, conflicts: [], warnings: [] },
      ],
    });
    expect(canStart(ready)).toBe(true);
    expect(totalMoving(ready)).toBe(7);
  });

  it('groups the steps by the Project merge’s phases, finalize last', () => {
    const merge = {
      state: 'running' as const,
      steps: [step({ moduleId: 'projects', key: 'host-structure', phase: 'structure', state: 'done' }), step({ state: 'running' })],
    };
    expect(phasesOf(merge).map((phase) => [phase.phase, phase.state])).toEqual([
      ['structure', 'done'],
      ['records', 'running'],
      ['finalize', 'pending'],
    ]);
    expect(progressOf(merge)).toEqual({ done: 1, total: 3 });
  });

  it('offers cancel only while no step has moved anything', () => {
    expect(isCancellable({ state: 'running', steps: [step({})] })).toBe(true);
    expect(isCancellable({ state: 'running', steps: [step({ movedCount: 1 })] })).toBe(false);
    expect(isCancellable({ state: 'completed', steps: [] })).toBe(false);
  });

  it('shows a Project value as one line of text', () => {
    const own = (key: string, params?: Record<string, string | number>) => t('projects', key, params);
    expect(fieldValueText('value', { amount: '1200.00', currency: 'PLN' }, own)).toBe('1200.00 PLN');
    expect(fieldValueText('visibility', 'everyone', own)).toBe('Everyone');
    expect(fieldValueText('description', '', own)).toBeNull();
    expect(fieldValueText('title', 'Tender', own)).toBe('Tender');
  });
});

describe('deleted records in the preview', () => {
  const participant = {
    moduleId: 'addresses',
    key: 'addresses',
    phase: 'addresses',
    counts: { 'Address.organizationId': 24 },
    deletedCounts: { 'Address.organizationId': 22 },
    conflicts: [],
    warnings: [],
  };

  it('counts what the operator still sees, and the deleted rows apart', () => {
    expect(participantCounts(participant)).toEqual({ visible: 2, deleted: 22 });
    expect(participantCounts({ ...participant, deletedCounts: undefined })).toEqual({ visible: 24, deleted: 0 });
  });

  it('leaves the deleted rows out of what the confirmation says moves', () => {
    expect(totalMoving(preview({ participants: [participant] }))).toBe(2);
  });
});

describe('which participants the preview lists', () => {
  const row = { moduleId: 'tasks', key: 'project-tasks', phase: 'records', counts: { 'Task.contextId': 0 }, conflicts: [], warnings: [] };

  it('lists one that moves something or has a notice, and leaves out the rest', () => {
    expect(shownInPreview(row)).toBe(false);
    expect(shownInPreview({ ...row, counts: { 'Task.contextId': 3 } })).toBe(true);
    expect(shownInPreview({ ...row, warnings: [{ code: 'W' }] })).toBe(true);
  });
});
