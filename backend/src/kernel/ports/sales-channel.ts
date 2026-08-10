import type { ChannelMemberEntityType } from '@b2b/contracts';
import type { CachedChannel } from '../../modules/sales_channels/services/sales-channels-cache.js';
import type {
  MembershipMutationOptions,
  MembershipMutationResult,
} from '../../modules/sales_channels/services/sales-channel-membership.service.js';
import type { SalesChannel } from '../../modules/sales_channels/entities/sales-channel.entity.js';

/**
 * Kernel port — sales-channel resolution and the membership/bridge accessors
 * (feature 072, D-32; Constitution XII).
 *
 * Channel resolution is a platform concern: 49 call sites read the resolved
 * channel, and the resolution order is a refusal contract, not a module
 * preference. The resolver, its cache and the bridge accessors move into the
 * kernel; `sales-channels.service.ts` (the admin CRUD surface, zero external
 * importers) and `routes.admin.ts` stay in the module.
 *
 * Resolution order and refusal behaviour are unchanged by this port: bound
 * API-key binding → `X-Sales-Channel` header → `?salesChannel=` (ignored on
 * `/api/v1/admin/*`) → host map → system default. An unknown or inactive channel
 * refuses and never falls back.
 */
export interface SalesChannelResolutionPort {
  /** Lookup by code; `null` when the code is unknown. */
  getByCode(code: string): Promise<CachedChannel | null>;

  /** Lookup by id — a bound API key pins its channel by id, not code. */
  getById(id: string): Promise<CachedChannel | null>;

  /** Resolve a code to an *active* channel, distinguishing unknown from inactive. */
  resolveActive(
    code: string,
  ): Promise<
    | { ok: true; channel: CachedChannel }
    | { ok: false; error: 'unknown_sales_channel' | 'inactive_sales_channel'; code: string }
  >;

  /** The system-default channel, used as the storefront/integration fallback. */
  getSystemDefault(): Promise<CachedChannel | null>;

  /** Map a `Host` header onto a channel code via the env-configured host map. */
  resolveHost(host: string | undefined): string | null;
}

/**
 * The membership bridge tables (`sales_channel_<entity>`). Every module that
 * scopes its own rows to a channel goes through this rather than writing the
 * bridge table itself — the sanctioned bridge accessor of Constitution XII.
 */
export interface SalesChannelMembershipPort {
  addToChannel(
    channelId: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
    options?: MembershipMutationOptions,
  ): Promise<MembershipMutationResult>;

  removeFromChannel(
    channelId: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
    options?: MembershipMutationOptions,
  ): Promise<MembershipMutationResult>;

  /** Bind an entity to the system-default channel when it belongs to none (FR-008). */
  bindToDefaultIfEmpty(
    entityType: ChannelMemberEntityType,
    entityId: string,
  ): Promise<MembershipMutationResult>;

  /** Channels an entity currently belongs to. */
  listChannelsForEntity(
    entityType: ChannelMemberEntityType,
    entityId: string,
  ): Promise<SalesChannel[]>;

  /** Entity ids of `entityType` that currently belong to `channelId`. */
  listEntityIdsForChannel(
    channelId: string,
    entityType: ChannelMemberEntityType,
    page?: number,
    pageSize?: number,
  ): Promise<{ entityIds: string[]; total: number }>;
}

/** The channel resolved for the current scoped execution, or `null` outside HTTP. */
export type ResolvedChannel = CachedChannel;
