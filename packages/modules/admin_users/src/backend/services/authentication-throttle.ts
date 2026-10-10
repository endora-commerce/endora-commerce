import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import {
  ERROR_CODES,
  type AdminAuthenticationAttempt,
  type AdminAuthenticationCheckResult,
  type AdminAuthenticationThrottlePort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort, PlatformLogger } from '@endora-commerce/platform/kernel';

/**
 * Throttles repeated wrong passwords and wrong second-factor codes for an
 * administrator account.
 *
 * ## What it counts
 *
 * **An attempt is taken before the credential is looked at**, in one atomic
 * Redis script, and settled afterwards as a success or a failure. Counting
 * failures only after the fact leaves a window: a burst of parallel requests
 * all pass the "is it throttled" read before any of them has failed. So an
 * attempt that has been admitted and not yet settled occupies a slot, and a
 * counter admits no more than its threshold of failed-plus-unsettled attempts.
 * The ones beyond that are refused for a second (`Retry-After: 1`) and are
 * never verified.
 *
 * Which counters an attempt is held to depends on where it comes from:
 *
 * - **An origin nobody has signed in from** is held to two:
 *   **address + account** ({@link ADDRESS_POLICY}), which stops one client
 *   quickly, and **account** ({@link ACCOUNT_POLICY}), which bounds guessing
 *   spread over many addresses.
 * - **A known device** — a browser carrying the cookie a completed sign-in to
 *   this account left behind, see below — is held to one, **its own**
 *   ({@link ADDRESS_POLICY}), and is neither refused by the account counter nor
 *   counted in it.
 *
 * The account is whatever identifies it on that route — the normalised e-mail
 * address at sign-in, where it may belong to nobody, and the administrator id
 * for a second factor. An address belonging to no account is throttled exactly
 * like a real one, so the answer says nothing about which exist.
 *
 * An IPv6 client is counted by its /64, which is what one subscriber is
 * handed; counting the full address gives one machine 2^64 budgets.
 *
 * ## What it does when the threshold is reached
 *
 * It refuses every attempt until a delay has passed: one minute, then two,
 * four, eight, and fifteen at most, each started by one more failure. The
 * failures are forgotten thirty minutes after the first one, or at once on a
 * success. Nothing is locked permanently.
 *
 * **A correct credential is refused while a delay runs**, without being
 * checked. Admitting it would let the guess that happens to be right through,
 * which is the one guess the throttle exists to stop; and because nothing is
 * verified, the refusal cannot differ in content or timing between a right and
 * a wrong credential.
 *
 * ## Why a known device is exempt from the account counter
 *
 * The account counter is the only one a stranger can fill for somebody else:
 * twenty wrong passwords from a handful of addresses, a few more each half
 * hour, and without the exemption the account's holder is refused from
 * everywhere for as long as the stranger keeps going — with nothing to know
 * but the e-mail address. A device that has completed a sign-in to the account
 * is evidence the stranger cannot produce, so that device is held to its own
 * counter instead, which only its holder can fill.
 *
 * The evidence is a cookie whose value {@link issueKnownDevice} mints after a
 * completed sign-in — password and, where one is asked for, second factor — and
 * which the route signs with the server's cookie secret. It names the account,
 * a random device id, and a digest of the account's current password hash. It
 * is honoured only while that digest still matches and the account is active,
 * so a password change or a deactivation revokes every device at once with no
 * registry to forget to clear. It is not a session and admits nobody: a device
 * presenting it still has to produce the credential, inside its own budget.
 *
 * The account's row is read to check it, before the attempt is taken — but
 * only for a value the route has already verified the signature of, which a
 * party who never signed in cannot present. Every other request reaches the
 * counters without a database read, known account or not.
 *
 * ## The numbers are constants, not Settings
 *
 * The comparable limits in the tree are constants too — the second step's
 * five-code budget and its challenge lifetime in `mfa`. A Setting here would be
 * a switch that turns the protection off from the Admin UI it protects.
 *
 * ## Redis unavailable
 *
 * The attempt is refused with 503 `ADMIN_AUTHENTICATION_UNAVAILABLE` once
 * {@link DEFAULT_STORE_DEADLINE_MS} has passed, or at once when the command
 * fails. The host's client retries a command for as long as Redis is away, so
 * without the deadline the request would stay open until the caller gave up on
 * it. A take that arrives after its deadline is withdrawn again. An attempt
 * that was admitted and then could not be settled — Redis went away between
 * the two — stays unsettled and is counted as a failure by the next take, like
 * any abandoned one: an outage can leave a few attempts counted.
 *
 * ## Time
 *
 * Every timestamp is this process's clock, passed into the script. Redis expiry
 * is used only to collect keys nobody came back to.
 */
export interface AttemptPolicy {
  /** Failed or unsettled attempts admitted inside one window before a delay starts. */
  readonly threshold: number;
  /** How long the failures are remembered, measured from the first one. */
  readonly windowSeconds: number;
  /** The first delay. Each failure after it doubles the next. */
  readonly baseDelaySeconds: number;
  /** The longest delay. */
  readonly maxDelaySeconds: number;
}

/** One address on one account — and one known device on its account. */
export const ADDRESS_POLICY: AttemptPolicy = {
  threshold: 5,
  windowSeconds: 30 * 60,
  baseDelaySeconds: 60,
  maxDelaySeconds: 15 * 60,
};

/** One account, from every origin that is not a known device. */
export const ACCOUNT_POLICY: AttemptPolicy = {
  threshold: 20,
  windowSeconds: 30 * 60,
  baseDelaySeconds: 60,
  maxDelaySeconds: 15 * 60,
};

/**
 * How long an admitted attempt may stay unsettled before the next take counts
 * it as a failure. A process that died between taking and settling must not
 * leave a slot occupied until the window ends, and must not hand out a free
 * guess either.
 */
export const ABANDONED_AFTER_SECONDS = 30;

/** How long one Redis command of this class may take before the attempt is refused with 503. */
export const DEFAULT_STORE_DEADLINE_MS = 3_000;

const KEY_PREFIX = 'admin-auth-throttle:v1:';
const KNOWN_DEVICE_VERSION = 'v1';

/**
 * Shared by the two scripts that change a counter's failures: forget a window
 * that has ended, and start a delay once the threshold is reached.
 */
const COUNTER_FUNCTIONS = `
local function readCounter(key, now, window)
  local s = redis.call('HMGET', key, 'failed', 'windowStart', 'blockedUntil')
  local failed = tonumber(s[1]) or 0
  local windowStart = tonumber(s[2]) or now
  local blockedUntil = tonumber(s[3]) or 0
  if failed == 0 or now < windowStart or now - windowStart >= window then
    failed = 0
    windowStart = now
  end
  return failed, windowStart, blockedUntil
end
local function addFailures(key, now, failed, windowStart, blockedUntil, added, threshold, window, base, max)
  failed = failed + added
  local delay = 0
  if failed >= threshold then
    delay = math.min(base * 2 ^ (failed - threshold), max)
    blockedUntil = now + delay
  end
  redis.call('HSET', key,
    'failed', failed,
    'windowStart', string.format('%.0f', windowStart),
    'blockedUntil', string.format('%.0f', blockedUntil))
  redis.call('PEXPIRE', key, window + max)
  return failed, blockedUntil, delay
end
`;

/**
 * KEYS — two per counter: its state hash, then the sorted set of attempts
 * admitted and not yet settled. ARGV — the clock in milliseconds, the attempt
 * id, how old an unsettled attempt may get, then four numbers per counter:
 * threshold, window, base delay and longest delay, the last three in
 * milliseconds.
 *
 * Answers `{0, remainingMs}` when a counter is still delaying, `{0, 0}` when
 * one has no free slot, and in both cases has admitted nothing. Otherwise
 * records the attempt as unsettled on every counter and answers `{1, 0}`.
 */
const TAKE_SCRIPT = `${COUNTER_FUNCTIONS}
local now = tonumber(ARGV[1])
local abandonedBefore = now - tonumber(ARGV[3])
local counters = #KEYS / 2
local remaining = 0
local full = false
for i = 1, counters do
  local state = KEYS[2 * i - 1]
  local unsettled = KEYS[2 * i]
  local o = 3 + (i - 1) * 4
  local threshold = tonumber(ARGV[o + 1])
  local window = tonumber(ARGV[o + 2])
  local failed, windowStart, blockedUntil = readCounter(state, now, window)
  local abandoned = redis.call('ZREMRANGEBYSCORE', unsettled, '-inf', abandonedBefore)
  if abandoned > 0 then
    failed, blockedUntil = addFailures(state, now, failed, windowStart, blockedUntil, abandoned,
      threshold, window, tonumber(ARGV[o + 3]), tonumber(ARGV[o + 4]))
  end
  if blockedUntil - now > remaining then remaining = blockedUntil - now end
  local pending = redis.call('ZCARD', unsettled)
  if failed >= threshold then
    if pending > 0 then full = true end
  elseif failed + pending >= threshold then
    full = true
  end
end
if remaining > 0 then return {0, remaining} end
if full then return {0, 0} end
for i = 1, counters do
  local o = 3 + (i - 1) * 4
  redis.call('ZADD', KEYS[2 * i], now, ARGV[2])
  redis.call('PEXPIRE', KEYS[2 * i], tonumber(ARGV[o + 2]) + tonumber(ARGV[o + 4]))
end
return {1, 0}
`;

/**
 * Settle an admitted attempt as a failure. KEYS and the per-counter ARGV as in
 * {@link TAKE_SCRIPT}; ARGV[1] the clock, ARGV[2] the attempt id.
 *
 * Answers `{delayMs, mask}`: bit `i` of `mask` says counter `i` started a delay
 * with this failure and `delayMs` is the longest of them. An attempt a later
 * take has already counted as abandoned is not counted twice.
 */
const FAIL_SCRIPT = `${COUNTER_FUNCTIONS}
local now = tonumber(ARGV[1])
local mask = 0
local longest = 0
for i = 1, #KEYS / 2 do
  local state = KEYS[2 * i - 1]
  local o = 2 + (i - 1) * 4
  if redis.call('ZREM', KEYS[2 * i], ARGV[2]) == 1 then
    local window = tonumber(ARGV[o + 2])
    local failed, windowStart, blockedUntil = readCounter(state, now, window)
    local _, _, delay = addFailures(state, now, failed, windowStart, blockedUntil, 1,
      tonumber(ARGV[o + 1]), window, tonumber(ARGV[o + 3]), tonumber(ARGV[o + 4]))
    if delay > 0 then
      mask = mask + 2 ^ (i - 1)
      if delay > longest then longest = delay end
    end
  end
end
return {longest, mask}
`;

/**
 * Give an admitted attempt's slot back. With ARGV[2] `1` — a success — the
 * counters' failures are forgotten too; with `0` the attempt is withdrawn and
 * nothing else changes.
 */
const RELEASE_SCRIPT = `
for i = 1, #KEYS / 2 do
  redis.call('ZREM', KEYS[2 * i], ARGV[1])
  if ARGV[2] == '1' then redis.call('DEL', KEYS[2 * i - 1]) end
end
return 1
`;

/**
 * The Redis commands this class issues, declared structurally.
 *
 * The host's `redis` registration satisfies it. Naming the client's own type
 * would make `ioredis` a dependency of this package for the sake of one
 * annotation.
 */
export interface AttemptCounterStore {
  eval(script: string, numberOfKeys: number, ...keysAndArguments: string[]): Promise<unknown>;
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[cursor: string, keys: string[]]>;
  del(...keys: string[]): Promise<number>;
  /** Where the client connects, as the client itself reports it. */
  readonly options?: {
    readonly host?: string;
    readonly port?: number;
    readonly path?: string;
    readonly db?: number;
  };
}

/** What the throttle reads of an account to decide whether a device is still known. */
export interface AdminCredentialState {
  readonly adminUserId: string;
  /** The account's e-mail address, as stored — normalised. */
  readonly email: string;
  readonly passwordHash: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The origin an address is counted as: the address itself for IPv4, the /64
 * for IPv6, and the embedded IPv4 address for an IPv4-mapped IPv6 one, so that
 * one client is one origin whichever way its connection was written down.
 * Anything that is not an address is counted as the string it is.
 */
export function addressOrigin(ip: string): string {
  const zone = ip.indexOf('%');
  const address = (zone === -1 ? ip : ip.slice(0, zone)).trim().toLowerCase();
  if (isIP(address) !== 6) return address;

  // An embedded dotted quad is the last 32 bits, written as two groups.
  let text = address;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map((part) => Number(part));
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const leading = head === '' ? [] : head.split(':');
  const trailing = rest === undefined || rest === '' ? [] : rest.split(':');
  const groups =
    rest === undefined
      ? leading
      : [
          ...leading,
          ...new Array<string>(8 - leading.length - trailing.length).fill('0'),
          ...trailing,
        ];
  const words = groups.map((group) => parseInt(group, 16));

  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mapped) {
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return `${words
    .slice(0, 4)
    .map((word) => word.toString(16))
    .join(':')}::/64`;
}

interface Counter {
  readonly scope: 'account' | 'address' | 'device';
  readonly state: string;
  readonly unsettled: string;
  readonly policy: AttemptPolicy;
}

export interface AuthenticationThrottleOptions {
  readonly redis: AttemptCounterStore;
  readonly auditLog: AuditPort;
  readonly log: PlatformLogger;
  /** The active, not deleted account with this id, or `null`. */
  readonly credentialOf: (adminUserId: string) => Promise<AdminCredentialState | null>;
  readonly now?: () => number;
  readonly storeDeadlineMs?: number;
  readonly addressPolicy?: AttemptPolicy;
  readonly accountPolicy?: AttemptPolicy;
}

export class AuthenticationThrottle implements AdminAuthenticationThrottlePort {
  private readonly redis: AttemptCounterStore;
  private readonly auditLog: AuditPort;
  private readonly log: PlatformLogger;
  private readonly credentialOf: (adminUserId: string) => Promise<AdminCredentialState | null>;
  private readonly now: () => number;
  private readonly storeDeadlineMs: number;
  private readonly addressPolicy: AttemptPolicy;
  private readonly accountPolicy: AttemptPolicy;

  constructor(options: AuthenticationThrottleOptions) {
    this.redis = options.redis;
    this.auditLog = options.auditLog;
    this.log = options.log;
    this.credentialOf = options.credentialOf;
    // Read at call time: a reference to `Date.now` taken here would outlive a
    // replaced clock.
    this.now = options.now ?? ((): number => Date.now());
    this.storeDeadlineMs = options.storeDeadlineMs ?? DEFAULT_STORE_DEADLINE_MS;
    this.addressPolicy = options.addressPolicy ?? ADDRESS_POLICY;
    this.accountPolicy = options.accountPolicy ?? ACCOUNT_POLICY;
  }

  async verify(
    attempt: AdminAuthenticationAttempt,
    check: () => Promise<AdminAuthenticationCheckResult>,
  ): Promise<boolean> {
    const counters = await this.countersFor(attempt);
    const keys = counters.flatMap((counter) => [counter.state, counter.unsettled]);
    const policies = counters.flatMap(({ policy }) => [
      String(policy.threshold),
      String(policy.windowSeconds * 1000),
      String(policy.baseDelaySeconds * 1000),
      String(policy.maxDelaySeconds * 1000),
    ]);
    const attemptId = randomBytes(12).toString('hex');

    const take = this.redis.eval(
      TAKE_SCRIPT,
      keys.length,
      ...keys,
      String(this.now()),
      attemptId,
      String(ABANDONED_AFTER_SECONDS * 1000),
      ...policies,
    ) as Promise<[number, number]>;
    const [admitted, remainingMs] = await this.withinDeadline(take, () => {
      // The command is still queued in the client. If it is ever admitted,
      // nobody is waiting for it: withdraw it, so that an outage does not turn
      // into failures counted against the account.
      void take
        .then((late) => (late[0] === 1 ? this.release(keys, attemptId, false) : undefined))
        .catch(() => undefined);
    });

    if (admitted === 0) {
      // No delay running means every slot is held by an attempt still being
      // verified; one of them settles within the time a verification takes.
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      throw new HttpError(
        429,
        ERROR_CODES.ADMIN_AUTHENTICATION_THROTTLED,
        'Too many unsuccessful attempts for this account. Wait before trying again.',
        { retryAfterSeconds },
        { 'Retry-After': String(retryAfterSeconds) },
      );
    }

    let result: AdminAuthenticationCheckResult;
    try {
      result = await check();
    } catch (error) {
      // The check did not answer, so the attempt is neither a failure nor a
      // success. Nothing was learned from it, and it is withdrawn.
      await this.release(keys, attemptId, false);
      throw error;
    }
    if (result.ok) {
      await this.release(keys, attemptId, true);
      return true;
    }
    const [delayMs, mask] = await this.withinDeadline(
      this.redis.eval(
        FAIL_SCRIPT,
        keys.length,
        ...keys,
        String(this.now()),
        attemptId,
        ...policies,
      ) as Promise<[number, number]>,
    );
    if (mask !== 0) {
      // The widest counter that started a delay: they are listed widest first.
      const started = counters.find((_, index) => Math.floor(mask / 2 ** index) % 2 === 1);
      await this.report(attempt, result.adminUserId, {
        scope: started?.scope ?? 'account',
        retryAfterSeconds: Math.ceil(delayMs / 1000),
      });
    }
    return false;
  }

  async issueKnownDevice(adminUserId: string): Promise<string | null> {
    const credential = await this.credentialOf(adminUserId);
    if (!credential) return null;
    return [
      KNOWN_DEVICE_VERSION,
      credential.adminUserId,
      randomBytes(16).toString('hex'),
      this.stamp(credential),
    ].join('.');
  }

  /**
   * Forget every counter of one account — the operator's way out for somebody
   * who is being kept from signing in on a device the account has never been
   * used from. Returns how many keys were removed.
   *
   * `email` clears the password counters, which are keyed by it whether or not
   * an account has it; `adminUserId` clears the second-factor counters.
   */
  /**
   * Which Redis the counters are in: host, port and database index, or the
   * socket path. Never the credentials — they are not read here at all.
   */
  describeStore(): string {
    const options = this.redis.options;
    if (options === undefined) return 'an unidentified Redis';
    const where =
      options.path !== undefined && options.path !== ''
        ? options.path
        : `${options.host ?? 'localhost'}:${options.port ?? 6379}`;
    return `${where}, database ${options.db ?? 0}`;
  }

  async clear(account: { email: string; adminUserId?: string }): Promise<number> {
    const patterns = [`${KEY_PREFIX}password:{${digest(account.email)}}:*`];
    if (account.adminUserId !== undefined) {
      patterns.push(`${KEY_PREFIX}second_factor:{${digest(account.adminUserId)}}:*`);
    }
    let removed = 0;
    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [next, keys] = await this.withinDeadline(
          this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500),
        );
        cursor = next;
        if (keys.length > 0) removed += await this.withinDeadline(this.redis.del(...keys));
      } while (cursor !== '0');
    }
    this.log.warn(
      { removed, ...(account.adminUserId === undefined ? {} : { adminUserId: account.adminUserId }) },
      'administrator authentication throttle cleared by an operator',
    );
    if (account.adminUserId !== undefined) {
      await this.auditLog.record({
        // No administrator acted: the command runs from a shell on the
        // instance. Written out as the lifecycle commands write it, so the row
        // reads "nobody signed in did this" rather than "unknown".
        actorAdminUserId: null,
        action: 'admin_user.authentication_throttle_cleared',
        objectType: 'admin_user',
        objectId: account.adminUserId,
        stateAfter: { via: 'cli', removed },
      });
    }
    return removed;
  }

  private stamp(credential: AdminCredentialState): string {
    return digest(`${credential.adminUserId}:${credential.passwordHash}`).slice(0, 32);
  }

  /**
   * The device id of a known device of the account this attempt is for, or
   * `null`. Anything else — no value, a malformed one, another account's, one
   * minted before the password last changed, an account that is no longer
   * active — is `null`, and the attempt is then counted like any stranger's.
   */
  private async knownDeviceOf(attempt: AdminAuthenticationAttempt): Promise<string | null> {
    if (attempt.knownDevice === undefined) return null;
    const [version, adminUserId, deviceId, stamp, ...extra] = attempt.knownDevice.split('.');
    if (version !== KNOWN_DEVICE_VERSION || !adminUserId || !deviceId || !stamp || extra.length > 0) {
      return null;
    }
    const credential = await this.credentialOf(adminUserId);
    if (!credential || this.stamp(credential) !== stamp) return null;
    const account = attempt.factor === 'password' ? credential.email : credential.adminUserId;
    return account === attempt.account ? deviceId : null;
  }

  private async countersFor(attempt: AdminAuthenticationAttempt): Promise<Counter[]> {
    // The digest keeps a caller-supplied string out of the key and gives every
    // key of one attempt a shared hash tag, so the scripts stay valid on a
    // clustered Redis.
    const base = `${KEY_PREFIX}${attempt.factor}:{${digest(attempt.account)}}`;
    const counter = (scope: Counter['scope'], suffix: string, policy: AttemptPolicy): Counter => ({
      scope,
      state: `${base}:${suffix}`,
      unsettled: `${base}:${suffix}:unsettled`,
      policy,
    });

    const deviceId = await this.knownDeviceOf(attempt);
    if (deviceId !== null) {
      return [counter('device', `device:${digest(deviceId)}`, this.addressPolicy)];
    }
    // Widest first: `verify` reports the first counter that started a delay.
    const counters = [counter('account', 'account', this.accountPolicy)];
    if (attempt.ip !== undefined && attempt.ip !== '') {
      counters.push(
        counter('address', `address:${digest(addressOrigin(attempt.ip))}`, this.addressPolicy),
      );
    }
    return counters;
  }

  private async release(keys: string[], attemptId: string, forgetFailures: boolean): Promise<void> {
    await this.withinDeadline(
      this.redis.eval(RELEASE_SCRIPT, keys.length, ...keys, attemptId, forgetFailures ? '1' : '0'),
    );
  }

  /**
   * `command`'s answer, or a 503 when it fails or has not arrived in time.
   * `onDeadline` runs when the wait is given up while the command is still
   * outstanding.
   */
  private async withinDeadline<T>(command: Promise<T>, onDeadline?: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), this.storeDeadlineMs);
    });
    let outcome: T | 'deadline';
    try {
      outcome = await Promise.race([command, deadline]);
    } catch (error) {
      this.log.error(
        { err: error },
        'administrator authentication throttle: the counter store failed',
      );
      throw this.unavailable();
    } finally {
      clearTimeout(timer);
    }
    if (outcome === 'deadline') {
      this.log.error(
        { deadlineMs: this.storeDeadlineMs },
        'administrator authentication throttle: the counter store did not answer in time',
      );
      // The abandoned command must not become an unhandled rejection later.
      command.catch(() => undefined);
      onDeadline?.();
      throw this.unavailable();
    }
    return outcome;
  }

  private unavailable(): HttpError {
    return new HttpError(
      503,
      ERROR_CODES.ADMIN_AUTHENTICATION_UNAVAILABLE,
      'Sign-in is temporarily unavailable. Try again in a moment.',
      undefined,
      { 'Retry-After': '5' },
    );
  }

  /**
   * One line and, for a real account, one audit row — per delay started, never
   * per attempt. The attempts a delay refuses write nothing, so the audit log
   * cannot be filled by repeating them; and an address that belongs to no
   * account is logged only, because the supply of those is unlimited.
   *
   * The credential that was tried is not an argument of this class at all.
   */
  private async report(
    attempt: AdminAuthenticationAttempt,
    adminUserId: string | undefined,
    activation: { scope: Counter['scope']; retryAfterSeconds: number },
  ): Promise<void> {
    this.log.warn(
      {
        factor: attempt.factor,
        scope: activation.scope,
        retryAfterSeconds: activation.retryAfterSeconds,
        accountKnown: adminUserId !== undefined,
        ...(adminUserId === undefined ? {} : { adminUserId }),
        ...(attempt.ip === undefined ? {} : { ip: attempt.ip }),
      },
      'administrator authentication throttled after repeated unsuccessful attempts',
    );
    if (adminUserId === undefined) return;
    await this.auditLog.record({
      action: 'admin_user.authentication_throttled',
      objectType: 'admin_user',
      objectId: adminUserId,
      stateAfter: {
        factor: attempt.factor,
        scope: activation.scope,
        retryAfterSeconds: activation.retryAfterSeconds,
      },
      ...(attempt.ip === undefined ? {} : { ipAddress: attempt.ip }),
    });
  }
}
