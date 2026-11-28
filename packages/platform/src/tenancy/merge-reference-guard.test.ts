import { afterEach, describe, expect, it } from 'vitest';
import type { EventArgs } from '@mikro-orm/core';
import { mergeFreezeState } from './merge-freeze.js';
import { MergeReferenceGuardSubscriber, assertMergeWritable, mergeReferenceGuard } from './merge-reference-guard.js';

/**
 * `specs/192-organization-merge/` FR-047 — the freeze over every declared
 * reference, not only `@OrgScoped` `organizationId`: a `@GlobalEntity` row, an
 * id array, a text key and a Project reference naming a frozen or archived
 * record are refused on the ORM flush, and a module's own SQL asks
 * {@link assertMergeWritable} first.
 */

const LOSER = '00000000-0000-4000-8000-000000047a01';
const SURVIVOR = '00000000-0000-4000-8000-000000047a02';
const MERGE = '00000000-0000-4000-8000-000000047a03';
const OTHER = '00000000-0000-4000-8000-000000047a04';

class Promotion {
  organizationId: string | null = null;
  name = 'p';
}
class Scope {
  allowedOrganizationIds: string[] = [];
}
class Counter {
  scopeKey = '';
}
class TaskRow {
  contextType = 'project';
  contextId = '';
}
class Log {
  organizationId: string | null = null;
}

function args(entity: object, changed?: Record<string, unknown>): EventArgs<object> {
  return {
    entity,
    meta: { className: entity.constructor.name },
    ...(changed ? { changeSet: { payload: changed } } : {}),
  } as unknown as EventArgs<object>;
}

describe('the merge reference guard', () => {
  const guard = new MergeReferenceGuardSubscriber();

  mergeReferenceGuard.use(() => [
    {
      host: 'organization',
      references: [
        { entity: 'Promotion', property: 'organizationId', disposition: 're_point' },
        { entity: 'Scope', property: 'allowedOrganizationIds', disposition: 'union' },
        { entity: 'Counter', property: 'scopeKey', disposition: 'sum' },
        { entity: 'Log', property: 'organizationId', disposition: 'kept' },
      ],
    },
    {
      host: 'project',
      references: [
        {
          entity: 'TaskRow',
          property: 'contextId',
          polymorphic: { discriminator: 'contextType', value: 'project' },
          disposition: 're_point',
        },
      ],
    },
  ]);

  afterEach(() => mergeFreezeState.clear());

  it('refuses a @GlobalEntity row created naming an archived Organization, with its survivor', async () => {
    mergeFreezeState.archive('organization', LOSER, MERGE, SURVIVOR);
    const row = Object.assign(new Promotion(), { organizationId: LOSER });
    await expect(guard.beforeCreate(args(row))).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_MERGED',
      details: { survivorId: SURVIVOR },
    });
    await expect(guard.beforeCreate(args(Object.assign(new Promotion(), { organizationId: OTHER })))).resolves.toBeUndefined();
  });

  it('refuses an id array and a text key holding a frozen Organization', async () => {
    mergeFreezeState.freeze('organization', LOSER, MERGE);
    await expect(
      guard.beforeCreate(args(Object.assign(new Scope(), { allowedOrganizationIds: [OTHER, LOSER] }))),
    ).rejects.toMatchObject({ code: 'RECORD_MERGE_IN_PROGRESS' });
    await expect(
      guard.beforeUpdate(args(Object.assign(new Counter(), { scopeKey: `${OTHER}:${LOSER}` }), { scopeKey: 'x' })),
    ).rejects.toMatchObject({ code: 'RECORD_MERGE_IN_PROGRESS' });
  });

  it('checks an update only for the reference it changes', async () => {
    mergeFreezeState.archive('organization', LOSER, MERGE, SURVIVOR);
    const row = Object.assign(new Promotion(), { organizationId: LOSER });
    await expect(guard.beforeUpdate(args(row, { name: 'renamed' }))).resolves.toBeUndefined();
    await expect(guard.beforeUpdate(args(row, { organizationId: LOSER }))).rejects.toMatchObject({ code: 'ORGANIZATION_MERGED' });
  });

  it('holds a polymorphic reference only when its discriminator names the host, and a Project as an Organization', async () => {
    mergeFreezeState.archive('project', LOSER, MERGE, SURVIVOR);
    await expect(guard.beforeCreate(args(Object.assign(new TaskRow(), { contextId: LOSER })))).rejects.toMatchObject({
      code: 'PROJECT_MERGED',
    });
    await expect(
      guard.beforeCreate(args(Object.assign(new TaskRow(), { contextType: 'order', contextId: LOSER }))),
    ).resolves.toBeUndefined();
  });

  it('leaves a kept reference alone: its rows are history of the archived record', async () => {
    mergeFreezeState.archive('organization', LOSER, MERGE, SURVIVOR);
    await expect(guard.beforeCreate(args(Object.assign(new Log(), { organizationId: LOSER })))).resolves.toBeUndefined();
  });

  it('assertMergeWritable refuses what the guard refuses, for a SQL write', () => {
    mergeFreezeState.archive('organization', LOSER, MERGE, SURVIVOR);
    expect(() => assertMergeWritable('organization', [OTHER, null, LOSER])).toThrow(
      expect.objectContaining({ code: 'ORGANIZATION_MERGED' }),
    );
    expect(() => assertMergeWritable('organization', OTHER)).not.toThrow();
    expect(() => assertMergeWritable('organization', null)).not.toThrow();
  });
});
