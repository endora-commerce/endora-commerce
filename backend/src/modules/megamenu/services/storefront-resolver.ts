import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  ResolvedMegamenu,
  ResolvedMenuItem,
  MegamenuItemKind,
  MegamenuButtonVariant,
  MegamenuEmbedSide,
  MegamenuIconPosition,
  MegamenuAssetKind,
} from '@b2b/contracts';
import type { MegamenuCache } from './megamenu-cache.js';

export interface StorefrontDeps {
  /** Resolves a Category id to its public storefront URL. */
  resolveCategoryUrl: (categoryId: string) => Promise<string | null>;
  /** Resolves a CMS Page id to its public storefront URL. */
  resolveCmsPageUrl: (pageId: string) => Promise<string | null>;
  /** Resolves a Library Asset id to a CDN-ready URL + label + kind. */
  resolveAsset: (
    assetId: string,
  ) => Promise<{ url: string; label: string | null; kind: MegamenuAssetKind } | null>;
  /** Inlines a CMS Block by id into the resolved payload. */
  resolveCmsBlock: (
    blockId: string,
    language: string,
  ) => Promise<{ id: string; code: string; language: string; content: { schemaVersion: number; data: unknown } } | null>;
}

type ChannelRow = {
  id: string;
  code: string;
  default_language: string;
};

/** Request-resolved sales channel handed in by the resolver middleware. */
export type ResolvedChannel = { id: string; code: string; defaultLanguage: string };

function toChannelRow(channel: ResolvedChannel): ChannelRow {
  return { id: channel.id, code: channel.code, default_language: channel.defaultLanguage };
}

type ItemRow = {
  id: string;
  parent_id: string | null;
  position: number;
  kind: MegamenuItemKind;
  labels: Record<string, string>;
  descriptions: Record<string, string> | null;
  target: Record<string, unknown>;
};

type ActiveMenuRow = {
  id: string;
  name: string;
};

/**
 * Storefront resolution for the Megamenu module — feature 015 / T028.
 *
 * `resolveByChannelAndLanguage` is the single read endpoint behind
 * `GET /api/v1/megamenu/by-channel`. It looks up the active binding via
 * the partial unique index, fetches every item in one query, batches
 * cross-module URL resolution, and assembles a recursive payload.
 * Optional Redis read-through wraps the whole call.
 */
export class StorefrontResolver {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly deps: StorefrontDeps,
    private readonly cache?: MegamenuCache,
  ) {}

  async resolveByChannelAndLanguage(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
  }): Promise<ResolvedMegamenu | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);

    const requestedLanguage = input.language ?? channel.default_language;

    if (this.cache) {
      const cached = await this.cache.get(channel.code, requestedLanguage);
      if (cached) return cached;
    }

    const menuRows = (await em.execute(
      `select m.id::text as id, m.name as name
         from megamenu_bindings b
         join megamenus m on m.id = b.megamenu_id
        where b.sales_channel_id = ? and b.language = ? and b.active = true
        limit 1`,
      [channel.id, requestedLanguage],
    )) as ActiveMenuRow[];
    const active = menuRows[0];
    if (!active) return null;

    const itemRows = (await em.execute(
      `select id::text, parent_id::text, position, kind, labels, descriptions, target
         from megamenu_items
        where megamenu_id = ?
        order by parent_id nulls first, position asc, id asc`,
      [active.id],
    )) as ItemRow[];

    const byParent = new Map<string | null, ItemRow[]>();
    for (const row of itemRows) {
      const list = byParent.get(row.parent_id) ?? [];
      list.push(row);
      byParent.set(row.parent_id, list);
    }

    const buildSubtree = async (parentId: string | null): Promise<ResolvedMenuItem[]> => {
      const children = byParent.get(parentId) ?? [];
      const out: ResolvedMenuItem[] = [];
      for (const row of children) {
        const built = await this.buildOne(row, requestedLanguage, channel.default_language, buildSubtree);
        if (built) out.push(built);
      }
      return out;
    };

    const tree = await buildSubtree(null);
    const payload: ResolvedMegamenu = {
      megamenuId: active.id,
      name: active.name,
      language: requestedLanguage,
      items: tree,
    };

    if (this.cache) {
      await this.cache.set(channel.code, requestedLanguage, payload);
    }
    return payload;
  }

  private async buildOne(
    row: ItemRow,
    language: string,
    fallbackLanguage: string,
    buildSubtree: (parentId: string | null) => Promise<ResolvedMenuItem[]>,
  ): Promise<ResolvedMenuItem | null> {
    const label = this.resolveLabel(row.labels, language, fallbackLanguage);
    if (label === null) return null;

    const description = this.resolveLabel(row.descriptions ?? {}, language, fallbackLanguage);
    const children = await buildSubtree(row.id);

    const base: ResolvedMenuItem = {
      id: row.id,
      parentId: row.parent_id,
      kind: row.kind,
      label,
      ...(description !== null ? { description } : {}),
      children,
    };

    switch (row.kind) {
      case 'category-link': {
        const target = row.target as {
          categoryId: string;
          iconAssetId?: string;
          iconPosition?: MegamenuIconPosition;
        };
        const url = await this.deps.resolveCategoryUrl(target.categoryId);
        if (!url) return null;
        const icon = await this.resolveIcon(target.iconAssetId, target.iconPosition);
        return { ...base, url, ...(icon ? { icon } : {}) };
      }
      case 'cms-page-link': {
        const target = row.target as {
          pageId: string;
          iconAssetId?: string;
          iconPosition?: MegamenuIconPosition;
        };
        const url = await this.deps.resolveCmsPageUrl(target.pageId);
        if (!url) return null;
        const icon = await this.resolveIcon(target.iconAssetId, target.iconPosition);
        return { ...base, url, ...(icon ? { icon } : {}) };
      }
      case 'external-link': {
        const target = row.target as {
          url: string;
          iconAssetId?: string;
          iconPosition?: MegamenuIconPosition;
        };
        const icon = await this.resolveIcon(target.iconAssetId, target.iconPosition);
        return { ...base, url: target.url, ...(icon ? { icon } : {}) };
      }
      case 'button': {
        const target = row.target as { url: string; variant: MegamenuButtonVariant };
        return { ...base, url: target.url, variant: target.variant };
      }
      case 'asset': {
        const target = row.target as { assetId?: string; kind: MegamenuAssetKind };
        if (!target.assetId) return null;
        const resolved = await this.deps.resolveAsset(target.assetId);
        if (!resolved) return null;
        return {
          ...base,
          asset: { id: target.assetId, kind: resolved.kind, url: resolved.url, label: resolved.label },
        };
      }
      case 'cms-block-embed': {
        const target = row.target as { blockId: string; embedSide: MegamenuEmbedSide };
        const block = await this.deps.resolveCmsBlock(target.blockId, language);
        if (!block) return null;
        return { ...base, block, embedSide: target.embedSide };
      }
    }
  }

  private async resolveIcon(
    iconAssetId: string | undefined,
    iconPosition: MegamenuIconPosition | undefined,
  ): Promise<{ assetId: string; url: string; position: MegamenuIconPosition } | null> {
    if (!iconAssetId) return null;
    const asset = await this.deps.resolveAsset(iconAssetId);
    if (!asset) return null;
    return { assetId: iconAssetId, url: asset.url, position: iconPosition ?? 'left' };
  }

  private resolveLabel(
    labels: Record<string, string>,
    language: string,
    fallbackLanguage: string,
  ): string | null {
    const direct = labels[language];
    if (typeof direct === 'string' && direct.length > 0) {
      return direct;
    }
    if (language !== fallbackLanguage) {
      const fallback = labels[fallbackLanguage];
      if (typeof fallback === 'string' && fallback.length > 0) {
        return fallback;
      }
    }
    return null;
  }
}
