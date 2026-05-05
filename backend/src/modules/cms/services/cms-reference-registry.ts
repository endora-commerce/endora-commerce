import type { EntityManager } from '@mikro-orm/postgresql';
import { walkBlockEmbeds, walkTemplateEmbeds } from './content-tree-walker.js';

export interface CmsReference {
  /**
   * Type tag of the referencing entity. The closed set covers the
   * cms-internal references; external scanners (registered via
   * `register(...)` from other modules) MAY emit additional kinds.
   */
  kind: 'cms_page' | 'cms_block' | 'cms_template' | 'cms_hook' | 'megamenu' | string;
  entityId: string;
  label: string;
}

/**
 * Optional scanner contributed by another module so its references can
 * block CMS-page / CMS-block / CMS-template deletion. Each method is
 * optional — a scanner only fills in the edges it cares about.
 *
 * The block + template scanners receive both id and code: the megamenu
 * module references blocks/templates by `id`, the CMS module's own
 * references match on `code`.
 */
export interface CmsExternalReferenceScanner {
  findPageReferences?: (pageId: string) => Promise<CmsReference[]>;
  findBlockReferences?: (blockId: string, blockCode: string) => Promise<CmsReference[]>;
  findTemplateReferences?: (templateId: string, templateCode: string) => Promise<CmsReference[]>;
}

/**
 * In-process registry of references between CMS entities. Consulted by
 * Block / Template / Page delete to refuse deletion when an embed,
 * attachment, or external module reference still points at the entity.
 *
 * Edges (per data-model.md):
 *   page → block      (cms_pages.content with InsertBlock)
 *   page → template   (cms_pages.content with InsertTemplate)
 *   block → template  (cms_blocks.content with InsertTemplate)
 *   template → block  (cms_templates.content with InsertBlock)
 *   hook → block      (cms_hook_block_attachments.block_id)
 *   megamenu → page   (registered externally by feature 015)
 *   megamenu → block  (registered externally by feature 015)
 */
export class CmsReferenceRegistry {
  private readonly externalScanners: CmsExternalReferenceScanner[] = [];

  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Register an external scanner. Other modules call this from
   * composition.ts so their references block CMS-entity deletion. Idempotent
   * across registrations of the same scanner instance.
   */
  register(scanner: CmsExternalReferenceScanner): void {
    if (!this.externalScanners.includes(scanner)) {
      this.externalScanners.push(scanner);
    }
  }

  /** Pages and modules that point at the Page with this id. */
  async findPageReferences(pageId: string): Promise<CmsReference[]> {
    const out: CmsReference[] = [];
    for (const scanner of this.externalScanners) {
      if (scanner.findPageReferences) {
        out.push(...(await scanner.findPageReferences(pageId)));
      }
    }
    return out;
  }

  /** Pages, Templates, Hooks, and external modules that reference the Block. */
  async findBlockReferences(blockIdOrCode: string, blockCode?: string): Promise<CmsReference[]> {
    // Backwards-compat: callers that supply only the code (the historical
    // shape) skip the external scanners that need an id.
    const code = blockCode ?? blockIdOrCode;
    const blockId = blockCode === undefined ? null : blockIdOrCode;
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

    if (blockId) {
      for (const scanner of this.externalScanners) {
        if (scanner.findBlockReferences) {
          out.push(...(await scanner.findBlockReferences(blockId, code)));
        }
      }
    }

    return out;
  }

  /** Pages and Blocks that point at the Template with this code. */
  async findTemplateReferences(templateIdOrCode: string, templateCode?: string): Promise<CmsReference[]> {
    const code = templateCode ?? templateIdOrCode;
    const templateId = templateCode === undefined ? null : templateIdOrCode;
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

    if (templateId) {
      for (const scanner of this.externalScanners) {
        if (scanner.findTemplateReferences) {
          out.push(...(await scanner.findTemplateReferences(templateId, code)));
        }
      }
    }

    return out;
  }
}
