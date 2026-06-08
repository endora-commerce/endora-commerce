import type Redis from 'ioredis';
import { randomBytes } from 'crypto';

/**
 * Short-lived, server-held login state in Redis (feature 042, R4/R9).
 *
 * Three kinds of ephemeral token, all TTL-bounded so abandonment never
 * materializes into a session:
 *   - pending-login challenge (`mfa:chal:<id>`) — after a correct password,
 *     before the second factor; carries an attempt budget;
 *   - setup ticket (`mfa:setup:<id>`) — enforced-but-unenrolled subject, may
 *     only call the enrolment endpoints until activation;
 *   - OAuth transaction (`mfa:oauth:<state>`) — PKCE verifier + nonce + next.
 */
const CHAL_PREFIX = 'mfa:chal:';
const SETUP_PREFIX = 'mfa:setup:';
const OAUTH_PREFIX = 'mfa:oauth:';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const SETUP_TTL_SECONDS = 10 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;
const DEFAULT_ATTEMPT_BUDGET = 5;

export interface PendingChallenge {
  subjectType: 'customer' | 'admin';
  subjectId: string;
  salesChannelId: string | null;
  attemptsRemaining: number;
}

export interface SetupTicket {
  subjectType: 'customer' | 'admin';
  subjectId: string;
  salesChannelId: string | null;
}

export interface OAuthTransaction {
  surface: 'customer' | 'admin';
  provider: 'google' | 'microsoft';
  salesChannelId: string | null;
  pkceVerifier: string;
  nonce: string;
  next: string;
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export class ChallengeStore {
  constructor(private readonly redis: Redis) {}

  // --- pending-login challenge ---------------------------------------------

  async issueChallenge(
    input: Omit<PendingChallenge, 'attemptsRemaining'>,
    attemptBudget = DEFAULT_ATTEMPT_BUDGET,
  ): Promise<string> {
    const id = newToken();
    const payload: PendingChallenge = {
      ...input,
      attemptsRemaining: attemptBudget,
    };
    await this.redis.set(
      CHAL_PREFIX + id,
      JSON.stringify(payload),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
    return id;
  }

  async getChallenge(id: string): Promise<PendingChallenge | null> {
    const raw = await this.redis.get(CHAL_PREFIX + id);
    return raw ? (JSON.parse(raw) as PendingChallenge) : null;
  }

  /**
   * Record a failed attempt: decrement the budget and burn the challenge when
   * it reaches zero. Returns the remaining budget (0 ⇒ burned).
   */
  async recordFailedAttempt(id: string): Promise<number> {
    const challenge = await this.getChallenge(id);
    if (!challenge) return 0;
    const remaining = challenge.attemptsRemaining - 1;
    if (remaining <= 0) {
      await this.consumeChallenge(id);
      return 0;
    }
    const ttl = await this.redis.ttl(CHAL_PREFIX + id);
    await this.redis.set(
      CHAL_PREFIX + id,
      JSON.stringify({ ...challenge, attemptsRemaining: remaining }),
      'EX',
      ttl > 0 ? ttl : CHALLENGE_TTL_SECONDS,
    );
    return remaining;
  }

  async consumeChallenge(id: string): Promise<void> {
    await this.redis.del(CHAL_PREFIX + id);
  }

  // --- setup ticket ---------------------------------------------------------

  async issueSetupTicket(input: SetupTicket): Promise<string> {
    const id = newToken();
    await this.redis.set(
      SETUP_PREFIX + id,
      JSON.stringify(input),
      'EX',
      SETUP_TTL_SECONDS,
    );
    return id;
  }

  async getSetupTicket(id: string): Promise<SetupTicket | null> {
    const raw = await this.redis.get(SETUP_PREFIX + id);
    return raw ? (JSON.parse(raw) as SetupTicket) : null;
  }

  async consumeSetupTicket(id: string): Promise<void> {
    await this.redis.del(SETUP_PREFIX + id);
  }

  // --- OAuth transaction ----------------------------------------------------

  /** The `state` value is returned to the provider and echoed on callback. */
  async issueOAuthTransaction(input: OAuthTransaction): Promise<string> {
    const state = newToken();
    await this.redis.set(
      OAUTH_PREFIX + state,
      JSON.stringify(input),
      'EX',
      OAUTH_TTL_SECONDS,
    );
    return state;
  }

  async getOAuthTransaction(state: string): Promise<OAuthTransaction | null> {
    const raw = await this.redis.get(OAUTH_PREFIX + state);
    return raw ? (JSON.parse(raw) as OAuthTransaction) : null;
  }

  async consumeOAuthTransaction(state: string): Promise<void> {
    await this.redis.del(OAUTH_PREFIX + state);
  }
}
