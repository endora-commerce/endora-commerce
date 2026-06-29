import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateNewsletterEmailBlockRequest,
  type NewsletterEmailBlockDetail,
  type NewsletterEmailBlockSummary,
  type UpdateNewsletterEmailBlockRequest,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { NewsletterEmailBlock } from '../entities/newsletter-email-block.entity.js';
import type { ContentTree, EmailEmbeds } from './content.service.js';

interface ContentEnvelope {
  schema_version: number;
  languages: Record<string, ContentTree>;
}

function wrap(tree: ContentTree): ContentEnvelope {
  return { schema_version: 1, languages: { default: tree } };
}

function unwrap(content: Record<string, unknown>, language?: string): ContentTree {
  const env = content as unknown as ContentEnvelope;
  if (!env.languages) return content as ContentTree;
  if (language && env.languages[language]) return env.languages[language];
  const first = Object.values(env.languages)[0];
  return first ?? ({} as ContentTree);
}

/**
 * Reusable email-safe blocks (feature 048, US5). Global blocks embedded into
 * campaign/automation content via the shared renderer's embeds map. System
 * blocks (seeded header/footer) cannot be deleted.
 */
export class NewsletterEmailBlockService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(): Promise<NewsletterEmailBlockSummary[]> {
    const em = this.emFactory();
    const rows = await em.find(NewsletterEmailBlock, {}, { orderBy: { code: 'asc' } });
    return rows.map((b) => this.toSummary(b));
  }

  async get(id: string): Promise<NewsletterEmailBlockDetail> {
    return this.toDetail(await this.load(this.emFactory(), id));
  }

  async create(input: CreateNewsletterEmailBlockRequest): Promise<NewsletterEmailBlockDetail> {
    const em = this.emFactory();
    const existing = await em.findOne(NewsletterEmailBlock, { code: input.code });
    if (existing) throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'Block code already exists.');
    const block = em.create(NewsletterEmailBlock, {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      content: wrap(input.content) as unknown as Record<string, unknown>,
    });
    await em.persistAndFlush(block);
    return this.toDetail(block);
  }

  async update(id: string, input: UpdateNewsletterEmailBlockRequest): Promise<NewsletterEmailBlockDetail> {
    const em = this.emFactory();
    const block = await this.load(em, id);
    if (block.version !== input.expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Block was modified.');
    }
    if (input.name !== undefined) block.name = input.name;
    if (input.description !== undefined) block.description = input.description;
    if (input.active !== undefined) block.active = input.active;
    if (input.content !== undefined) block.content = wrap(input.content) as unknown as Record<string, unknown>;
    block.version += 1;
    await em.persistAndFlush(block);
    return this.toDetail(block);
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const block = await this.load(em, id);
    if (block.isSystem) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'System blocks cannot be deleted.');
    }
    await em.removeAndFlush(block);
  }

  /** Build the renderer embeds map from active blocks for the given language. */
  async resolveEmbeds(language: string): Promise<EmailEmbeds> {
    const em = this.emFactory();
    const rows = await em.find(NewsletterEmailBlock, { active: true });
    const blocks: Record<string, ContentTree> = {};
    for (const b of rows) blocks[b.code] = unwrap(b.content, language);
    return { blocks, templates: {} };
  }

  private async load(em: EntityManager, id: string): Promise<NewsletterEmailBlock> {
    const block = await em.findOne(NewsletterEmailBlock, { id });
    if (!block) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Block not found.');
    return block;
  }

  private toSummary(b: NewsletterEmailBlock): NewsletterEmailBlockSummary {
    return { id: b.id, code: b.code, name: b.name, active: b.active, isSystem: b.isSystem };
  }

  private toDetail(b: NewsletterEmailBlock): NewsletterEmailBlockDetail {
    return {
      ...this.toSummary(b),
      description: b.description,
      content: unwrap(b.content),
      salesChannelId: null,
      version: b.version,
    };
  }
}
