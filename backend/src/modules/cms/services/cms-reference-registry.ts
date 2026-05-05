import type { EntityManager } from '@mikro-orm/postgresql';
import { walkBlockEmbeds } from './content-tree-walker.js';

export interface CmsReference {
  kind: 'cms_page';
  entityId: string;
  label: string;
}

export class CmsReferenceRegistry {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findBlockReferences(code: string): Promise<CmsReference[]> {
    const rows = (await this.emFactory().getConnection().execute(
      `select id::text, name, content from cms_pages`,
    )) as Array<{ id: string; name: string; content: unknown }>;
    const out: CmsReference[] = [];
    for (const row of rows) {
      if (walkBlockEmbeds(row.content).has(code)) {
        out.push({ kind: 'cms_page', entityId: row.id, label: row.name });
      }
    }
    return out;
  }
}
