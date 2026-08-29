import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CreditLimitReadPort } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { OrganizationInheritanceService } from '../../../../packages/modules/organizations/src/backend/services/organization-inheritance-service.js';
import type { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';

/**
 * `creditOwner` asks `credit_limits` which organisations hold a limit — it does
 * not select from that module's table (feature 077, D-87; the `organizations`
 * boundary shard).
 *
 * The read used to be
 * `select "organization_id" from "credit_limits" where "organization_id" in (…)`,
 * which names no import specifier, so the boundary it crossed compiled and
 * returned rows with nothing gating it. The three things asserted here are the
 * three the statement could not give: the question goes to the owner, the
 * answer is a set of plain ids and not that module's rows, and an absent owner
 * **refuses** instead of reporting "nobody in this chain has a limit" — which
 * on a credit-check path is the difference between a 503 and unlimited credit.
 */

const HEAD = '00000000-0000-4000-8000-0000000000a1';
const MID = '00000000-0000-4000-8000-0000000000a2';
const LEAF = '00000000-0000-4000-8000-0000000000a3';

/** A tree whose ancestor walk is fixed, so the assertions are about the port. */
function treeOf(ancestors: readonly string[]): OrganizationTreeService {
  return {
    ancestorIds: async (): Promise<string[]> => [...ancestors],
  } as unknown as OrganizationTreeService;
}

/**
 * The mode read is this module's own table and stays raw SQL; the stub answers
 * it so the assertions below are about the credit-limit question alone.
 */
function emOf(mode: string | null): () => EntityManager {
  return () =>
    ({
      getConnection: () => ({
        execute: async (): Promise<Array<{ credit_inheritance_mode: string | null }>> => [
          { credit_inheritance_mode: mode },
        ],
      }),
    }) as unknown as EntityManager;
}

describe('OrganizationInheritanceService.creditOwner (feature 077, D-87)', () => {
  it('asks the owner about the whole chain, nearest-first, and takes the nearest hit', async () => {
    const asked: Array<readonly string[]> = [];
    const creditLimits: CreditLimitReadPort = {
      organizationsWithLimit: async (ids) => {
        asked.push(ids);
        // Both ancestors hold one; the nearest must win.
        return [HEAD, MID];
      },
    };

    const service = new OrganizationInheritanceService(
      emOf('independent_default'),
      treeOf([MID, HEAD]),
      creditLimits,
    );

    const owner = await service.creditOwner(LEAF);

    expect(asked).toHaveLength(1);
    expect([...asked[0]!]).toEqual([LEAF, MID, HEAD]);
    expect(owner.ownerOrgId).toBe(MID);
    expect(owner.mode).toBe('independent_default');
  });

  it('reads the answer as plain ids, so no row of the owner’s can be handed back', async () => {
    const creditLimits: CreditLimitReadPort = {
      organizationsWithLimit: async () => [LEAF],
    };
    const service = new OrganizationInheritanceService(
      emOf(null),
      treeOf([]),
      creditLimits,
      async () => 'shared_pool',
    );

    const owner = await service.creditOwner(LEAF);

    expect(owner.ownerOrgId).toBe(LEAF);
    // The port's contract is a set of ids. A provider that handed back its
    // managed `CreditLimit` rows would be structurally assignable to nothing
    // here, and this is the assertion that says so out loud.
    expect(typeof owner.ownerOrgId).toBe('string');
  });

  it('falls back to the global mode when nobody in the chain holds a limit', async () => {
    const creditLimits: CreditLimitReadPort = {
      organizationsWithLimit: async () => [],
    };
    const service = new OrganizationInheritanceService(
      emOf('independent_default'),
      treeOf([HEAD]),
      creditLimits,
      async () => 'shared_pool',
    );

    expect(await service.creditOwner(LEAF)).toEqual({
      ownerOrgId: null,
      mode: 'shared_pool',
    });
  });

  it('fails closed when `credit_limits` is absent — no catch turns the refusal into "no limit"', async () => {
    const creditLimits: CreditLimitReadPort = {
      organizationsWithLimit: async () => {
        throw new ModuleDisabledError('credit_limits');
      },
    };
    const service = new OrganizationInheritanceService(
      emOf('shared_pool'),
      treeOf([HEAD]),
      creditLimits,
    );

    await expect(service.creditOwner(LEAF)).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
