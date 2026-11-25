import { describe, expect, it, vi } from 'vitest';
import { createTaskRecordOwners } from './record-owners.js';

const LOSER = '00000000-0000-4000-8000-000000192e21';
const SURVIVOR = '00000000-0000-4000-8000-000000192e22';
const OTHER = '00000000-0000-4000-8000-000000192e23';

/**
 * `specs/192-organization-merge/` US6, T086 (FR-093) — a Project merged into
 * another one is named, under the id the caller asked for, by its survivor,
 * so a mention of it renders as the survivor and leads to it.
 */
describe('createTaskRecordOwners — a merged Project', () => {
  it('answers the survivor’s label under the asked id, and reads each survivor once', async () => {
    const findByIds = vi.fn(async (ids: readonly string[]) =>
      ids.filter((id) => id === SURVIVOR || id === OTHER).map((id) => ({ id, number: id === SURVIVOR ? 'PRJ-2' : 'PRJ-3', title: 'T' })),
    );
    const owners = createTaskRecordOwners({
      quoteRequests: {} as never,
      opportunities: {} as never,
      projects: {
        findByIds: findByIds as never,
        resolveMerged: vi.fn(async (id: string) => (id === LOSER ? SURVIVOR : id)),
      } as never,
    });
    const labels = await owners.labels('project', [LOSER, OTHER, SURVIVOR]);
    expect(labels.get(LOSER)).toEqual({ id: SURVIVOR, label: 'PRJ-2', sublabel: 'T' });
    expect(labels.get(OTHER)).toEqual({ id: OTHER, label: 'PRJ-3', sublabel: 'T' });
    expect(labels.get(SURVIVOR)).toEqual({ id: SURVIVOR, label: 'PRJ-2', sublabel: 'T' });
    expect(findByIds).toHaveBeenCalledWith([SURVIVOR, OTHER]);
  });
});
