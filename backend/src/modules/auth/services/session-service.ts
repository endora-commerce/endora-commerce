import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import { Session } from '../entities/session.entity.js';

/**
 * Session lifecycle. Persists to Postgres as the source of truth; caches hot reads in
 * Redis to cut per-request latency (R-11).
 *
 * Cookie format: `${sessionId}.${rawToken}`. We store the SHA-256 of rawToken as
 * `tokenHash`. Lookups validate sessionId → row → timing-safe equal on the hash.
 */

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REDIS_KEY_PREFIX = 'session:';

export type SessionKind = 'customer' | 'admin' | 'impersonation';

export interface CreateSessionInput {
  kind: SessionKind;
  customerAccountId?: string;
  adminUserId?: string;
  impersonatorAdminUserId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionCookiePayload {
  cookieValue: string;
  expiresAt: Date;
  session: Session;
}

export interface ResolvedSession {
  session: Session;
  kind: SessionKind;
}

export class SessionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly redis: Redis,
  ) {}

  async createSession(input: CreateSessionInput): Promise<SessionCookiePayload> {
    const em = this.emFactory();
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1_000);

    const session = em.create(Session, {
      tokenHash,
      expiresAt,
      ...(input.customerAccountId !== undefined ? { customerAccountId: input.customerAccountId } : {}),
      ...(input.adminUserId !== undefined ? { adminUserId: input.adminUserId } : {}),
      ...(input.impersonatorAdminUserId !== undefined
        ? { impersonatorAdminUserId: input.impersonatorAdminUserId }
        : {}),
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });
    await em.persistAndFlush(session);
    await this.cache(session);

    return {
      cookieValue: `${session.id}.${rawToken}`,
      expiresAt,
      session,
    };
  }

  async loadSession(cookieValue: string): Promise<ResolvedSession | null> {
    const dot = cookieValue.indexOf('.');
    if (dot === -1) return null;
    const sessionId = cookieValue.slice(0, dot);
    const rawToken = cookieValue.slice(dot + 1);
    if (!sessionId || !rawToken) return null;

    const expectedHash = sha256Hex(rawToken);

    const cached = await this.redis.get(REDIS_KEY_PREFIX + sessionId);
    if (cached) {
      const parsed = JSON.parse(cached) as { tokenHash: string; expiresAt: string; session: SerialisedSession };
      if (!timingSafeEqual(parsed.tokenHash, expectedHash)) return null;
      if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
      return { session: deserialise(parsed.session), kind: deriveKind(parsed.session) };
    }

    const em = this.emFactory();
    const session = await em.findOne(Session, { id: sessionId });
    if (!session) return null;
    if (!timingSafeEqual(session.tokenHash, expectedHash)) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    await this.cache(session);
    return { session, kind: deriveKind(session) };
  }

  async destroySession(sessionId: string): Promise<void> {
    const em = this.emFactory();
    const session = await em.findOne(Session, { id: sessionId });
    if (session) {
      await em.removeAndFlush(session);
    }
    await this.redis.del(REDIS_KEY_PREFIX + sessionId);
  }

  /**
   * Revoke every active session for a Customer — used when an account is
   * blocked or soft-deleted so it loses access promptly (feature 040,
   * FR-016/SC-002). Clears both the Postgres rows and their Redis caches.
   */
  async destroyAllForCustomer(customerAccountId: string): Promise<void> {
    const em = this.emFactory();
    const sessions = await em.find(Session, { customerAccountId });
    if (sessions.length === 0) return;
    for (const session of sessions) {
      await this.redis.del(REDIS_KEY_PREFIX + session.id);
    }
    await em.removeAndFlush(sessions);
  }

  private async cache(session: Session): Promise<void> {
    const ttl = Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1_000));
    const payload = {
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt.toISOString(),
      session: serialise(session),
    };
    await this.redis.set(REDIS_KEY_PREFIX + session.id, JSON.stringify(payload), 'EX', ttl);
  }
}

type SerialisedSession = {
  id: string;
  tokenHash: string;
  customerAccountId: string | null;
  adminUserId: string | null;
  impersonatorAdminUserId: string | null;
  expiresAt: string;
};

function serialise(session: Session): SerialisedSession {
  return {
    id: session.id,
    tokenHash: session.tokenHash,
    customerAccountId: session.customerAccountId ?? null,
    adminUserId: session.adminUserId ?? null,
    impersonatorAdminUserId: session.impersonatorAdminUserId ?? null,
    expiresAt: session.expiresAt.toISOString(),
  };
}

function deserialise(s: SerialisedSession): Session {
  const session = new Session();
  session.id = s.id;
  session.tokenHash = s.tokenHash;
  session.customerAccountId = s.customerAccountId;
  session.adminUserId = s.adminUserId;
  session.impersonatorAdminUserId = s.impersonatorAdminUserId;
  session.expiresAt = new Date(s.expiresAt);
  return session;
}

function deriveKind(session: Pick<Session, 'customerAccountId' | 'adminUserId' | 'impersonatorAdminUserId'>): SessionKind {
  if (session.impersonatorAdminUserId) return 'impersonation';
  if (session.adminUserId) return 'admin';
  return 'customer';
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
