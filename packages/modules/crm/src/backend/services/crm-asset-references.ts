import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReference,
  AssetReferenceDescriptor,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';

/**
 * CRM → `assetReferenceRegistry`: an Opportunity's attachments are references
 * to files of the media library, and the library refuses to delete a file that
 * is still referenced (FR-044).
 *
 * **This is referential integrity, not a surface**, and the registry honours it
 * while this module is switched off: the attachments survive a deactivation,
 * so a scanner that stopped answering would let an operator delete a file that
 * comes back as a broken attachment the moment the module is switched on
 * again. The push is therefore made from a contribution-only boot hook with no
 * presence probe.
 *
 * The statement is raw and platform-wide on purpose: the question is "does
 * anything, in any Organization, still use this file", and whoever is deleting
 * a file in the library need not be somebody who may read the Opportunity. For
 * the same reason the label is the Opportunity's number and never its title.
 */
export function registerCrmAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register(opportunityAttachmentReferenceDescriptor(emFactory));
}

function opportunityAttachmentReferenceDescriptor(emFactory: () => EntityManager): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'crm',
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const rows = (await emFactory().execute(
        `select o."id"::text as id, o."number" as number
           from "crm_opportunity_attachments" a
           join "crm_opportunities" o on o."id" = a."opportunity_id"
          where a."asset_id" in (${assetIds.map(() => '?').join(', ')})
          order by o."number"`,
        [...assetIds],
      )) as Array<{ id: string; number: string }>;
      return rows.map((row) => ({
        kind: 'crm_opportunity_attachment',
        entityId: row.id,
        label: `Sales opportunity ${row.number}`,
      }));
    },
  };
}
