import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type MegamenuDetail,
  type MegamenuItem,
  type PutItemsRequest,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { MegamenuCache } from './megamenu-cache.js';
import { MegamenuService } from './megamenu-service.js';
import { validateTarget, type TargetValidatorDeps } from './target-validator.js';

const SOFT_DEPTH_WARN_AT = 4;

type NormalisedItem = MegamenuItem & {
  /** Persisted id (server-assigned when missing). */
  id: string;
  parentId: string | null;
  /** Final 0..N-1 position per (megamenu, parentId). */
  position: number;
  depth: number;
};

export interface SetTreeWarning {
  code: 'MEGAMENU_DEPTH_EXCEEDED';
  message: string;
}

export interface SetTreeResult {
  detail: MegamenuDetail;
  warnings: SetTreeWarning[];
}

/**
 * Tree mutations for a Megamenu — feature 015 / T026. Full-overwrite per
 * save (per `research.md` § R4): the request supplies the desired tree
 * and the service rewrites `megamenu_items` for the menu in one
 * transaction. Per-kind targets are validated through the cross-module
 * ports so the unit test can stub them.
 */
export class MegamenuItemService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly menuService: MegamenuService,
    private readonly validatorDeps: TargetValidatorDeps,
    private readonly cache?: MegamenuCache,
  ) {}

  async setTree(menuId: string, body: PutItemsRequest): Promise<SetTreeResult> {
    const em = this.emFactory();
    const menuRow = await this.menuService.findRow(menuId);
    if (!menuRow) throw new HttpError(404, ERROR_CODES.MEGAMENU_NOT_FOUND, 'Megamenu not found.');
    if (body.version !== menuRow.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Megamenu was updated concurrently.');
    }

    const normalised = this.normalise(body.items);
    const warnings: SetTreeWarning[] = [];
    if (normalised.some((item) => item.depth > SOFT_DEPTH_WARN_AT)) {
      warnings.push({
        code: 'MEGAMENU_DEPTH_EXCEEDED',
        message: `Tree contains items deeper than level ${SOFT_DEPTH_WARN_AT}.`,
      });
    }

    // Cross-module target validation — Channel scope is the union of
    // every binding's channel. v1 enforces existence only; full
    // out-of-scope refusal lands in US3.
    const channelIds = await this.fetchChannelIdsForMenu(menuId);
    for (const item of normalised) {
      await validateTarget(item, channelIds, this.validatorDeps);
    }

    await em.transactional(async (tx) => {
      await tx.getConnection().execute(
        `delete from megamenu_items where megamenu_id = ?`,
        [menuId],
      );
      for (const item of normalised) {
        const now = new Date();
        await tx.getConnection().execute(
          `insert into megamenu_items
             (id, megamenu_id, parent_id, position, kind, labels, descriptions, target, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?)`,
          [
            item.id,
            menuId,
            item.parentId,
            item.position,
            item.kind,
            JSON.stringify(item.labels),
            JSON.stringify(item.descriptions ?? null),
            JSON.stringify(item.target),
            now,
            now,
          ],
        );
      }
      await tx.getConnection().execute(
        `update megamenus set version = version + 1, updated_at = now() where id = ?`,
        [menuId],
      );
    });

    if (this.cache) await this.cache.invalidateAll();
    const detail = await this.menuService.get(menuId);
    return { detail, warnings };
  }

  /**
   * Normalises the request tree:
   *  - assigns server ids to items missing one;
   *  - validates every parentId either references an item also present in
   *    the payload or is null (top-level);
   *  - sorts siblings by their input position and rewrites position 0..N-1;
   *  - computes depth per node so the soft-warning check stays cheap.
   */
  private normalise(items: MegamenuItem[]): NormalisedItem[] {
    const seenIds = new Set<string>();
    const expanded: NormalisedItem[] = items.map((item) => {
      const id = item.id ?? randomUUID();
      if (seenIds.has(id)) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `Duplicate item id "${id}".`);
      }
      seenIds.add(id);
      return {
        ...item,
        id,
        parentId: item.parentId ?? null,
        position: item.position,
        depth: 0,
      };
    });

    // Validate parentId references.
    for (const item of expanded) {
      if (item.parentId !== null && !seenIds.has(item.parentId)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Item ${item.id} references parentId ${item.parentId} which is not in the payload.`,
        );
      }
    }

    // Sort by parent + supplied position, then rewrite to 0..N-1.
    const byParent = new Map<string | null, NormalisedItem[]>();
    for (const item of expanded) {
      const list = byParent.get(item.parentId) ?? [];
      list.push(item);
      byParent.set(item.parentId, list);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.position - b.position);
      list.forEach((item, idx) => {
        item.position = idx;
      });
    }

    // Compute depth via BFS from roots.
    const childrenIndex = byParent;
    const queue: Array<{ id: string; depth: number }> = [];
    for (const root of childrenIndex.get(null) ?? []) {
      root.depth = 1;
      queue.push({ id: root.id, depth: 1 });
    }
    while (queue.length > 0) {
      const head = queue.shift()!;
      const children = childrenIndex.get(head.id) ?? [];
      for (const child of children) {
        child.depth = head.depth + 1;
        queue.push({ id: child.id, depth: child.depth });
      }
    }

    // Detect cycles / orphans — every item should have its depth set.
    for (const item of expanded) {
      if (item.depth === 0) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Item ${item.id} forms an orphan or cycle (no path to root).`,
        );
      }
    }

    return expanded;
  }

  private async fetchChannelIdsForMenu(menuId: string): Promise<string[]> {
    const rows = (await this.emFactory().getConnection().execute(
      `select distinct sales_channel_id::text as channel_id
         from megamenu_bindings where megamenu_id = ?`,
      [menuId],
    )) as Array<{ channel_id: string }>;
    return rows.map((r) => r.channel_id);
  }
}
