import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { GalleryService } from './gallery.service.js';
import { Product } from '../entities/product.entity.js';
import { GalleryItem } from '../entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../entities/gallery-item-label.entity.js';

/**
 * Feature 163, checkpoint F (B-1, S-4) — the gallery's order is written inside the Command
 * `product.media.update` on the product: the positions are written on the Command's own `em`,
 * under the product row lock and in its transaction, and the one audit entry's `before` names
 * the order the write replaced. A write that changes nothing writes no audit entry. Feature 170
 * (`contracts/scoped-values-api.md` §6): an item's roles left the item PATCH for the
 * scoped-values save, so the PATCH is a position write (`gallery_item.update`).
 */

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const ITEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface Recorded {
  action: string;
  objectType: string;
  objectId: string | undefined;
  audited: boolean;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

function harness(labels: Array<{ item: string; label: string }> = []) {
  const items = new Map(
    [ITEM_A, ITEM_B].map((id, position) => [
      id,
      Object.assign(new GalleryItem(), {
        id,
        productId: PRODUCT,
        assetId: id,
        position,
        altText: {},
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    ]),
  );
  let labelRows = labels.map((l) => ({ galleryItemId: l.item, productId: PRODUCT, label: l.label }));
  let inCommand = false;
  const outside: string[] = [];
  const write = (sql: string): void => {
    if (!inCommand && /^\s*(insert|update|delete)/i.test(sql)) outside.push(sql.trim().split('\n')[0]!);
  };
  const em = {
    findOne: async (entity: unknown, where: { id: string }) => {
      if (entity === Product) return where.id === PRODUCT ? { id: PRODUCT } : null;
      if (entity === GalleryItem) return items.get(where.id) ?? null;
      return null;
    },
    find: async (entity: unknown, where: { galleryItemId?: string; productId?: string }) => {
      if (entity === GalleryItem) return [...items.values()].sort((a, b) => a.position - b.position);
      if (entity === GalleryItemLabel) {
        return labelRows.filter((l) =>
          where.galleryItemId !== undefined ? l.galleryItemId === where.galleryItemId : l.productId === where.productId,
        );
      }
      return [];
    },
    execute: async (sql: string, params: unknown[] = []) => {
      write(sql);
      if (/^\s*delete from gallery_item_labels where gallery_item_id = \?/i.test(sql)) {
        labelRows = labelRows.filter((l) => l.galleryItemId !== params[0]);
      } else if (/^\s*delete from gallery_item_labels/i.test(sql)) {
        const [, ...rest] = params as string[];
        const other = rest[rest.length - 1];
        const named = rest.slice(0, -1);
        labelRows = labelRows.filter((l) => !(named.includes(l.label) && l.galleryItemId !== other));
      } else if (/^\s*select label, gallery_item_id/i.test(sql)) {
        const [, ...rest] = params as string[];
        const other = rest[rest.length - 1];
        const named = rest.slice(0, -1);
        return labelRows
          .filter((l) => named.includes(l.label) && l.galleryItemId !== other)
          .map((l) => ({ label: l.label, gallery_item_id: l.galleryItemId }));
      } else if (/^\s*insert into gallery_item_labels/i.test(sql)) {
        for (let i = 0; i < params.length; i += 3) {
          const [galleryItemId, productId, label] = params.slice(i, i + 3) as string[];
          if (!labelRows.some((l) => l.galleryItemId === galleryItemId && l.label === label)) {
            labelRows.push({ galleryItemId: galleryItemId!, productId: productId!, label: label! });
          }
        }
      } else if (/^\s*update gallery_items set position/i.test(sql)) {
        items.get(params[1] as string)!.position = params[0] as number;
      }
      return [];
    },
    flush: async () => undefined,
    persist: () => undefined,
  };
  const recorded: Recorded[] = [];
  const commandBus = {
    run: async (command: Parameters<CommandBus['run']>[0]) => {
      inCommand = true;
      try {
        const outcome = await command.run({
          em: em as never,
          actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' } as never,
        });
        recorded.push({
          action: command.action,
          objectType: command.objectType,
          objectId: command.objectId,
          audited: outcome.skipAudit !== true,
          before: outcome.before ?? null,
          after: outcome.after ?? null,
        });
        return outcome.result;
      } finally {
        inCommand = false;
      }
    },
  } as unknown as CommandBus;
  const service = new GalleryService(() => em as unknown as EntityManager, commandBus);
  const labelsOf = (item: string) => labelRows.filter((l) => l.galleryItemId === item).map((l) => l.label).sort();
  return { service, recorded, outside, labelsOf, items };
}

describe('gallery order under the product.media.update Command (163 B-1, S-4)', () => {
  it('a PATCH carries the position only: one gallery_item.update entry, no label row written (feature 170, §6)', async () => {
    const h = harness([{ item: ITEM_A, label: 'base_image' }]);
    await h.service.update(PRODUCT, ITEM_B, { position: 3 });
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatchObject({ action: 'gallery_item.update', before: { position: 1 }, after: { position: 3 } });
    expect(h.labelsOf(ITEM_A)).toEqual(['base_image']);
    expect(h.outside).toEqual([]);
  });

  it('a reorder is one product.media.update entry with the order before and after, written inside it', async () => {
    const h = harness();
    await h.service.reorder(PRODUCT, [ITEM_B, ITEM_A]);
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatchObject({
      action: 'product.media.update',
      objectType: 'product',
      objectId: PRODUCT,
      audited: true,
      before: { orderedGalleryItemIds: [ITEM_A, ITEM_B] },
      after: { orderedGalleryItemIds: [ITEM_B, ITEM_A] },
    });
    expect(h.outside).toEqual([]);
    expect(h.items.get(ITEM_B)!.position).toBe(0);
  });

  it('a reorder to the order the gallery already has writes no audit entry', async () => {
    const h = harness();
    await h.service.reorder(PRODUCT, [ITEM_A, ITEM_B]);
    expect(h.recorded.filter((r) => r.audited)).toEqual([]);
  });
});
