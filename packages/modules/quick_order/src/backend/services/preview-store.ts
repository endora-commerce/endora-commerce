import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  QUICK_ORDER_PREVIEW_TTL_SECONDS,
  quickOrderPreviewSchema,
  type QuickOrderPreview,
} from '@endora-commerce/contracts';

/**
 * Issue #809 — the buyer's quick-order preview, between the import and the build.
 *
 * It lived in the storefront's own httpOnly cookie (#805), whose size the reverse proxy's default
 * header buffers capped at about 3 000 characters — a few dozen lines. It lives here instead, in
 * Redis, so it can hold what the import produces (`QUICK_ORDER_PREVIEW_MAX_LINES`).
 *
 * **One preview per buyer session, scoped to the tenant** (Principle XI). The key names the
 * buyer's Organization, the buyer, and a digest of the session credential the request presented:
 * a second session of the same buyer, a buyer of another Organization, or the same credential
 * replayed under another Organization all address a different key. The value records the
 * Organization and the buyer again and a read checks them, so a value can only be read by the
 * owner its key names. The raw credential is never stored or put in a key — the digest is
 * domain-separated, so it is not the hash `auth` stores either.
 *
 * **The TTL is a write's.** `put` sets it; `get` is a plain `GET` and leaves it as it was, so a
 * page left open does not keep the buyer's file alive. An expired preview simply reads as `null`.
 *
 * It is ephemeral per-session state, like the cookie it replaces, not a domain write: nothing is
 * audited and nothing is undone, so it does not go through the Command Bus.
 */

const KEY_PREFIX = 'b2b:quick_order:preview:';
const SESSION_DIGEST_DOMAIN = 'quick_order.preview\u0000';

/** Who a preview belongs to: the authenticated buyer, their Organization and their session. */
export interface QuickOrderPreviewOwner {
  organizationId: string;
  customerAccountId: string;
  /** The session credential the request presented (the `b2b_session` cookie value). */
  sessionToken: string;
}

interface StoredPreview {
  organizationId: string;
  customerAccountId: string;
  preview: QuickOrderPreview;
}

export class QuickOrderPreviewStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number = QUICK_ORDER_PREVIEW_TTL_SECONDS,
  ) {}

  static keyFor(owner: QuickOrderPreviewOwner): string {
    const session = createHash('sha256')
      .update(SESSION_DIGEST_DOMAIN)
      .update(owner.sessionToken)
      .digest('base64url');
    return `${KEY_PREFIX}${owner.organizationId}:${owner.customerAccountId}:${session}`;
  }

  async get(owner: QuickOrderPreviewOwner): Promise<QuickOrderPreview | null> {
    const key = QuickOrderPreviewStore.keyFor(owner);
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    const stored = parseStored(raw);
    if (!stored) {
      // Unreadable — a shape from another version, or a damaged value. The buyer imports again,
      // which is what an expired preview asks of them too.
      await this.redis.del(key);
      return null;
    }
    if (stored.organizationId !== owner.organizationId || stored.customerAccountId !== owner.customerAccountId) {
      return null;
    }
    return stored.preview;
  }

  async put(owner: QuickOrderPreviewOwner, preview: QuickOrderPreview): Promise<void> {
    const stored: StoredPreview = {
      organizationId: owner.organizationId,
      customerAccountId: owner.customerAccountId,
      preview,
    };
    await this.redis.set(QuickOrderPreviewStore.keyFor(owner), JSON.stringify(stored), 'EX', this.ttlSeconds);
  }

  async delete(owner: QuickOrderPreviewOwner): Promise<void> {
    await this.redis.del(QuickOrderPreviewStore.keyFor(owner));
  }
}

function parseStored(raw: string): StoredPreview | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { organizationId, customerAccountId, preview } = value as Record<string, unknown>;
  if (typeof organizationId !== 'string' || typeof customerAccountId !== 'string') return null;
  const parsed = quickOrderPreviewSchema.safeParse(preview);
  return parsed.success ? { organizationId, customerAccountId, preview: parsed.data } : null;
}
