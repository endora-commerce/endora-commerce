import type { Redis } from 'ioredis';
import { createHash, randomBytes } from 'crypto';
import { FEDERATED_SIGN_IN_HANDOFF_TTL_SECONDS } from '@endora-commerce/contracts';

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
 *   - OAuth transaction (`mfa:oauth:<state>`) — PKCE verifier + nonce + next,
 *     and the digest of the cookie binding it to the browser that started it;
 *   - federated sign-in hand-off (`mfa:oauth:handoff:<sha256 of the code>`,
 *     issue #1279) — what a customer callback leaves for the storefront to
 *     redeem. A `state` is base64url and never contains `:`, so the two key
 *     spaces cannot meet.
 */
const CHAL_PREFIX = 'mfa:chal:';
const ATTEMPTS_PREFIX = 'mfa:chal-attempts:';
const SETUP_PREFIX = 'mfa:setup:';
const OAUTH_PREFIX = 'mfa:oauth:';
const GENERATION_PREFIX = 'mfa:gen:';
const HANDOFF_PREFIX = 'mfa:oauth:handoff:';

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
  /**
   * The language of the storefront page that started the sign-in (feature 167),
   * so the pages it returns to carry that language's prefix. Absent in a
   * transaction issued before the field existed.
   */
  language?: string | null;
  /**
   * SHA-256 (hex) of the browser-binding cookie `start` set. The callback
   * completes only for a browser presenting the cookie this digest was taken
   * of; the cookie value itself is never stored.
   */
  browserBinding: string;
  /**
   * Issue #1279 — SHA-256 (hex) of the secret the storefront put in its own
   * `b2b_federated_binding` cookie before sending the browser to `start`. The
   * hand-off the callback leaves is redeemed only by a caller presenting that
   * secret. Customer surface only; absent on the admin surface.
   */
  storefrontBindingDigest?: string;
}

/**
 * Issue #1279 — what a successful customer callback leaves for the storefront
 * to redeem (`POST /api/v1/auth/customer/oauth/exchange`). The callback sets no
 * cookie: the session is created when this is redeemed, on the storefront's
 * server-to-server call, which also carries the browser's storefront cookies.
 *
 * Keyed by the SHA-256 of the code; the code itself is never stored. Single
 * use: it is read and deleted in one step, whatever the outcome.
 */
interface FederatedHandoffCommon {
  /** The customer the sign-in resolved to; also the subject of the generation check. */
  customerAccountId: string;
  /** The channel the transaction was started on; the exchange must be asked on it. */
  salesChannelId: string | null;
  /** Where the storefront sends the browser afterwards; root-relative, language-prefixed. */
  redirectPath: string;
  /** SHA-256 (hex) of the storefront's binding secret, from the transaction. */
  storefrontBindingDigest: string;
  /** The subject's generation when this was issued — see `invalidateSubject`. */
  generation: number;
}

export type FederatedHandoff =
  | (FederatedHandoffCommon & { kind: 'session'; organizationId: string | null })
  | (FederatedHandoffCommon & { kind: 'mfaChallenge'; challengeId: string });

/** `FederatedHandoff` as issued: the store stamps the generation itself. */
export type FederatedHandoffInput =
  | Omit<Extract<FederatedHandoff, { kind: 'session' }>, 'generation'>
  | Omit<Extract<FederatedHandoff, { kind: 'mfaChallenge' }>, 'generation'>;

/**
 * Count one attempt and (re)arm the counter's expiry in the same step, so the
 * counter is collected with the challenge it counts for whatever happens to
 * the caller in between. KEYS[1] the counter, ARGV[1] its lifetime in seconds.
 */
const TAKE_ATTEMPT_SCRIPT = `
local taken = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
return taken
`;

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
   * checked. Answers how many are left afterwards; `-1` when there was none to
   * take — the challenge is then burned; and `null` when there is no such
   * challenge any more — consumed, expired or withdrawn — which is "start
   * over" rather than "too many attempts".
   *
   * The count is one script, so of any number of attempts taken at the same
   * time exactly the budget are admitted, and the counter can never be left
   * without an expiry. The budget used to be read, the code checked, and the
   * budget written back: codes sent together were all checked against the same
   * unspent budget, and five was not a limit.
   */
  async takeAttempt(id: string): Promise<number | null> {
    const challenge = await this.getChallenge(id);
    if (!challenge) return null;
    const taken = Number(
      await this.redis.eval(TAKE_ATTEMPT_SCRIPT, 1, ATTEMPTS_PREFIX + id, CHALLENGE_TTL_SECONDS),
    );
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

  // --- federated sign-in hand-off (issue #1279) -----------------------------

  /**
   * Store a hand-off and answer the code the browser carries to the storefront,
   * with the hex digest it is stored under (`codeDigest`, for logging a prefix
   * of; never log the code). Lives `FEDERATED_SIGN_IN_HANDOFF_TTL_SECONDS`.
   */
  async issueFederatedHandoff(input: FederatedHandoffInput): Promise<{ code: string; codeDigest: string }> {
    const code = newToken();
    const codeDigest = sha256Hex(code);
    const payload: FederatedHandoff = {
      ...input,
      generation: await this.generationOf('customer', input.customerAccountId),
    } as FederatedHandoff;
    await this.redis.set(
      HANDOFF_PREFIX + codeDigest,
      JSON.stringify(payload),
      'EX',
      FEDERATED_SIGN_IN_HANDOFF_TTL_SECONDS,
    );
    return { code, codeDigest };
  }

  /**
   * Read and delete the hand-off in one step (`GETDEL`), so of any number of
   * concurrent attempts exactly one gets it, and a failed attempt has used it
   * up as well. `null` for a code never issued, expired or already taken. The
   * generation is not applied here — `isCurrentGeneration` is — so the caller
   * can log which check refused it.
   */
  async takeFederatedHandoff(code: string): Promise<FederatedHandoff | null> {
    const raw = await this.redis.getdel(HANDOFF_PREFIX + sha256Hex(code));
    return raw ? (JSON.parse(raw) as FederatedHandoff) : null;
  }

  /** Whether an artefact stamped with `generation` survived every invalidation since. */
  async isCurrentGeneration(
    subjectType: 'customer' | 'admin',
    subjectId: string,
    generation: number,
  ): Promise<boolean> {
    return generation >= (await this.generationOf(subjectType, subjectId));
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
