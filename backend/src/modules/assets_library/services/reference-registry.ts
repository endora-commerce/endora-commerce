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
   * Implementation: given a list of asset ids, return every reference that
   * points at any of them. MUST issue a single batched query under the hood
   * (one query per descriptor regardless of batch size).
   */
  findReferences(assetIds: string[]): Promise<AssetReference[]>;
};

export class AssetReferenceRegistry {
  private readonly descriptors: AssetReferenceDescriptor[] = [];

  register(d: AssetReferenceDescriptor): void {
    if (!this.descriptors.includes(d)) {
      this.descriptors.push(d);
    }
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
