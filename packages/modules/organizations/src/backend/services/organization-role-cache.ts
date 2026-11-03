import type { OrganizationRoleKind } from '@endora-commerce/contracts';

/**
 * `OrganizationRoleCache` — an Organization's roles and their grants, per
 * process (`specs/170-organization-roles/`, research R-16;
 * `contracts/organization-permission-port.md` §4; FR-080, FR-081, FR-082).
 *
 * Modelled on `custom_fields`' definitions cache rather than the kernel's
 * two-layer sales-channel cache: the source read is one indexed query of at
 * most 52 rows, so a shared Redis value layer would save little and bring the
 * drop-marks machinery whose only purpose is to stop a shared layer re-pinning
 * a stale value.
 *
 *  - **Key** `organizationId`; **value** every role of that Organization with
 *    its kind, grants and member-defaults ledger. Never an assignment: the
 *    member's role id travels on the actor and is read fresh on every request
 *    (R-15), so an assignment change needs no drop.
 *  - **Bounded.** An LRU of {@link ORGANIZATION_ROLE_CACHE_CAPACITY}
 *    Organizations, and an entry older than {@link ORGANIZATION_ROLE_CACHE_MAX_AGE_MS}
 *    is read again: a lost announcement costs at most that long (FR-081).
 *  - **Racing fills.** A load that began before a drop read the table as it was;
 *    it is answered to its caller and not stored, so a drop is never undone by
 *    a slow read.
 *  - **Drop.** The service that ran an `organization_role.*` Command calls
 *    {@link OrganizationRoleCache.dropAndAnnounce} **after** the bus resolved,
 *    i.e. after commit: the local entry goes at once (the writing process sees
 *    its change immediately) and the drop is published on
 *    {@link ORGANIZATION_ROLES_CHANGED_CHANNEL} for every other process. A
 *    publish failure is logged and swallowed — the age bound still holds.
 *  - **Never open.** A miss reads PostgreSQL; a failed read is the caller's
 *    error and nothing is stored (FR-082).
 *
 * The Redis clients are typed structurally so this module needs no client
 * library of its own: the composition's `redis` and `redisSubscriber` satisfy
 * both shapes.
 */

/** The pub/sub channel every composed process listens on. */
export const ORGANIZATION_ROLES_CHANGED_CHANNEL = 'b2b:organization-roles:changed';
/** An entry older than this is read again, whatever was or was not announced. */
export const ORGANIZATION_ROLE_CACHE_MAX_AGE_MS = 30_000;
/** How many Organizations one process keeps. */
export const ORGANIZATION_ROLE_CACHE_CAPACITY = 4096;

/** One role as the permission port reads it. */
export interface CachedOrganizationRole {
  readonly id: string;
  readonly kind: OrganizationRoleKind;
  /** The custom role's name; `null` (or absent) for the predefined two. */
  readonly name?: string | null;
  readonly permissions: ReadonlySet<string>;
  readonly memberDefaultsOffered: ReadonlySet<string>;
}

/** Every role of one Organization, by id. */
export type CachedOrganizationRoles = ReadonlyMap<string, CachedOrganizationRole>;

/** The publishing half of a Redis client. */
export interface OrganizationRolePublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

/** The subscribing half of a Redis client (a connection in subscriber mode). */
export interface OrganizationRoleSubscriber {
  subscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

export interface OrganizationRoleCacheDeps {
  /** The source read: every role of one Organization. */
  readonly loader: (organizationId: string) => Promise<CachedOrganizationRoles>;
  readonly publisher?: OrganizationRolePublisher;
  readonly now?: () => number;
  readonly capacity?: number;
  readonly logWarn?: (message: string, context: Record<string, unknown>) => void;
}

interface Entry {
  readonly value: CachedOrganizationRoles;
  readonly loadedAt: number;
}

export class OrganizationRoleCache {
  /** Insertion order is recency order: a hit is re-inserted at the end. */
  private readonly entries = new Map<string, Entry>();
  private generation = 0;
  private subscribed = false;
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly logWarn: (message: string, context: Record<string, unknown>) => void;

  constructor(private readonly deps: OrganizationRoleCacheDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.capacity = deps.capacity ?? ORGANIZATION_ROLE_CACHE_CAPACITY;
    this.logWarn =
      deps.logWarn ?? ((message, context) => console.warn(`[organizations] ${message}`, context));
  }

  /** The Organization's roles, from memory when fresh, else from the source. */
  async get(organizationId: string): Promise<CachedOrganizationRoles> {
    const hit = this.entries.get(organizationId);
    if (hit && this.now() - hit.loadedAt < ORGANIZATION_ROLE_CACHE_MAX_AGE_MS) {
      this.entries.delete(organizationId);
      this.entries.set(organizationId, hit);
      return hit.value;
    }
    const generation = this.generation;
    const value = await this.deps.loader(organizationId);
    if (generation === this.generation) this.store(organizationId, value);
    return value;
  }

  /** Drop one Organization's entry in this process (all of them when omitted). */
  invalidateLocal(organizationId?: string): void {
    this.generation += 1;
    if (organizationId === undefined) this.entries.clear();
    else this.entries.delete(organizationId);
  }

  /**
   * Drop locally, then tell every other process. Called after a role Command
   * committed — never before, and never for one that rolled back.
   */
  async dropAndAnnounce(organizationId: string): Promise<void> {
    this.invalidateLocal(organizationId);
    if (!this.deps.publisher) return;
    try {
      await this.deps.publisher.publish(ORGANIZATION_ROLES_CHANGED_CHANNEL, JSON.stringify({ organizationId }));
    } catch (error) {
      // Not a port call: the publisher is a Redis client. Degraded, not open —
      // other processes re-read within the age bound.
      this.logWarn('the organization-role drop could not be announced', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Listen for other processes' drops. Idempotent. */
  async start(subscriber: OrganizationRoleSubscriber): Promise<void> {
    if (this.subscribed) return;
    this.subscribed = true;
    await subscriber.subscribe(ORGANIZATION_ROLES_CHANGED_CHANNEL);
    subscriber.on('message', (channel, message) => {
      if (channel !== ORGANIZATION_ROLES_CHANGED_CHANNEL) return;
      this.handleMessage(message);
    });
  }

  /** Apply one announcement; an unreadable one drops everything. */
  handleMessage(message: string): void {
    try {
      const parsed = JSON.parse(message) as { organizationId?: unknown };
      if (typeof parsed.organizationId === 'string') this.invalidateLocal(parsed.organizationId);
      else this.invalidateLocal();
    } catch {
      this.invalidateLocal();
    }
  }

  private store(organizationId: string, value: CachedOrganizationRoles): void {
    this.entries.delete(organizationId);
    this.entries.set(organizationId, { value, loadedAt: this.now() });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
