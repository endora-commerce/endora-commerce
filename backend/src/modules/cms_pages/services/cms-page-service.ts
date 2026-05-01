import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';
import { CmsPage } from '../entities/cms-page.entity.js';

/**
 * CmsPageService — admin authoring + public read paths (T234 / FR-100).
 *
 * Lifecycle:
 *   - `upsert` creates a new draft or updates an existing row in place.
 *     Mutating `path` is allowed; the unique constraint catches collisions.
 *   - `publish` flips status → 'published' and stamps publishedAt.
 *   - `unpublish` flips back to 'draft' (does not archive).
 *   - `archive` is a soft removal — readers ignore archived pages but
 *     historical references survive.
 */
export class CmsPageService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 005 / T027b — auto-bind newly-created CMS Pages to the system default. */
    private readonly salesChannelMembership?: SalesChannelMembershipService,
  ) {}

  async list(): Promise<CmsPage[]> {
    const em = this.emFactory();
    return em.find(CmsPage, {}, { orderBy: { path: 'asc' } });
  }

  async listPublished(): Promise<CmsPage[]> {
    const em = this.emFactory();
    return em.find(CmsPage, { status: 'published' }, { orderBy: { path: 'asc' } });
  }

  async getById(id: string): Promise<CmsPage> {
    const em = this.emFactory();
    const row = await em.findOne(CmsPage, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `CMS page ${id} not found.`);
    return row;
  }

  async getByPath(path: string): Promise<CmsPage> {
    const em = this.emFactory();
    const row = await em.findOne(CmsPage, { path });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `CMS page "${path}" not found.`);
    return row;
  }

  async getPublishedByPath(path: string): Promise<CmsPage> {
    const row = await this.getByPath(path);
    if (row.status !== 'published') {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `CMS page "${path}" not found.`);
    }
    return row;
  }

  async create(input: {
    path: string;
    title: Record<string, string>;
    body: Record<string, string>;
  }): Promise<CmsPage> {
    const em = this.emFactory();
    const collision = await em.findOne(CmsPage, { path: input.path });
    if (collision) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `CMS page "${input.path}" already exists.`);
    }
    const row = em.create(CmsPage, {
      path: input.path,
      title: input.title,
      body: input.body,
    });
    await em.persistAndFlush(row);
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('cms-page', row.id);
    }
    return row;
  }

  async update(
    id: string,
    patch: { path?: string; title?: Record<string, string>; body?: Record<string, string> },
  ): Promise<CmsPage> {
    const em = this.emFactory();
    const row = await em.findOne(CmsPage, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `CMS page ${id} not found.`);
    if (patch.path !== undefined && patch.path !== row.path) {
      const collision = await em.findOne(CmsPage, { path: patch.path });
      if (collision) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `CMS page "${patch.path}" already exists.`,
        );
      }
      row.path = patch.path;
    }
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.body !== undefined) row.body = patch.body;
    await em.flush();
    return row;
  }

  async publish(id: string): Promise<CmsPage> {
    const em = this.emFactory();
    const row = await em.findOne(CmsPage, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `CMS page ${id} not found.`);
    row.status = 'published';
    row.publishedAt = new Date();
    row.archivedAt = null;
    await em.flush();
    return row;
  }

  async unpublish(id: string): Promise<CmsPage> {
    const em = this.emFactory();
    const row = await em.findOne(CmsPage, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `CMS page ${id} not found.`);
    row.status = 'draft';
    await em.flush();
    return row;
  }

  async archive(id: string): Promise<CmsPage> {
    const em = this.emFactory();
    const row = await em.findOne(CmsPage, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `CMS page ${id} not found.`);
    row.status = 'archived';
    row.archivedAt = new Date();
    await em.flush();
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(CmsPage, { id });
    if (!row) return;
    await em.removeAndFlush(row);
  }
}
