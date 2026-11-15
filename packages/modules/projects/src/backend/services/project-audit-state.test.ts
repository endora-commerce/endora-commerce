import { describe, expect, it } from 'vitest';
import { Project } from '../entities/project.entity.js';
import { ProjectStage } from '../entities/project-stage.entity.js';
import { ProjectStageTask } from '../entities/project-stage-task.entity.js';
import {
  PROJECTS_AUDIT_KEYS,
  projectSnapshot,
  recordChildValueChange,
  stageSnapshot,
  taskDefinitionSnapshot,
} from './project-audit-state.js';

/**
 * `PROJECTS_AUDIT_KEYS` is the allowlist of `specs/conventions/audit-state.md`
 * §6 (D-288, issue #1226) for Projects: a key a `projects.project.*` audit
 * state may carry. The snapshots are held to it here; every Command's recorded
 * state is held to it by `backend/test/integration/projects/audit-sentinels.test.ts`.
 */

function project(): Project {
  return Object.assign(new Project(), {
    number: 'PRJ-000001',
    title: 'S1226-TITLE',
    description: 'S1226-DESC',
    state: 'open',
    startOn: '2026-11-15',
    visibility: 'inherit',
    valueAmount: '470470.47',
    valueCurrency: 'PLN',
    version: 3,
  });
}

function stage(): ProjectStage {
  return Object.assign(new ProjectStage(), {
    id: '00000000-0000-4000-8000-000000001226',
    projectId: '00000000-0000-4000-8000-000000001227',
    name: 'S1226-STAGE',
    color: '#3b82f6',
    position: 2,
    plannedDurationDays: 5,
    responsibleRoleIds: [],
    alertOffsetsDays: [1],
    completionGate: false,
    completionPermitted: true,
    deadlineOn: null,
    deadlineManual: false,
  });
}

function task(): ProjectStageTask {
  return Object.assign(new ProjectStageTask(), {
    stageId: '00000000-0000-4000-8000-000000001226',
    title: 'S1226-TASK',
    description: 'S1226-TASK-DESC',
    responsibleRoleId: null,
    dueOffsetDays: 2,
    position: 1,
  });
}

/** Enough of an EntityManager to see the rows `recordChildValueChange` creates. */
function recordingEm() {
  const created: Array<Record<string, unknown>> = [];
  const em = {
    create: (_entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `row-${created.length + 1}`, ...data };
      created.push(row);
      return row;
    },
  };
  return { em: em as never, created };
}

describe('PROJECTS_AUDIT_KEYS', () => {
  it('holds every key of the Project, Stage and Stage-task snapshots', () => {
    for (const snapshot of [projectSnapshot(project()), stageSnapshot(stage()), taskDefinitionSnapshot(task())]) {
      expect(Object.keys(snapshot).filter((key) => !PROJECTS_AUDIT_KEYS.has(key))).toEqual([]);
    }
  });

  it('holds none of the free text a Project, a Stage, a task or a file carries', () => {
    for (const key of ['title', 'description', 'name', 'stageName', 'stages', 'fileName', 'body', 'lossComment', 'valueAmount']) {
      expect(PROJECTS_AUDIT_KEYS.has(key), key).toBe(false);
    }
  });

  it('names a Stage and a task by id and position, never by their text', () => {
    expect(JSON.stringify([stageSnapshot(stage()), taskDefinitionSnapshot(task())])).not.toContain('S1226');
    expect(taskDefinitionSnapshot(task())).toMatchObject({ position: 1, descriptionLength: 'S1226-TASK-DESC'.length });
    expect(stageSnapshot(stage())).toMatchObject({ stageId: stage().id, position: 2 });
    expect(JSON.stringify(projectSnapshot(project()))).not.toMatch(/S1226|470470/);
  });
});

describe('recordChildValueChange', () => {
  it('names what changed, sorted, and keeps only that in the row', () => {
    const { em, created } = recordingEm();
    const keys = recordChildValueChange(em, 'project', {
      before: { name: 'Old', fileName: 'same.pdf' },
      after: { name: 'New', fileName: 'same.pdf' },
    });
    expect(keys).toEqual({ changedFields: ['name'], valueChangeId: 'row-1' });
    expect(created).toEqual([{ id: 'row-1', projectId: 'project', before: { name: 'Old' }, after: { name: 'New' } }]);
  });

  it('writes nothing and names nothing when no value changed', () => {
    const { em, created } = recordingEm();
    expect(recordChildValueChange(em, 'project', { before: { name: 'A' }, after: { name: 'A' } })).toEqual({});
    expect(
      recordChildValueChange(em, 'project', { before: { taskTitles: ['a', 'b'] }, after: { taskTitles: ['a', 'b'] } }),
    ).toEqual({});
    expect(created).toEqual([]);
  });

  it('stores no side before something that only arrived, and an empty side after something that went', () => {
    const { em, created } = recordingEm();
    expect(recordChildValueChange(em, 'project', { before: null, after: { name: 'Snagging' } })).toEqual({
      changedFields: ['name'],
      valueChangeId: 'row-1',
    });
    expect(recordChildValueChange(em, 'project', { before: { name: 'Snagging' }, after: null })).toEqual({
      changedFields: ['name'],
      valueChangeId: 'row-2',
    });
    expect(created).toEqual([
      { id: 'row-1', projectId: 'project', before: null, after: { name: 'Snagging' } },
      // `project_value_changes.after` is not null: what went keeps an empty side.
      { id: 'row-2', projectId: 'project', before: { name: 'Snagging' }, after: {} },
    ]);
  });

  it('compares a list as a whole', () => {
    const { em, created } = recordingEm();
    expect(
      recordChildValueChange(em, 'project', { before: { taskTitles: ['a', 'b'] }, after: { taskTitles: ['a', 'c'] } }),
    ).toEqual({ changedFields: ['taskTitles'], valueChangeId: 'row-1' });
    expect(created[0]).toMatchObject({ before: { taskTitles: ['a', 'b'] }, after: { taskTitles: ['a', 'c'] } });
  });
});
