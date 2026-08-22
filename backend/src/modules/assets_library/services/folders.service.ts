// FoldersService — feature 013 / US2. Create, rename, move (with cycle
// detection), delete (with `ifNonEmpty` strategies). Folders are pure
// metadata; moving an asset between folders is a metadata-only update,
// never a physical file move.

import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type AssetFolder as AssetFolderDto } from '@b2b/contracts';

import { HttpError } from '../../../http/error-envelope.js';
import { AssetFolder } from '../entities/asset-folder.entity.js';
import { Asset } from '../entities/asset.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import type { AssetReferenceRegistry } from './reference-registry.js';

export class FoldersService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly referenceRegistry: AssetReferenceRegistry,
    private readonly auditLog?: AuditPort,
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
          `A folder with this name already exists at the target location.`,
        );
      }
      throw e;
    }
    const children = await em.find(AssetFolder, { parentId: f.id });
    return this.toDto(f, children.map((c) => c.id));
  }

  async deleteFolder(
    id: string,
    strategy: 'cancel' | 'moveContentsToParent' | 'deleteRecursively',
  ): Promise<{ deletedFolderId: string; softDeletedAssetIds?: string[] }> {
    const em = this.emFactory();
    const f = await em.findOne(AssetFolder, { id });
    if (!f) throw new HttpError(404, ERROR_CODES.ASSET_FOLDER_NOT_FOUND, `Folder ${id} not found.`);
    // Audit persists on `em`; only committed by the flush in whichever strategy
    // branch actually deletes (a `cancel`/refs-blocked path throws before flush).
    this.#audit(em, 'asset_folder.delete', f.id, { name: f.name, strategy }, null);

    const childFolders = await em.find(AssetFolder, { parentId: id });
    const directAssets = await em.find(Asset, { folderId: id });

    if (strategy === 'cancel' && (childFolders.length > 0 || directAssets.length > 0)) {
      throw new HttpError(
        409,
        ERROR_CODES.ASSET_FOLDER_NOT_EMPTY,
        `Folder is not empty (${childFolders.length} sub-folder(s), ${directAssets.length} asset(s)).`,
      );
    }

    if (strategy === 'moveContentsToParent') {
      for (const cf of childFolders) cf.parentId = f.parentId ?? null;
      for (const a of directAssets) a.folderId = f.parentId ?? null;
      await em.flush();
      em.remove(f);
      await em.flush();
      return { deletedFolderId: id };
    }

    if (strategy === 'deleteRecursively') {
      // Walk the subtree, gather every asset id, check refs all-or-nothing.
      const subtreeIds = await this.collectSubtreeAssetIds(em, id);
      if (subtreeIds.length > 0) {
        const refs = await this.referenceRegistry.findReferencesMany(subtreeIds);
        const blocking: string[] = [];
        for (const [aid, list] of refs.entries()) {
          if (list.length > 0) blocking.push(aid);
        }
        if (blocking.length > 0) {
          throw new HttpError(
            409,
            ERROR_CODES.ASSET_REFERENCED,
            `Cannot delete folder: ${blocking.length} asset(s) in this subtree are still referenced.`,
            blocking.slice(0, 20).map((aid) => ({ path: 'assetId', issue: aid })),
          );
        }
      }
      // Soft-delete all assets in subtree.
      const now = new Date();
      const retentionDays = 30;
      const purgeAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
      for (const aid of subtreeIds) {
        const a = await em.findOneOrFail(Asset, { id: aid });
        a.deletedAt = now;
        a.purgeAfterAt = purgeAt;
      }
      // Delete sub-folders bottom-up by setting parent_id NULL on every
      // intermediate, then removing.
      const folders = await this.collectSubtreeFolders(em, id);
      for (const sub of folders) {
        em.remove(sub);
      }
      em.remove(f);
      await em.flush();
      return { deletedFolderId: id, softDeletedAssetIds: subtreeIds };
    }

    // strategy === 'cancel' and folder is empty — straight delete.
    em.remove(f);
    await em.flush();
    return { deletedFolderId: id };
  }

  private async collectSubtreeAssetIds(
    em: EntityManager,
    rootId: string,
  ): Promise<string[]> {
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
    const assets = await em.find(
      Asset,
      { folderId: { $in: folderIds }, deletedAt: null },
      { fields: ['id'] },
    );
    return assets.map((a) => a.id);
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
