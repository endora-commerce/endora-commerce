/**
 * EmbedResolver — feature 047 (R4). Resolves email block/template embeds
 * referenced in a content tree to their single-language Puck trees, preferring
 * channel-scoped rows over global ones. Used by the send + preview render path.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import type { PuckDataTree } from '@endora-commerce/email-components/schema/envelope';
import { walkBlockEmbeds, walkTemplateEmbeds } from '@endora-commerce/email-components/tree/walk-embeds';
import { EmailBlock } from '../entities/email-block.entity.js';
import { EmailTemplate } from '../entities/email-template.entity.js';
import { EmailBlockSalesChannel } from '../entities/email-block-sales-channel.entity.js';
import { EmailTemplateSalesChannel } from '../entities/email-template-sales-channel.entity.js';

export interface ResolvedEmbeds {
  blocks: Record<string, PuckDataTree>;
  templates: Record<string, PuckDataTree>;
}

function treeForLanguage(content: unknown, language: string, fallback?: string): PuckDataTree | null {
  if (!content || typeof content !== 'object') return null;
  const langs = (content as { languages?: Record<string, unknown> }).languages;
  if (!langs) return null;
  const tree = langs[language] ?? (fallback ? langs[fallback] : undefined);
  return tree && typeof tree === 'object' ? (tree as PuckDataTree) : null;
}

export class EmbedResolver {
  async resolve(
    em: EntityManager,
    rootTree: PuckDataTree,
    opts: { salesChannelId: string | null; language: string; fallbackLanguage?: string },
  ): Promise<ResolvedEmbeds> {
    const blockCodes = walkBlockEmbeds(rootTree);
    const templateCodes = walkTemplateEmbeds(rootTree);
    const blocks: Record<string, PuckDataTree> = {};
    const templates: Record<string, PuckDataTree> = {};

    for (const code of blockCodes) {
      const block = await this.pickBlock(em, code, opts.salesChannelId);
      if (block) {
        const tree = treeForLanguage(block.content, opts.language, opts.fallbackLanguage);
        if (tree) blocks[code] = tree;
      }
    }
    for (const code of templateCodes) {
      const tpl = await this.pickTemplate(em, code, opts.salesChannelId);
      if (tpl) {
        const tree = treeForLanguage(tpl.content, opts.language, opts.fallbackLanguage);
        if (tree) templates[code] = tree;
      }
    }
    return { blocks, templates };
  }

  private async pickBlock(em: EntityManager, code: string, salesChannelId: string | null): Promise<EmailBlock | null> {
    if (salesChannelId) {
      const bridge = await em.findOne(EmailBlockSalesChannel, { code, salesChannelId });
      if (bridge) {
        const scoped = await em.findOne(EmailBlock, { id: bridge.blockId });
        if (scoped) return scoped;
      }
    }
    // Global block: a block with no bridge rows. Resolve by code, prefer active.
    return em.findOne(EmailBlock, { code, active: true });
  }

  private async pickTemplate(em: EntityManager, code: string, salesChannelId: string | null): Promise<EmailTemplate | null> {
    if (salesChannelId) {
      const bridge = await em.findOne(EmailTemplateSalesChannel, { code, salesChannelId });
      if (bridge) {
        const scoped = await em.findOne(EmailTemplate, { id: bridge.templateId });
        if (scoped) return scoped;
      }
    }
    return em.findOne(EmailTemplate, { code });
  }
}
