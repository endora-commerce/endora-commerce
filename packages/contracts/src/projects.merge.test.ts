import { describe, expect, it } from 'vitest';
import {
  PROJECT_MERGE_EVENTS,
  PROJECT_MERGE_FIELD_CODES,
  PROJECT_WEBHOOK_EVENT_TYPES,
  projectMergeListQuerySchema,
  projectMergePreviewBodySchema,
  projectMergeStageMap,
  projectMergeStartBodySchema,
  projectMergeVersionBodySchema,
  projectMergeViewSchema,
} from './projects.merge.js';
import { ProjectDetailSchema } from './projects.js';
import { PROJECT_HOOKABLE_ACTIONS } from './project-hooks.js';

const uuid = '0b0e9f2c-4a3e-4c1e-9f55-3d0b0e9f2c4a';
const other = '1c1f0a3d-5b4f-4d2f-8a66-4e1c1f0a3d5b';

/** `specs/192-organization-merge/` US6, T081 — the Project host's shapes. */
describe('project merge contract', () => {
  it('offers the five Project values for choice and never the workflow (FR-090, contracts/project-merge.md §2)', () => {
    expect(PROJECT_MERGE_FIELD_CODES).toEqual(['title', 'description', 'value', 'startOn', 'visibility']);
    expect(PROJECT_MERGE_FIELD_CODES).not.toContain('state');
    expect(PROJECT_MERGE_FIELD_CODES).not.toContain('currentStageId');
  });

  it('reads the preview and the start bodies strictly; the acknowledgement is the route’s', () => {
    expect(projectMergePreviewBodySchema.parse({ loserId: uuid })).toEqual({ loserId: uuid });
    expect(() => projectMergePreviewBodySchema.parse({ loserId: uuid, extra: 1 })).toThrow();
    const start = projectMergeStartBodySchema.parse({
      loserId: uuid,
      fieldChoices: { title: 'loser' },
      customFieldChoices: { tier: 'survivor' },
    });
    expect(start).toEqual({ loserId: uuid, fieldChoices: { title: 'loser' }, customFieldChoices: { tier: 'survivor' } });
    expect(() => projectMergeStartBodySchema.parse({ loserId: uuid, fieldChoices: { state: 'loser' } })).toThrow();
    expect(projectMergeVersionBodySchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    expect(projectMergeListQuerySchema.parse({ state: 'needs_attention', projectId: uuid })).toEqual({
      state: 'needs_attention',
      projectId: uuid,
    });
  });

  it('answers a merge with both Projects’ labels beside their ids', () => {
    const view = projectMergeViewSchema.parse({
      id: uuid,
      hostType: 'project',
      survivorId: uuid,
      loserId: other,
      state: 'running',
      version: 1,
      source: null,
      actorKind: 'admin',
      actorAdminUserId: null,
      startedAt: '2026-11-25T10:00:00.000Z',
      completedAt: null,
      cancelledAt: null,
      needsAttentionAt: null,
      lastErrorCode: null,
      fieldChoices: {},
      customFieldChoices: {},
      steps: [],
      survivorName: 'PRJ-0001 Tender',
      loserName: null,
      actorName: null,
    });
    expect(view.survivorName).toBe('PRJ-0001 Tender');
  });

  it('publishes project.merged.v1 as the first Project webhook type (FR-054)', () => {
    expect(PROJECT_MERGE_EVENTS.MERGED).toBe('project.merged.v1');
    expect(PROJECT_WEBHOOK_EVENT_TYPES).toEqual(['project.merged.v1']);
  });

  it('makes the start hookable (FR-061)', () => {
    expect(PROJECT_HOOKABLE_ACTIONS.mergeStart.action).toBe('projects.project.merge.start');
  });

  it('carries the archive pointer on the Project detail, null on a live Project (FR-051, FR-052)', () => {
    const shape = ProjectDetailSchema.shape;
    expect(shape.mergedIntoProjectId.safeParse(null).success).toBe(true);
    expect(shape.mergedIntoProjectId.safeParse(uuid).success).toBe(true);
    expect(shape.mergedAt.safeParse('2026-11-25T10:00:00.000Z').success).toBe(true);
    expect(shape.mergeId.safeParse(null).success).toBe(true);
  });
});

describe('projectMergeStageMap', () => {
  it('reads the Stage map and the fallback Stage the structure phase wrote', () => {
    expect(projectMergeStageMap({ stageMap: { a: 'b', bad: 1 }, fallbackStageId: 'c' })).toEqual({
      stageMap: { a: 'b' },
      fallbackStageId: 'c',
    });
  });

  it('reads an absent or malformed context as no map and no fallback', () => {
    expect(projectMergeStageMap({})).toEqual({ stageMap: {}, fallbackStageId: null });
    expect(projectMergeStageMap({ stageMap: 'x', fallbackStageId: 3 })).toEqual({ stageMap: {}, fallbackStageId: null });
  });
});
