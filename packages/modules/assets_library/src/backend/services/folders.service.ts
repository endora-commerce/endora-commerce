// FoldersService — feature 013 / US2. Create, rename, move (with cycle
// detection), delete (with `ifNonEmpty` strategies). Folders are pure
// metadata; moving an asset between folders is a metadata-only update,
// never a physical file move.

import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type AssetFolder as AssetFolderDto } from '@endora-commerce/contracts';

import { HttpError } from '@endora-commerce/platform/http';
import { AssetFolder } from '../entities/asset-folder.entity.js';
import { Asset } from '../entities/asset.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { AssetReferenceRegistry } from './reference-registry.js';
import type { AssetVisibility } from './asset-visibility.js';
import { assetIdsAmong, idNotAmong } from './asset-id-sets.js';

export class FoldersService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly referenceRegistry: AssetReferenceRegistry,
    /**
     * Which assets the ambient caller may see
     * (`specs/166-asset-reference-visibility/` R-10): a folder's counts leave
     * out what the caller may not see, and a deleted folder moves those assets
     * to its parent rather than refusing over them or deleting them. An
     * unrestricted caller is hidden nothing, without a read.
     */
    private readonly visibility: Pick<AssetVisibility, 'hiddenAmong' | 'exclusionFor'>,
    private readonly auditLog?: AuditPort,
    private readonly loadRetentionDays: () => Promise<number> = async () => 30,
  ) {}

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'asset_folder',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  async listFolderTree(): Promise<AssetFolderDto[]> {
    const em = this.emFactory();
    const all = await em.find(AssetFolder, {}, { orderBy: { position: 'asc', id: 'asc' } });
    const childrenByParent = new Map<string | null, string[]>();
    for (const f of all) {
      const key = f.parentId ?? null;
      const list = childrenByParent.get(key) ?? [];
      list.push(f.id);
      childrenByParent.set(key, list);
    }
    return all.map((f) => ({
      id: f.id,
      parentId: f.parentId ?? null,
      name: f.name,
      position: f.position,
      childIds: childrenByParent.get(f.id) ?? [],
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  async createFolder(input: { parentId: string | null; name: string }): Promise<AssetFolderDto> {
    const em = this.emFactory();
    if (input.parentId) {
      const parent = await em.findOne(AssetFolder, { id: input.parentId });
      if (!parent) {
        throw new HttpError(
          404,
          ERROR_CODES.ASSET_FOLDER_NOT_FOUND,
          `Parent folder ${input.parentId} not found.`,
        );
      }
    }
    // Compute next position among siblings.
    const siblings = await em.find(AssetFolder, { parentId: input.parentId ?? null });
    const position = siblings.reduce((m, s) => Math.max(m, s.position + 1), 0);
    try {
      const f = em.create(AssetFolder, {
        parentId: input.parentId,
        name: input.name,
        position,
      });
      em.persist(f);
      this.#audit(em, 'asset_folder.create', f.id, null, { name: f.name, parentId: f.parentId });
      await em.flush();
      return this.toDto(f, []);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new HttpError(
          409,
          ERROR_CODES.ASSET_FOLDER_NAME_CONFLICT,
          `A folder named "${input.name}" already exists in this location.`,
          // Issue #86 — the name both bundle sentences quote.
          { name: input.name },
        );
      }
      throw e;
    }
  }

  async patchFolder(
    id: string,
    patch: { name?: string; parentId?: string | null; position?: number },
  ): Promise<AssetFolderDto> {
    const em = this.emFactory();
    const f = await em.findOne(AssetFolder, { id });
    if (!f) throw new HttpError(404, ERROR_CODES.ASSET_FOLDER_NOT_FOUND, `Folder ${id} not found.`);

    if (patch.parentId !== undefined && patch.parentId !== f.parentId) {
      // Cycle prevention: walk ancestors of the proposed parent.
      if (patch.parentId !== null) {
        if (patch.parentId === id) {
          throw new HttpError(
            422,
            ERROR_CODES.ASSET_FOLDER_CYCLE,
            'A folder cannot be its own parent.',
          );
        }
        const seen = new Set<string>([id]);
        let cursor: string | null = patch.parentId;
        while (cursor) {
          if (seen.has(cursor)) {
            throw new HttpError(
              422,
              ERROR_CODES.ASSET_FOLDER_CYCLE,
              'Cannot move a folder into its own subtree.',
            );
          }
          seen.add(cursor);
          const next: AssetFolder | null = await em.findOne(AssetFolder, { id: cursor });
          if (!next) break;
          cursor = next.parentId ?? null;
        }
      }
      f.parentId = patch.parentId;
    }
    if (patch.name !== undefined) f.name = patch.name;
    if (patch.position !== undefined) f.position = patch.position;

    this.#audit(em, 'asset_folder.update', f.id, null, { name: f.name, parentId: f.parentId });
    try {
      await em.flush();
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new HttpError(
          409,
          ERROR_CODES.ASSET_FOLDER_NAME_CONFLICT,
          `A folder named "${f.name}" already exists at the target location.`,
          { name: f.name },
        );
      }
      throw e;
    }
    const children = await em.find(AssetFolder, { parentId: f.id });
    return this.toDto(f, children.map((c) => c.id));
  }

  /**
   * Delete a folder (`contracts/admin-api.md` §1.1). The assets the caller may
   * not see — of the folder for `cancel` and `moveContentsToParent`, of the
   * subtree for `deleteRecursively` — are answered as if they were not there
   * and **re-homed** to the deleted folder's parent (the root when it has
   * none), in the same flush as the delete and its audit row, which names them
   * in `stateBefore.rehomedAssetIds` (`specs/166-asset-reference-visibility/`
   * R-10). For an unrestricted caller nothing is hidden, and every strategy
   * behaves as before — except that `deleteRecursively` now really refuses
   * over referenced assets (R-6, #535).
   */
  async deleteFolder(
    id: string,
    strategy: 'cancel' | 'moveContentsToParent' | 'deleteRecursively',
  ): Promise<{ deletedFolderId: string; softDeletedAssetIds?: string[] }> {
    const em = this.emFactory();
    const f = await em.findOne(AssetFolder, { id });
    if (!f) throw new HttpError(404, ERROR_CODES.ASSET_FOLDER_NOT_FOUND, `Folder ${id} not found.`);
    const parentId = f.parentId ?? null;
    // Persisted on `em` and committed only by the flush of the branch that
    // actually deletes (a refusal throws before any flush).
    const audit = (rehomedAssetIds: readonly string[]) =>
      this.#audit(em, 'asset_folder.delete', f.id, { name: f.name, strategy, rehomedAssetIds: [...rehomedAssetIds] }, null);

    if (strategy === 'deleteRecursively') {
      // Every asset of the subtree, soft-deleted ones included: a hidden one is
      // re-homed whatever its state, so the folder's removal never leaves it
      // somewhere the caller chose without knowing it.
      const subtree = await this.collectSubtreeAssets(em, id);
      const hidden = await this.visibility.hiddenAmong(subtree.map((a) => a.id));
      const rehomed = subtree.filter((a) => hidden.has(a.id));
      const toDelete = subtree.filter((a) => !hidden.has(a.id) && !a.deletedAt).map((a) => a.id);
      // References are checked for real, all-or-nothing, over what the caller
      // sees. A hidden asset is referenced by definition, and is re-homed.
      if (toDelete.length > 0) {
        const refs = await this.referenceRegistry.findReferencesMany(toDelete);
        const blocking = toDelete.filter((aid) => (refs.get(aid) ?? []).length > 0);
        if (blocking.length > 0) {
          throw new HttpError(
            409,
            ERROR_CODES.ASSET_REFERENCED,
            `Cannot delete folder: ${blocking.length} asset(s) in this subtree are still referenced.`,
            blocking.slice(0, 20).map((aid) => ({ path: 'assetId', issue: aid })),
          );
        }
      }
      const retentionDays = await this.loadRetentionDays();
      const now = new Date();
      const purgeAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
      for (const aid of toDelete) {
        const a = await em.findOneOrFail(Asset, { id: aid });
        a.deletedAt = now;
        a.purgeAfterAt = purgeAt;
      }
      for (const a of rehomed) a.folderId = parentId;
      const folders = await this.collectSubtreeFolders(em, id);
      for (const sub of folders) {
        em.remove(sub);
      }
      em.remove(f);
      audit(rehomed.map((a) => a.id));
      await em.flush();
      return { deletedFolderId: id, softDeletedAssetIds: toDelete };
    }

    const childFolders = await em.find(AssetFolder, { parentId: id });
    const directAssets = await em.find(Asset, { folderId: id });
    const hidden = await this.visibility.hiddenAmong(directAssets.map((a) => a.id));
    const rehomed = directAssets.filter((a) => hidden.has(a.id));

    if (strategy === 'moveContentsToParent') {
      // As before: every asset, hidden or not, goes to the parent.
      for (const cf of childFolders) cf.parentId = parentId;
      for (const a of directAssets) a.folderId = parentId;
      audit(rehomed.map((a) => a.id));
      await em.flush();
      em.remove(f);
      await em.flush();
      return { deletedFolderId: id };
    }

    // strategy === 'cancel': a folder whose only assets the caller may not see
    // is empty for them; the refusal counts what they see.
    const visibleCount = directAssets.length - rehomed.length;
    if (childFolders.length > 0 || visibleCount > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.ASSET_FOLDER_NOT_EMPTY,
        `Folder is not empty (${childFolders.length} sub-folder(s), ${visibleCount} asset(s)).`,
        // Issue #86 — the counts both bundle sentences name; visible-only,
        // like the message (`specs/166-asset-reference-visibility/` R-10).
        { subfolderCount: childFolders.length, assetCount: visibleCount },
      );
    }
    for (const a of rehomed) a.folderId = parentId;
    em.remove(f);
    audit(rehomed.map((a) => a.id));
    await em.flush();
    return { deletedFolderId: id };
  }

  /**
   * How many live assets in the folder's subtree, at any depth, have a
   * permalink — named by the folder delete confirmation (owner ruling S4,
   * specs/156-asset-stable-url/).
   */
  async countPermalinkedAssets(id: string): Promise<number> {
    const em = this.emFactory();
    const f = await em.findOne(AssetFolder, { id });
    if (!f) throw new HttpError(404, ERROR_CODES.ASSET_FOLDER_NOT_FOUND, `Folder ${id} not found.`);
    const folderIds = await this.collectSubtreeFolderIds(em, id);
    const where = { folderId: { $in: folderIds }, deletedAt: null, permalink: { $ne: null } };
    // A file the caller may not see is not counted
    // (`specs/166-asset-reference-visibility/` R-10): the list's exclusion,
    // scoped to the files this count could include.
    const hidden = await this.visibility.exclusionFor((candidates) => assetIdsAmong(em.fork(), where, candidates));
    return em.count(Asset, hidden.length > 0 ? { $and: [where, idNotAmong(hidden)] } : where);
  }

  private async collectSubtreeFolderIds(em: EntityManager, rootId: string): Promise<string[]> {
    const folderIds: string[] = [rootId];
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      const head = queue.shift()!;
      const children = await em.find(AssetFolder, { parentId: head });
      for (const c of children) {
        folderIds.push(c.id);
        queue.push(c.id);
      }
    }
    return folderIds;
  }

  /** Every asset of the subtree, soft-deleted ones included. */
  private async collectSubtreeAssets(em: EntityManager, rootId: string): Promise<Asset[]> {
    const folderIds = await this.collectSubtreeFolderIds(em, rootId);
    return em.find(Asset, { folderId: { $in: folderIds } });
  }

  private async collectSubtreeFolders(
    em: EntityManager,
    rootId: string,
  ): Promise<AssetFolder[]> {
    const acc: AssetFolder[] = [];
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      const head = queue.shift()!;
      if (head !== rootId) {
        const cur = await em.findOne(AssetFolder, { id: head });
        if (cur) acc.push(cur);
      }
      const children = await em.find(AssetFolder, { parentId: head });
      for (const c of children) queue.push(c.id);
    }
    return acc;
  }

  private toDto(f: AssetFolder, childIds: string[]): AssetFolderDto {
    return {
      id: f.id,
      parentId: f.parentId ?? null,
      name: f.name,
      position: f.position,
      childIds,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e !== null &&
    typeof e === 'object' &&
    (e as { constructor?: { name?: string } }).constructor?.name ===
      'UniqueConstraintViolationException'
  );
}
