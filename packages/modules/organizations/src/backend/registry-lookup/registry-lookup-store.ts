import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  registryActivityStatusSchema,
  registryAttemptSchema,
  registryLookupIdSchema,
  registryPlSourcesSchema,
  registryProviderSchema,
  registryVatStatusSchema,
} from '@endora-commerce/contracts';
import type {
  RegistryLookupAnswer,
  RegistryLookupSnapshot,
  RegistryPlSources,
  RegistryProvider,
} from './company-registry-port.js';
import {
  ANSWER_TTL_SECONDS,
  REGISTRY_BUDGETS,
  REGISTRY_LOOKUP_REDIS_PREFIX,
  TICKET_TTL_SECONDS,
  type RegistryBudget,
} from './limits.js';

/**
 * Feature 173 — the lookup's three Redis key families (research R-8,
 * data-model §3): the answer cache, the tickets, the per-registry budgets.
 *
 * TTL-only by design: no write on this platform changes a registry's answer,
 * and both readers check the toggle before reading, so switching the lookup off
 * needs no flush. Not a domain cache, so the lifecycle pub/sub drop pattern
 * does not apply.
 *
 * Every Redis error surfaces as {@link RegistryLookupStoreError}; the service
 * answers `unavailable` on it, so the lookup never runs uncached and unmetered
 * (R-7 layer 7). A stored value that fails its schema reads as absent.
 */

/** The structural half of a Redis client this store uses (ioredis satisfies it). */
export interface RegistryLookupRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export class RegistryLookupStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`registry lookup store: ${operation} failed`, { cause });
    this.name = 'RegistryLookupStoreError';
  }
}

const recordSchema = z.object({
  legalName: z.string().nullable(),
  address: z.object({
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string(),
  }),
  regon: z.string().nullable(),
  vatPayerStatus: registryVatStatusSchema,
  activityStatus: registryActivityStatusSchema,
});

const answerSchema = z.object({
  status: z.enum(['found', 'not_found', 'unavailable']),
  country: z.string().length(2),
  taxId: z.string().min(1),
  plSources: registryPlSourcesSchema.nullable(),
  record: recordSchema.nullable(),
  dataSource: registryProviderSchema.nullable(),
  vatStatusSource: z.enum(['mf_pl', 'vies']).nullable(),
  attempts: z.array(registryAttemptSchema),
  fetchedAt: z.string(),
});

const snapshotSchema = answerSchema.extend({
  version: z.literal(1),
  lookupId: registryLookupIdSchema,
  fromCache: z.boolean(),
  issuedAt: z.string(),
});

export interface RegistryLookupStoreOptions {
  now?: () => number;
  /** Overrides per registry — tests only; production uses {@link REGISTRY_BUDGETS}. */
  budgets?: Partial<Record<RegistryProvider, RegistryBudget>>;
}

const WARSAW = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

function warsawParts(at: number): { y: number; m: number; d: number; h: number } {
  const parts = Object.fromEntries(WARSAW.formatToParts(at).map((p) => [p.type, p.value]));
  return { y: Number(parts['year']), m: Number(parts['month']), d: Number(parts['day']), h: Number(parts['hour']) };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The budget window an instant falls in, and how long its counter must live:
 * to the end of the window plus one hour (R-8). The White List's window is the
 * Europe/Warsaw calendar day, which is 23 or 25 hours long on a DST change.
 */
export function budgetWindow(provider: RegistryProvider, at: number, budgets = REGISTRY_BUDGETS): {
  id: string;
  ttlSeconds: number;
} {
  const kind = budgets[provider].window;
  if (kind === 'utc_hour') {
    const date = new Date(at);
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours() + 1);
    return {
      id: `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}`,
      ttlSeconds: Math.ceil((end - at) / 1000) + 3600,
    };
  }
  const today = warsawParts(at);
  // The next Warsaw midnight: the instant whose Warsaw date is tomorrow, hour 0,
  // with the offset (CET +1 or CEST +2) that makes it so.
  const tomorrow = new Date(Date.UTC(today.y, today.m - 1, today.d + 1));
  let end = Number.NaN;
  for (const offsetHours of [1, 2]) {
    const candidate = tomorrow.getTime() - offsetHours * 3600 * 1000;
    const parts = warsawParts(candidate);
    if (parts.h === 0 && parts.d === tomorrow.getUTCDate() && parts.m === tomorrow.getUTCMonth() + 1) {
      end = candidate;
      break;
    }
  }
  if (Number.isNaN(end)) end = tomorrow.getTime();
  return { id: `${today.y}${pad(today.m)}${pad(today.d)}`, ttlSeconds: Math.ceil((end - at) / 1000) + 3600 };
}

export class RegistryLookupStore {
  private readonly now: () => number;
  private readonly budgets: Record<RegistryProvider, RegistryBudget>;

  constructor(
    private readonly redis: RegistryLookupRedis,
    options: RegistryLookupStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.budgets = { ...REGISTRY_BUDGETS, ...options.budgets };
  }

  private answerKey(country: string, plSources: RegistryPlSources | null, taxId: string): string {
    return `${REGISTRY_LOOKUP_REDIS_PREFIX}answer:${country}:${plSources ?? 'vies'}:${taxId}`;
  }

  private ticketKey(lookupId: string): string {
    return `${REGISTRY_LOOKUP_REDIS_PREFIX}ticket:${lookupId}`;
  }

  private async attempt<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw new RegistryLookupStoreError(operation, err);
    }
  }

  /** `plSources` is the mode for `PL` and `null` for every other country. */
  async readAnswer(
    country: string,
    plSources: RegistryPlSources | null,
    taxId: string,
  ): Promise<RegistryLookupAnswer | null> {
    const raw = await this.attempt('readAnswer', () => this.redis.get(this.answerKey(country, plSources, taxId)));
    return parseStored(raw, answerSchema) as RegistryLookupAnswer | null;
  }

  async writeAnswer(answer: RegistryLookupAnswer): Promise<void> {
    await this.attempt('writeAnswer', () =>
      this.redis.set(
        this.answerKey(answer.country, answer.plSources, answer.taxId),
        JSON.stringify(answer),
        'EX',
        ANSWER_TTL_SECONDS[answer.status],
      ),
    );
  }

  /** A new ticket for the answer the buyer is about to be shown (R-8). */
  async mintTicket(answer: RegistryLookupAnswer, fromCache: boolean): Promise<RegistryLookupSnapshot> {
    const snapshot: RegistryLookupSnapshot = {
      ...answer,
      version: 1,
      lookupId: randomBytes(32).toString('base64url'),
      fromCache,
      issuedAt: new Date(this.now()).toISOString(),
    };
    await this.attempt('mintTicket', () =>
      this.redis.set(this.ticketKey(snapshot.lookupId), JSON.stringify(snapshot), 'EX', TICKET_TTL_SECONDS),
    );
    return snapshot;
  }

  async readTicket(lookupId: string): Promise<RegistryLookupSnapshot | null> {
    if (!registryLookupIdSchema.safeParse(lookupId).success) return null;
    const raw = await this.attempt('readTicket', () => this.redis.get(this.ticketKey(lookupId)));
    return parseStored(raw, snapshotSchema) as RegistryLookupSnapshot | null;
  }

  async deleteTicket(lookupId: string): Promise<void> {
    if (!registryLookupIdSchema.safeParse(lookupId).success) return;
    await this.attempt('deleteTicket', () => this.redis.del(this.ticketKey(lookupId)));
  }

  /**
   * Take one call from the registry's budget for the current window; `false`
   * when the window's budget is spent. Checked before every outbound call.
   */
  async consumeBudget(provider: RegistryProvider): Promise<boolean> {
    const window = budgetWindow(provider, this.now(), this.budgets);
    const key = `${REGISTRY_LOOKUP_REDIS_PREFIX}budget:${provider}:${window.id}`;
    return this.attempt('consumeBudget', async () => {
      const used = await this.redis.incr(key);
      if (used === 1) await this.redis.expire(key, window.ttlSeconds);
      return used <= this.budgets[provider].limit;
    });
  }
}

function parseStored(raw: string | null, schema: z.ZodType): unknown {
  if (raw === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
