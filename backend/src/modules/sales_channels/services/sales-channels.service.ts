import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  SalesChannelCreateBody,
  SalesChannelUpdateBody,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { SalesChannel } from '../entities/sales-channel.entity.js';

/**
 * SalesChannelsService — feature 005 / T017.
 *
 * Skeleton: every channel-side CRUD + lifecycle entry point that the
 * Admin HTTP layer needs is declared here, but only the bare-minimum
 * read paths and the FR-002 guards (cannot deactivate / delete the
 * system-default channel) are implemented.
 *
 *   - {@link getByCode} / {@link list} are usable now.
 *   - {@link deactivate} / {@link delete} enforce FR-002 by throwing
 *     `CANNOT_MODIFY_SYSTEM_DEFAULT` for the Default row, then throwing
 *     `NotImplementedError` until US2 lands the full lifecycle decision
 *     tree (T035 / T036).
 *   - {@link create} / {@link update} / {@link activate} throw
 *     `NotImplementedError` — US2 fills them in.
 *
 * The reason for shipping the skeleton in Phase 2 rather than waiting
 * for US2 is that {@link plugin} / {@link composition} need to wire a
 * stable handle into Fastify and into other modules' DI right now; US2
 * only fills in method bodies.
 */

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor(method: string) {
    super(`${method} is implemented in feature 005 / US2 (T034-T037).`);
  }
}

export interface SalesChannelsServiceListOptions {
  page?: number;
  pageSize?: number;
  activeOnly?: boolean;
}

export interface AdminAuditContext {
  actorAdminUserId: string | null;
  requestId?: string | null;
}

export class SalesChannelsService {
  constructor(
    private readonly emFactory: () => EntityManager,
    // eventBus + auditLogService land here in US2 (T035-T037) when the
    // mutation paths are filled in; the constructor signature is kept
    // intentionally narrow so this skeleton compiles.
  ) {}

  // -------------------------------------------------------------------------
  // Read paths (usable now)
  // -------------------------------------------------------------------------

  async getByCode(code: string): Promise<SalesChannel | null> {
    const em = this.emFactory();
    return em.findOne(SalesChannel, { code });
  }

  async getById(id: string): Promise<SalesChannel | null> {
    const em = this.emFactory();
    return em.findOne(SalesChannel, { id });
  }

  async list(options: SalesChannelsServiceListOptions = {}): Promise<{
    items: SalesChannel[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const em = this.emFactory();
    const page = Math.max(0, options.page ?? 0);
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 20), 100);
    const where: Record<string, unknown> = {};
    if (options.activeOnly) where['active'] = true;

    const [items, total] = await em.findAndCount(SalesChannel, where, {
      orderBy: { createdAt: 'asc' },
      offset: page * pageSize,
      limit: pageSize,
    });
    return { items, page, pageSize, total };
  }

  // -------------------------------------------------------------------------
  // Mutation paths (US1 — FR-002 guards in place; US2 fills in the rest)
  // -------------------------------------------------------------------------

  async create(
    _body: SalesChannelCreateBody,
    _context?: AdminAuditContext,
  ): Promise<SalesChannel> {
    throw new NotImplementedError('SalesChannelsService.create');
  }

  async update(
    _code: string,
    _body: SalesChannelUpdateBody,
    _ifMatchVersion: number,
    _context?: AdminAuditContext,
  ): Promise<SalesChannel> {
    throw new NotImplementedError('SalesChannelsService.update');
  }

  async deactivate(code: string, _context?: AdminAuditContext): Promise<SalesChannel> {
    const channel = await this.requireByCode(code);
    if (channel.systemDefault) {
      throw new HttpError(
        422,
        ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
        `Sales channel "${channel.code}" is the system default and cannot be deactivated.`,
      );
    }
    throw new NotImplementedError('SalesChannelsService.deactivate');
  }

  async activate(_code: string, _context?: AdminAuditContext): Promise<SalesChannel> {
    throw new NotImplementedError('SalesChannelsService.activate');
  }

  async delete(
    code: string,
    _options: { fallbackToDefault?: boolean } = {},
    _context?: AdminAuditContext,
  ): Promise<void> {
    const channel = await this.requireByCode(code);
    if (channel.systemDefault) {
      throw new HttpError(
        422,
        ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
        `Sales channel "${channel.code}" is the system default and cannot be deleted.`,
      );
    }
    throw new NotImplementedError('SalesChannelsService.delete');
  }

  private async requireByCode(code: string): Promise<SalesChannel> {
    const channel = await this.getByCode(code);
    if (channel === null) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Sales channel "${code}" was not found.`,
      );
    }
    return channel;
  }
}
