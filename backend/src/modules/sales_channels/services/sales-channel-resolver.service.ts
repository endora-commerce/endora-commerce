import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '../entities/sales-channel.entity.js';
import type {
  SalesChannelsCache} from './sales-channels-cache.js';
import {
  toCachedChannel,
  type CachedChannel,
} from './sales-channels-cache.js';

/**
 * SalesChannelResolverService — feature 005 / T014.
 *
 * Lookup helper used by the resolver Fastify middleware (T015) and by
 * any other consumer that needs to map a code to a channel. Reads
 * exclusively from {@link SalesChannelsCache}; on a miss, hits Postgres
 * once and primes the cache (positive or "not found" sentinel).
 *
 * Also owns:
 *   - the host-based mapping parsed from `SALES_CHANNEL_HOST_MAP`
 *   - the system-default channel lookup (used as the storefront /
 *     integration fallback per FR-013)
 */

export interface ResolverError {
  kind: 'unknown_sales_channel' | 'inactive_sales_channel';
  code: string;
}

export class SalesChannelResolverService {
  private readonly hostMap: Map<string, string>;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache: SalesChannelsCache,
  ) {
    this.hostMap = parseHostMap(process.env['SALES_CHANNEL_HOST_MAP'] ?? '');
  }

  /** Lookup by code; returns null when the code is unknown. */
  async getByCode(code: string): Promise<CachedChannel | null> {
    const cached = await this.cache.get(code);
    if (cached.hit) return cached.value;

    const em = this.emFactory();
    const channel = await em.findOne(SalesChannel, { code });
    if (channel === null) {
      await this.cache.setNotFound(code);
      return null;
    }
    const view = toCachedChannel(channel);
    await this.cache.set(code, view);
    return view;
  }

  /**
   * Resolve a code to an *active* channel. Returns one of:
   *   - { ok: true, channel }
   *   - { ok: false, error: 'unknown_sales_channel' }
   *   - { ok: false, error: 'inactive_sales_channel' }
   *
   * Used by the middleware after it has picked a code from the request.
   */
  async resolveActive(
    code: string,
  ): Promise<
    | { ok: true; channel: CachedChannel }
    | { ok: false; error: ResolverError['kind']; code: string }
  > {
    const channel = await this.getByCode(code);
    if (channel === null) return { ok: false, error: 'unknown_sales_channel', code };
    if (!channel.active) return { ok: false, error: 'inactive_sales_channel', code };
    return { ok: true, channel };
  }

  /** Returns the system-default channel; used as the storefront/integration fallback. */
  async getSystemDefault(): Promise<CachedChannel | null> {
    const em = this.emFactory();
    const channel = await em.findOne(SalesChannel, { systemDefault: true });
    if (channel === null) return null;
    const view = toCachedChannel(channel);
    // Make the system-default channel cheap to find on the next call too.
    await this.cache.set(view.code, view);
    return view;
  }

  /** Look up a channel code from the host header using the env-configured map. */
  resolveHost(host: string | undefined): string | null {
    if (!host) return null;
    // Normalise — ioredis-style hosts may carry `:port`.
    const bare = host.split(':')[0]!.toLowerCase();
    return this.hostMap.get(bare) ?? null;
  }
}

/**
 * Parse `SALES_CHANNEL_HOST_MAP`. Format:
 *
 *     "host=channelCode,host=channelCode"
 *
 * Whitespace and trailing commas are tolerated; empty input → empty map.
 * Hosts are lowercased; unparseable entries are silently skipped.
 */
export function parseHostMap(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw.trim()) return map;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0 || eq === trimmed.length - 1) continue;
    const host = trimmed.slice(0, eq).trim().toLowerCase();
    const code = trimmed.slice(eq + 1).trim();
    if (host && code) map.set(host, code);
  }
  return map;
}
