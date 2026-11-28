import { afterEach, describe, expect, it } from 'vitest';
import type { EventArgs } from '@mikro-orm/core';
import { recordMergeScopeReason } from '@endora-commerce/contracts';
import { HttpError } from '../http/error-envelope.js';
import { OrgScoped } from './org-scoped.decorator.js';
import { OrgWriteGuardSubscriber } from './org-write-guard.js';
import { mergeFreezeState } from './merge-freeze.js';
import { runWithTenantContext, type TenantContext } from './tenant-context.js';

/**
 * `specs/192-organization-merge/` T017 (R-6 seam 2, R-8): the org write guard
 * refuses a create or update of an `@OrgScoped` row naming a frozen
 * Organization — except inside that merge's own system scope — and refuses one
 * naming an archived Organization outright, with its survivor's id.
 */

const LOSER = '00000000-0000-4000-8000-0000000001a0';
const SURVIVOR = '00000000-0000-4000-8000-0000000001b0';
const MERGE = '00000000-0000-4000-8000-0000000001c0';
const OTHER_MERGE = '00000000-0000-4000-8000-0000000001d0';

@OrgScoped()
class MergeGuardedRow {
  organizationId!: string | null;
}

const all: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'merge-unit' } };
const system = (reason: string): TenantContext => ({ mode: 'system', actor: { kind: 'system' }, reason });
const eventFor = (entity: object): EventArgs<object> =>
  ({ entity, meta: { className: 'MergeGuardedRow' } }) as unknown as EventArgs<object>;
const row = (organizationId: string): MergeGuardedRow => Object.assign(new MergeGuardedRow(), { organizationId });

async function refusalOf(run: () => Promise<void>): Promise<HttpError> {
  try {
    await run();
  } catch (error) {
    return error as HttpError;
  }
  throw new Error('expected the guard to refuse');
}

describe('OrgWriteGuardSubscriber — the merge freeze', () => {
  const guard = new OrgWriteGuardSubscriber();
  afterEach(() => mergeFreezeState.clear());

  it('refuses a write naming a frozen Organization, for every actor outside the merge', async () => {
    mergeFreezeState.freeze('organization', LOSER, MERGE);
    for (const ctx of [all, system('some-worker'), system(recordMergeScopeReason(OTHER_MERGE))]) {
      const error = await refusalOf(() =>
        runWithTenantContext(ctx, () => guard.beforeCreate(eventFor(row(LOSER)))),
      );
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('RECORD_MERGE_IN_PROGRESS');
    }
    const update = await refusalOf(() => runWithTenantContext(all, () => guard.beforeUpdate(eventFor(row(LOSER)))));
    expect(update.code).toBe('RECORD_MERGE_IN_PROGRESS');
  });

  it("lets the merge's own steps write it", async () => {
    mergeFreezeState.freeze('organization', LOSER, MERGE);
    await runWithTenantContext(system(recordMergeScopeReason(MERGE)), async () => {
      await expect(guard.beforeCreate(eventFor(row(LOSER)))).resolves.toBeUndefined();
    });
  });

  it('leaves the survivor writable throughout', async () => {
    mergeFreezeState.freeze('organization', LOSER, MERGE);
    await runWithTenantContext(all, async () => {
      await expect(guard.beforeUpdate(eventFor(row(SURVIVOR)))).resolves.toBeUndefined();
    });
  });

  it('refuses a write naming an archived Organization with ORGANIZATION_MERGED and the survivor, even in the merge scope', async () => {
    mergeFreezeState.archive('organization', LOSER, MERGE, SURVIVOR);
    for (const ctx of [all, system(recordMergeScopeReason(MERGE))]) {
      const error = await refusalOf(() => runWithTenantContext(ctx, () => guard.beforeCreate(eventFor(row(LOSER)))));
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('ORGANIZATION_MERGED');
      expect(error.details).toMatchObject({ survivorId: SURVIVOR, mergeId: MERGE });
    }
  });

  it('lifts the refusal when the merge is cancelled', async () => {
    mergeFreezeState.freeze('organization', LOSER, MERGE);
    mergeFreezeState.unfreeze('organization', LOSER);
    await runWithTenantContext(all, async () => {
      await expect(guard.beforeCreate(eventFor(row(LOSER)))).resolves.toBeUndefined();
    });
  });
});
