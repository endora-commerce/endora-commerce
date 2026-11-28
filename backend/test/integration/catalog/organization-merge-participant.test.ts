import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  expectOrganizationParticipantConforms,
  insertOrganizationPair,
} from '../../helpers/organization-merge-conformance.js';
import { CatalogMergeParticipant } from '../../../../packages/modules/catalog/src/backend/merge/organization-merge-participant.js';
import { replaceAllowedOrganization } from '../../../../packages/modules/catalog/src/backend/commands/product-merge-reassign.command.js';

/**
 * `specs/192-organization-merge/` T064 — the `catalog` participant of an
 * Organization merge over a real database: in product audience allow-lists,
 * global and per channel, the loser is replaced by the survivor (union),
 * through `catalog.product.merge_reassign`, held to `expectMergeParticipant`;
 * and the changed products are handed to the refresh after each batch
 * (FR-055).
 */
describe('Organization merge — the catalog participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const sql = <T = unknown>(statement: string, params: unknown[] = []): Promise<T> =>
    h.em().fork().getConnection().execute(statement, params) as Promise<T>;

  async function product(allowed: string[]): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "products" ("id","sku","slug","type","status","name","description","visibility","allowed_organization_ids","attribute_values","created_at","updated_at")
       values (?, ?, ?, 'simple', 'active', 'Merge product', null, ?, ?::jsonb, '{}'::jsonb, now(), now())`,
      [id, `MRG-${id.slice(0, 8)}`, `mrg-${id}`, allowed.length > 0 ? 'organization_restricted' : 'public', JSON.stringify(allowed)],
    );
    return id;
  }

  async function scope(productId: string, allowed: string[]): Promise<void> {
    const [channel] = await sql<Array<{ id: string }>>(`select "id" from "sales_channels" order by "created_at" limit 1`);
    await sql(
      `insert into "product_channel_scopes" ("product_id","sales_channel_id","visibility","allowed_organization_ids") values (?, ?, 'organization_restricted', ?::jsonb)`,
      [productId, channel!.id, JSON.stringify(allowed)],
    );
  }

  it('replaces the loser by the survivor without listing the survivor twice', () => {
    expect(replaceAllowedOrganization(['a', 'L', 'S'], 'L', 'S')).toEqual(['a', 'S']);
    expect(replaceAllowedOrganization(['L', 'b'], 'L', 'S')).toEqual(['S', 'b']);
  });

  it('unions the loser into the survivor in every allow-list and refreshes the changed products (conformance)', async () => {
    const ids = await insertOrganizationPair(h);
    const other = randomUUID();
    const refreshed = new Set<string>();
    const seeded: string[] = [];
    const outcome = await expectOrganizationParticipantConforms({
      h,
      moduleId: 'catalog',
      key: 'organization-audiences',
      ids,
      build: (commandBus: Pick<CommandBus, 'run'>) =>
        new CatalogMergeParticipant({
          emFactory: () => h.em(),
          commandBus,
          reindexProducts: async (productIds) => {
            for (const id of productIds) refreshed.add(id);
          },
        }),
      seed: async ({ survivorId, loserId }) => {
        seeded.push(await product([loserId]));
        seeded.push(await product([other, loserId, survivorId]));
        const withScope = await product([]);
        await scope(withScope, [loserId]);
        seeded.push(withScope);
        await product([survivorId]);
      },
      snapshot: async () => ({
        products: await sql(`select "id","allowed_organization_ids" from "products" where "id" = any(string_to_array(?, ',')::uuid[]) order by "id"`, [seeded.join(',')]),
        scopes: await sql(`select "product_id","allowed_organization_ids" from "product_channel_scopes" where "product_id" = any(string_to_array(?, ',')::uuid[]) order by "product_id"`, [seeded.join(',')]),
      }),
    });
    expect(outcome.moved).toBe(3);
    const rows = await sql<Array<{ allowed_organization_ids: string[] }>>(
      `select "allowed_organization_ids" from "products" where "id" = any(string_to_array(?, ',')::uuid[]) order by "sku"`,
      [seeded.slice(0, 2).join(',')],
    );
    expect(rows.map((row) => row.allowed_organization_ids).sort((a, b) => a.length - b.length)).toEqual([
      [ids.survivorId],
      [other, ids.survivorId],
    ]);
    expect([...refreshed].sort()).toEqual([...seeded].sort());
  });
});
