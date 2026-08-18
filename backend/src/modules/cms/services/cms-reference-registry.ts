import type { CmsReference, CmsExternalReferenceScanner } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { walkBlockEmbeds, walkTemplateEmbeds } from './content-tree-walker.js';

/**
 * Both shapes moved to `@b2b/contracts` in feature 075's Phase P — `megamenu`
 * contributes a scanner, which makes the descriptor a boundary shape rather
 * than an internal. Re-exported here for the length of Phase P, which cuts no
 * consumer.
 */
export type { CmsReference, CmsExternalReferenceScanner };

export class CmsReferenceRegistry {
  private readonly externalScanners: CmsExternalReferenceScanner[] = [];

  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Register an external scanner. Another module calls this from its own
   * `ctx.onBoot`, so the contribution passes through the lifecycle seams rather
   * than a composition root's back door. Idempotent across registrations of the
   * same scanner instance.
   */
  register(scanner: CmsExternalReferenceScanner): void {
    if (!this.externalScanners.includes(scanner)) {
      this.externalScanners.push(scanner);
    }
  }

  /** The contributing module of every registered scanner, in registration order. */
  externalOwners(): readonly string[] {
    return this.externalScanners.map((scanner) => scanner.ownerModuleId);
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

    const pages = (await em.execute(
      `select id::text, name, content from cms_pages`,
    )) as Array<{ id: string; name: string; content: unknown }>;
    for (const row of pages) {
      if (walkBlockEmbeds(row.content).has(code)) {
        out.push({ kind: 'cms_page', entityId: row.id, label: row.name });
      }
    }

    const templates = (await em.execute(
      `select id::text, name, content from cms_templates`,
    )) as Array<{ id: string; name: string; content: unknown }>;
    for (const row of templates) {
      if (walkBlockEmbeds(row.content).has(code)) {
        out.push({ kind: 'cms_template', entityId: row.id, label: row.name });
      }
    }

    const hooks = (await em.execute(
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

    const pages = (await em.execute(
      `select id::text, name, content from cms_pages`,
    )) as Array<{ id: string; name: string; content: unknown }>;
    for (const row of pages) {
      if (walkTemplateEmbeds(row.content).has(code)) {
        out.push({ kind: 'cms_page', entityId: row.id, label: row.name });
      }
    }

    const blocks = (await em.execute(
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
