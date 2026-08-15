// AssetReferenceRegistry — feature 013 / research.md R10 / contracts/
// assets-library-reference-registry.contract.md.
//
// In-process registry of "who points at this asset" descriptors. Catalog
// (4 FK descriptors) and CMS (1 jsonb-body-scan descriptor) register at
// composition time. The Library consults the registry before every
// soft-delete attempt (FR-030).

import type { AssetReference } from '@b2b/contracts';
export type { AssetReference };

export type AssetReferenceDescriptor = {
  /**
   * The module that contributed this descriptor, recorded from feature 072's
   * D-39. A contribution seam records its contributor: without it the registry
   * could not state a policy for an absent owner at all — not "honour", not
   * "skip", only "nobody looked". It is required for that reason.
   */
  ownerModuleId: string;
  /**
   * Implementation: given a list of asset ids, return every reference that
   * points at any of them. MUST issue a single batched query under the hood
   * (one query per descriptor regardless of batch size).
   */
  findReferences(assetIds: string[]): Promise<AssetReference[]>;
};

/**
 * Enumeration policy: **honoured** while the contributing module is absent
 * (feature 072, D-39).
 *
 * D-39's default is to skip, and honouring needs a written reason. This registry
 * is referential integrity, not a surface. If `blog` is switched off its posts
 * still exist and still embed assets; skipping `blog`'s scanner would let an
 * operator delete an asset that comes back as a broken image the moment `blog`
 * is switched on again — a data loss caused by an action Constitution XVII
 * promises is non-destructive and reversible.
 *
 * `skip` is right for surface-like contributions — an interceptor, a palette
 * action, a storefront element — where a switched-off module must contribute
 * nothing a user can see. Nobody sees these; they exist to refuse a delete.
 *
 * The owner is recorded on every descriptor even though this registry does not
 * filter on it, because the alternative is a registry that could not express the
 * decision either way, and because it attributes a 409 to a module.
 */
export class AssetReferenceRegistry {
  private readonly descriptors: AssetReferenceDescriptor[] = [];

  register(d: AssetReferenceDescriptor): void {
    if (!this.descriptors.includes(d)) {
      this.descriptors.push(d);
    }
  }

  /** The contributing module of every registered descriptor, in registration order. */
  owners(): readonly string[] {
    return this.descriptors.map((d) => d.ownerModuleId);
  }

  async findReferences(assetId: string): Promise<AssetReference[]> {
    const all = await Promise.all(
      this.descriptors.map((d) => d.findReferences([assetId])),
    );
    return all.flat();
  }

  async findReferencesMany(
    assetIds: string[],
  ): Promise<Map<string, AssetReference[]>> {
    const out = new Map<string, AssetReference[]>();
    for (const id of assetIds) out.set(id, []);
    if (assetIds.length === 0) return out;

    const perDescriptor = await Promise.all(
      this.descriptors.map((d) => d.findReferences(assetIds)),
    );
    for (const refs of perDescriptor) {
      for (const ref of refs) {
        // Each descriptor is responsible for tagging every reference with the
        // *original* asset id it found; the registry does not try to cross-
        // correlate. Descriptors that batch via WHERE asset_id = ANY($1) get
        // the asset_id back from the row trivially.
        const list = out.get((ref as AssetReference & { __assetId?: string }).__assetId ?? '');
        if (list) list.push(ref);
      }
    }
    return out;
  }
}
