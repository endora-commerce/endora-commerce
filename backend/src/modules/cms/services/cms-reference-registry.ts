import type { EntityManager } from '@mikro-orm/postgresql';
import { walkBlockEmbeds, walkTemplateEmbeds } from './content-tree-walker.js';

export interface CmsReference {
  kind: 'cms_page' | 'cms_block' | 'cms_template' | 'cms_hook';
  entityId: string;
  label: string;
}

/**
 * In-process registry of references between CMS entities. Consulted by
 * Block / Template delete to refuse deletion when an embed or attachment
 * still points at the entity. Page-level deletion is unprotected by this
 * registry (Pages are leaves of the reference graph in v1).
 *
 * Edges (per data-model.md):
 *   page → block      (cms_pages.content with InsertBlock)
 *   page → template   (cms_pages.content with InsertTemplate)
 *   block → template  (cms_blocks.content with InsertTemplate)
 *   template → block  (cms_templates.content with InsertBlock)
 *   hook → block      (cms_hook_block_attachments.block_id)
 */
export class CmsReferenceRegistry {
  constructor(private readonly emFactory: () => EntityManager) {}

  /** Pages, Templates and Hooks that point at the Block with this code. */
  async findBlockReferences(code: string): Promise<CmsReference[]> {
    const out: CmsReference[] = [];
    const em = this.emFactory();

    const pages = (await em.getConnection().execute(
      `select id::text, name, content from cms_pages`,
    )) as Array<{ id: string; name: string; content: unknown }>;
    for (const row of pages) {
      if (walkBlockEmbeds(row.content).has(code)) {
        out.push({ kind: 'cms_page', entityId: row.id, label: row.name });
      }
    }

    const templates = (await em.getConnection().execute(
      `select id::text, name, content from cms_templates`,
    )) as Array<{ id: string; name: string; content: unknown }>;
    for (const row of templates) {
      if (walkBlockEmbeds(row.content).has(code)) {
        out.push({ kind: 'cms_template', entityId: row.id, label: row.name });
      }
    }

    const hooks = (await em.getConnection().execute(
      `select h.id::text, h.name
       from cms_hook_block_attachments a
       join cms_hooks h on h.id = a.hook_id
       join cms_blocks b on b.id = a.block_id
       where b.code = ?`,
      [code],
    )) as Array<{ id: string; name: string }>;
    for (const row of hooks) {
      out.push({ kind: 'cms_hook', entityId: row.id, label: row.name });
    }

    return out;
  }

  /** Pages and Blocks that point at the Template with this code. */
  async findTemplateReferences(code: string): Promise<CmsReference[]> {
    const out: CmsReference[] = [];
    const em = this.emFactory();

    const pages = (await em.getConnection().execute(
      `select id::text, name, content from cms_pages`,
    )) as Array<{ id: string; name: string; content: unknown }>;
    for (const row of pages) {
      if (walkTemplateEmbeds(row.content).has(code)) {
        out.push({ kind: 'cms_page', entityId: row.id, label: row.name });
      }
    }

    const blocks = (await em.getConnection().execute(
      `select id::text, name, content from cms_blocks`,
    )) as Array<{ id: string; name: string; content: unknown }>;
    for (const row of blocks) {
      if (walkTemplateEmbeds(row.content).has(code)) {
        out.push({ kind: 'cms_block', entityId: row.id, label: row.name });
      }
    }

    return out;
  }
}
