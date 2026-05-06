import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type ActivateBindingResponse,
  type CreateMegamenuRequest,
  type MegamenuBinding as MegamenuBindingDto,
  type MegamenuDetail,
  type MegamenuSummary,
  type PatchMegamenuRequest,
  type ResolvedMenuItem,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { MegamenuCache } from './megamenu-cache.js';

type MegamenuRow = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type ItemRow = {
  id: string;
  megamenu_id: string;
  parent_id: string | null;
  position: number;
  kind: string;
  labels: Record<string, string>;
  descriptions: Record<string, string> | null;
  target: Record<string, unknown>;
};

type BindingRow = {
  megamenu_id: string;
  sales_channel_id: string;
  language: string;
  active: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type ChannelRow = {
  id: string;
  code: string;
  languages: string[];
  default_language: string;
};

/**
 * Megamenu CRUD + binding lifecycle. The activation transaction enforces
 * "exactly one active megamenu per (channel, language)" via the partial
 * unique index on `megamenu_bindings(sales_channel_id, language) WHERE
 * active = true` (R3 / FR-008).
 */
export class MegamenuService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: MegamenuCache,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────────────────────────────

  async list(): Promise<{ data: MegamenuSummary[]; nextCursor: null }> {
    const rows = (await this.emFactory().getConnection().execute(
      `select * from megamenus order by updated_at desc limit 100`,
    )) as MegamenuRow[];
    const data = await Promise.all(rows.map((row) => this.toSummary(row)));
    return { data, nextCursor: null };
  }

  async create(input: CreateMegamenuRequest): Promise<MegamenuDetail> {
    const em = this.emFactory();
    const id = randomUUID();
    const now = new Date();
    await em.getConnection().execute(
      `insert into megamenus (id, name, description, version, created_at, updated_at)
       values (?, ?, ?, 1, ?, ?)`,
      [id, input.name, input.description ?? null, now, now],
    );
    return this.get(id);
  }

  async get(id: string): Promise<MegamenuDetail> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.MEGAMENU_NOT_FOUND, 'Megamenu not found.');
    return this.toDetail(row);
  }

  async patch(id: string, input: PatchMegamenuRequest): Promise<MegamenuDetail> {
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      const row = await this.findRow(id, tx);
      if (!row) throw new HttpError(404, ERROR_CODES.MEGAMENU_NOT_FOUND, 'Megamenu not found.');
      this.assertVersion(row.version, input.version);

      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.name !== undefined) {
        sets.push('name = ?');
        params.push(input.name);
      }
      if (input.description !== undefined) {
        sets.push('description = ?');
        params.push(input.description);
      }
      if (sets.length === 0) return;
      params.push(id);
      await tx.getConnection().execute(
        `update megamenus
            set ${sets.join(', ')}, version = version + 1, updated_at = now()
          where id = ?`,
        params,
      );
    });
    if (this.cache) await this.cache.invalidateAll();
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory();
    const activeRows = (await em.getConnection().execute(
      `select 1 from megamenu_bindings where megamenu_id = ? and active = true limit 1`,
      [id],
    )) as Array<{ '?column?': number }>;
    if (activeRows.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.MEGAMENU_HAS_ACTIVE_BINDINGS,
        'Megamenu has at least one active binding; deactivate before deleting.',
      );
    }
    await em.getConnection().execute('delete from megamenus where id = ?', [id]);
    if (this.cache) await this.cache.invalidateAll();
  }

  // ────────────────────────────────────────────────────────────────────
  // Bindings
  // ────────────────────────────────────────────────────────────────────

  async listBindings(menuId: string): Promise<MegamenuBindingDto[]> {
    await this.assertMenuExists(menuId);
    const rows = (await this.emFactory().getConnection().execute(
      `select * from megamenu_bindings where megamenu_id = ? order by created_at asc`,
      [menuId],
    )) as BindingRow[];
    return rows.map((row) => this.toBindingDto(row));
  }

  async addBinding(
    menuId: string,
    salesChannelId: string,
    language: string,
  ): Promise<MegamenuBindingDto> {
    const em = this.emFactory();
    await this.assertMenuExists(menuId);
    const channel = await this.fetchChannel(em, salesChannelId);
    if (!channel) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Sales channel ${salesChannelId} not found.`);
    }
    if (!channel.languages.includes(language)) {
      throw new HttpError(
        400,
        ERROR_CODES.MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE,
        `Language "${language}" is not in the channel's configured language set.`,
      );
    }
    const existing = (await em.getConnection().execute(
      `select 1 from megamenu_bindings
        where megamenu_id = ? and sales_channel_id = ? and language = ?`,
      [menuId, salesChannelId, language],
    )) as Array<{ '?column?': number }>;
    if (existing.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.MEGAMENU_BINDING_ALREADY_EXISTS,
        'Binding for this (channel, language) already exists.',
      );
    }
    const now = new Date();
    await em.getConnection().execute(
      `insert into megamenu_bindings
         (megamenu_id, sales_channel_id, language, active, version, created_at, updated_at)
       values (?, ?, ?, false, 1, ?, ?)`,
      [menuId, salesChannelId, language, now, now],
    );
    if (this.cache) await this.cache.invalidateScope(channel.code, language);
    const rows = (await em.getConnection().execute(
      `select * from megamenu_bindings
        where megamenu_id = ? and sales_channel_id = ? and language = ?`,
      [menuId, salesChannelId, language],
    )) as BindingRow[];
    return this.toBindingDto(rows[0]!);
  }

  async removeBinding(menuId: string, salesChannelId: string, language: string): Promise<void> {
    const em = this.emFactory();
    await this.assertMenuExists(menuId);
    const channel = await this.fetchChannel(em, salesChannelId);
    await em.getConnection().execute(
      `delete from megamenu_bindings
        where megamenu_id = ? and sales_channel_id = ? and language = ?`,
      [menuId, salesChannelId, language],
    );
    // DELETE is idempotent — a missing row is fine. Cache invalidation
    // runs unconditionally so a stale entry never lingers.
    if (this.cache && channel) await this.cache.invalidateScope(channel.code, language);
  }

  /**
   * Atomic activation swap (FR-008 / R3): deactivate the prior holder
   * for the scope (if any) inside the same transaction, then upsert the
   * new active row. The partial unique index refuses dual-active state
   * even if this method's body regresses.
   */
  async activate(
    menuId: string,
    salesChannelId: string,
    language: string,
  ): Promise<ActivateBindingResponse> {
    const em = this.emFactory();
    let response!: ActivateBindingResponse;
    await em.transactional(async (tx) => {
      // Verify the binding exists.
      const binding = (await tx.getConnection().execute(
        `select * from megamenu_bindings
          where megamenu_id = ? and sales_channel_id = ? and language = ?`,
        [menuId, salesChannelId, language],
      )) as BindingRow[];
      if (binding.length === 0) {
        throw new HttpError(
          404,
          ERROR_CODES.MEGAMENU_BINDING_NOT_FOUND,
          'Binding not found.',
        );
      }

      // Refuse on empty tree (R10).
      const items = (await tx.getConnection().execute(
        `select 1 from megamenu_items where megamenu_id = ? limit 1`,
        [menuId],
      )) as Array<{ '?column?': number }>;
      if (items.length === 0) {
        throw new HttpError(
          400,
          ERROR_CODES.MEGAMENU_EMPTY_TREE,
          'Megamenu has no items; populate the tree before activating.',
        );
      }

      // Identify any prior holder for the (channel, language) pair.
      const prior = (await tx.getConnection().execute(
        `select b.megamenu_id, m.name
           from megamenu_bindings b
           join megamenus m on m.id = b.megamenu_id
          where b.sales_channel_id = ? and b.language = ? and b.active = true
            and b.megamenu_id <> ?
          limit 1`,
        [salesChannelId, language, menuId],
      )) as Array<{ megamenu_id: string; name: string }>;

      // Deactivate any existing active binding in the scope (this menu or another).
      await tx.getConnection().execute(
        `update megamenu_bindings
            set active = false, version = version + 1, updated_at = now()
          where sales_channel_id = ? and language = ? and active = true`,
        [salesChannelId, language],
      );

      // Activate the requested binding.
      await tx.getConnection().execute(
        `update megamenu_bindings
            set active = true, version = version + 1, updated_at = now()
          where megamenu_id = ? and sales_channel_id = ? and language = ?`,
        [menuId, salesChannelId, language],
      );

      response = {
        activated: { megamenuId: menuId, salesChannelId, language },
        previouslyActive:
          prior.length > 0 && prior[0]
            ? { megamenuId: prior[0].megamenu_id, name: prior[0].name }
            : null,
      };
    });

    if (this.cache) {
      const channel = await this.fetchChannel(em, salesChannelId);
      if (channel) await this.cache.invalidateScope(channel.code, language);
    }
    return response;
  }

  async deactivate(menuId: string, salesChannelId: string, language: string): Promise<void> {
    const em = this.emFactory();
    const existing = (await em.getConnection().execute(
      `select 1 from megamenu_bindings
        where megamenu_id = ? and sales_channel_id = ? and language = ? limit 1`,
      [menuId, salesChannelId, language],
    )) as Array<{ '?column?': number }>;
    if (existing.length === 0) {
      throw new HttpError(404, ERROR_CODES.MEGAMENU_BINDING_NOT_FOUND, 'Binding not found.');
    }
    await em.getConnection().execute(
      `update megamenu_bindings
          set active = false, version = version + 1, updated_at = now()
        where megamenu_id = ? and sales_channel_id = ? and language = ?`,
      [menuId, salesChannelId, language],
    );
    if (this.cache) {
      const channel = await this.fetchChannel(em, salesChannelId);
      if (channel) await this.cache.invalidateScope(channel.code, language);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────

  async findRow(id: string, em?: EntityManager): Promise<MegamenuRow | null> {
    const conn = (em ?? this.emFactory()).getConnection();
    const rows = (await conn.execute('select * from megamenus where id = ?', [id])) as MegamenuRow[];
    return rows[0] ?? null;
  }

  private async assertMenuExists(id: string): Promise<void> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.MEGAMENU_NOT_FOUND, 'Megamenu not found.');
  }

  private assertVersion(current: number, supplied?: number): void {
    if (supplied !== undefined && supplied !== current) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Megamenu was updated concurrently.');
    }
  }

  private async fetchChannel(em: EntityManager, id: string): Promise<ChannelRow | null> {
    const rows = (await em.getConnection().execute(
      `select id::text, code, languages, default_language from sales_channels where id = ? limit 1`,
      [id],
    )) as ChannelRow[];
    return rows[0] ?? null;
  }

  private async fetchItems(menuId: string): Promise<ItemRow[]> {
    return (await this.emFactory().getConnection().execute(
      `select * from megamenu_items
        where megamenu_id = ?
        order by parent_id nulls first, position asc, id asc`,
      [menuId],
    )) as ItemRow[];
  }

  private async fetchBindings(menuId: string): Promise<BindingRow[]> {
    return (await this.emFactory().getConnection().execute(
      `select * from megamenu_bindings where megamenu_id = ? order by created_at asc`,
      [menuId],
    )) as BindingRow[];
  }

  private async toSummary(row: MegamenuRow): Promise<MegamenuSummary> {
    const bindings = (await this.fetchBindings(row.id)).map((b) => this.toBindingDto(b));
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      bindings,
      activeIn: bindings.filter((b) => b.active).length,
      createdAt: this.iso(row.created_at),
      updatedAt: this.iso(row.updated_at),
    };
  }

  private async toDetail(row: MegamenuRow): Promise<MegamenuDetail> {
    const summary = await this.toSummary(row);
    const itemRows = await this.fetchItems(row.id);
    return {
      ...summary,
      items: itemRows.map((item) => this.toItemDto(item)),
    };
  }

  private toBindingDto(row: BindingRow): MegamenuBindingDto {
    return {
      salesChannelId: row.sales_channel_id,
      language: row.language,
      active: row.active,
      version: row.version,
      createdAt: this.iso(row.created_at),
      updatedAt: this.iso(row.updated_at),
    };
  }

  private toItemDto(row: ItemRow): MegamenuDetail['items'][number] {
    // The Zod discriminated union enforces shape on the way in; the way
    // out we trust the persisted data and re-shape into the contract type.
    return {
      id: row.id,
      parentId: row.parent_id,
      position: row.position,
      kind: row.kind as MegamenuDetail['items'][number]['kind'],
      labels: row.labels,
      descriptions: row.descriptions,
      target: row.target,
    } as MegamenuDetail['items'][number];
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}

/** Small helper for tests / smoke flows that need to assemble a tree. */
export function emptyResolvedItems(): ResolvedMenuItem[] {
  return [];
}
