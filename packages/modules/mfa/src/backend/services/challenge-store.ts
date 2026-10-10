import type { Redis } from 'ioredis';
import { randomBytes } from 'crypto';

/**
 * Short-lived, server-held login state in Redis (feature 042, R4/R9).
 *
 * Three kinds of ephemeral token, all TTL-bounded so abandonment never
 * materializes into a session:
 *   - pending-login challenge (`mfa:chal:<id>`) — after a correct password,
 *     before the second factor; carries an attempt budget, and the attempts
 *     taken from it are counted beside it (`mfa:chal-attempts:<id>`);
 *   - setup ticket (`mfa:setup:<id>`) — enforced-but-unenrolled subject, may
 *     only call the enrolment endpoints until activation;
 *   - OAuth transaction (`mfa:oauth:<state>`) — PKCE verifier + nonce + next.
 */
const CHAL_PREFIX = 'mfa:chal:';
const ATTEMPTS_PREFIX = 'mfa:chal-attempts:';
const SETUP_PREFIX = 'mfa:setup:';
const OAUTH_PREFIX = 'mfa:oauth:';
const GENERATION_PREFIX = 'mfa:gen:';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const SETUP_TTL_SECONDS = 10 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;
const DEFAULT_ATTEMPT_BUDGET = 5;

export interface PendingChallenge {
  subjectType: 'customer' | 'admin';
  subjectId: string;
  salesChannelId: string | null;
  /** The budget the challenge was issued with. What is left of it: `takeAttempt`. */
  attemptsRemaining: number;
  /** The subject's generation when this was issued — see `invalidateSubject`. */
  generation?: number;
}

export interface SetupTicket {
  subjectType: 'customer' | 'admin';
  subjectId: string;
  salesChannelId: string | null;
  /** The subject's generation when this was issued — see `invalidateSubject`. */
  generation?: number;
}

export interface OAuthTransaction {
  surface: 'customer' | 'admin';
  provider: 'google' | 'microsoft';
  salesChannelId: string | null;
  pkceVerifier: string;
  nonce: string;
  next: string;
}

function generationKey(subjectType: 'customer' | 'admin', subjectId: string): string {
  return `${GENERATION_PREFIX}${subjectType}:${subjectId}`;
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export class ChallengeStore {
  constructor(private readonly redis: Redis) {}

  // --- invalidation by subject ------------------------------------------------

  /**
   * Withdraw every challenge and setup ticket issued for the subject so far.
   *
   * Both are issued after a password verified, and neither is indexed by
   * subject, so they are not searched for: each carries the subject's
   * *generation* at the moment it was issued, and this bumps the generation. A
   * read then treats an artefact from an older generation as absent. A counter
   * rather than a timestamp, so it does not depend on two servers agreeing
   * what time it is; and it is never expired, because an expired counter would
   * read as zero and let through an artefact issued before it lapsed.
   *
   * The generation is read *before* the artefact is written, so an
   * invalidation that lands between the two leaves the artefact stamped with
   * the older generation — withdrawn, which is the safe side.
   */
  async invalidateSubject(subjectType: 'customer' | 'admin', subjectId: string): Promise<void> {
    await this.redis.incr(generationKey(subjectType, subjectId));
  }

  private async generationOf(subjectType: 'customer' | 'admin', subjectId: string): Promise<number> {
    const raw = await this.redis.get(generationKey(subjectType, subjectId));
    return raw ? Number(raw) : 0;
  }

  /** `null` for an artefact issued before the subject's last invalidation. */
  private async current<T extends { subjectType: 'customer' | 'admin'; subjectId: string; generation?: number }>(
    artefact: T | null,
  ): Promise<T | null> {
    if (!artefact) return null;
    const generation = await this.generationOf(artefact.subjectType, artefact.subjectId);
    return (artefact.generation ?? 0) < generation ? null : artefact;
  }

  // --- pending-login challenge ---------------------------------------------

  async issueChallenge(
    input: Omit<PendingChallenge, 'attemptsRemaining' | 'generation'>,
    attemptBudget = DEFAULT_ATTEMPT_BUDGET,
  ): Promise<string> {
    const id = newToken();
    const payload: PendingChallenge = {
      ...input,
      attemptsRemaining: attemptBudget,
      generation: await this.generationOf(input.subjectType, input.subjectId),
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
    return this.current(raw ? (JSON.parse(raw) as PendingChallenge) : null);
  }

  /**
   * Take one attempt from the challenge's budget, **before** the code is
   * checked. Answers how many are left afterwards, or `-1` when there was none
   * to take — the challenge is then burned.
   *
   * The count is one `INCR`, so of any number of attempts taken at the same
   * time exactly the budget are admitted. The budget used to be read, the code
   * checked, and the budget written back: codes sent together were all checked
   * against the same unspent budget, and five was not a limit.
   */
  async takeAttempt(id: string): Promise<number> {
    const challenge = await this.getChallenge(id);
    if (!challenge) return -1;
    const taken = await this.redis.incr(ATTEMPTS_PREFIX + id);
    // Collected with the challenge it counts for, whatever happens to it.
    await this.redis.expire(ATTEMPTS_PREFIX + id, CHALLENGE_TTL_SECONDS);
    const remaining = challenge.attemptsRemaining - taken;
    if (remaining < 0) {
      await this.consumeChallenge(id);
      return -1;
    }
    return remaining;
  }

  /** Give back an attempt whose code was never checked. */
  async returnAttempt(id: string): Promise<void> {
    await this.redis.decr(ATTEMPTS_PREFIX + id);
  }

  async consumeChallenge(id: string): Promise<void> {
    await this.redis.del(CHAL_PREFIX + id);
  }

  // --- setup ticket ---------------------------------------------------------

  async issueSetupTicket(input: Omit<SetupTicket, 'generation'>): Promise<string> {
    const id = newToken();
    const payload: SetupTicket = {
      ...input,
      generation: await this.generationOf(input.subjectType, input.subjectId),
    };
    await this.redis.set(
      SETUP_PREFIX + id,
      JSON.stringify(payload),
      'EX',
      SETUP_TTL_SECONDS,
    );
    return id;
  }

  async getSetupTicket(id: string): Promise<SetupTicket | null> {
    const raw = await this.redis.get(SETUP_PREFIX + id);
    return this.current(raw ? (JSON.parse(raw) as SetupTicket) : null);
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
