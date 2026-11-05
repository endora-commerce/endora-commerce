import { z } from 'zod';
import type {
  VatValidationResult,
  VatValidator,
} from '../services/vat-validator-port.js';

/**
 * Ministerstwo Finansów ("Biała lista podatników VAT") REST client.
 * Feature 026 US7.
 *
 * Hits `GET https://wykazpodatnikowvat.mf.gov.pl/api/search/nip/{nip}?date=YYYY-MM-DD`.
 * The service moved there from `wl-api.mf.gov.pl`, which stops answering on
 * 2026-12-01 (feature 173, research R-6).
 * Times out at 5 s; degrades to `deferred` on network errors or 5xx
 * responses. A clean "not registered" becomes `failed` / `not_found`.
 *
 * MF rate-limits to ~10 req/sec per source IP. The simple in-process
 * token bucket here enforces a conservative 1 req/sec; production
 * traffic for this feature is < 100/day so the bucket will rarely
 * throttle.
 */
const MF_RESPONSE_SCHEMA = z.object({
  result: z
    .object({
      subject: z
        .object({
          name: z.string().nullable().optional(),
          nip: z.string().nullable().optional(),
          statusVat: z.string().nullable().optional(),
          regon: z.string().nullable().optional(),
          workingAddress: z.string().nullable().optional(),
          residenceAddress: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  code: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
});

export interface MinisterstwoFinansowClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
  /** Minimum ms between successive requests. Defaults to 100ms (10 rps). */
  minIntervalMs?: number;
}

/** One White List subject, as the registry answers it (`result.subject`). */
export type MfSubject = NonNullable<NonNullable<z.infer<typeof MF_RESPONSE_SCHEMA>['result']>['subject']>;

/**
 * The parsed registry answer of one `search` call (feature 173, research R-2).
 *
 * Shared by `validate()` — the admin "Validate now" — and the registration
 * lookup's adapter, so one HTTP implementation and one throttle stand in front
 * of the White List's per-IP limit.
 *
 * - `invalid` — the White List refused the request as such (a malformed NIP, or
 *   `400 WL-115` for a checksum it rejects): the number, not the registry, is
 *   at fault.
 * - `unavailable` — the registry could not answer now: timeout, network, 5xx,
 *   an unreadable body, `429`, and two body codes T001 found
 *   (research R-6): `WL-1919` (the IP's daily limit, any HTTP status) ⇒
 *   `rate_limited`, `WL-1188` (database update in progress) ⇒
 *   `provider_maintenance`.
 */
export type MfSearchResult =
  | { status: 'found'; subject: MfSubject }
  | { status: 'not_found' }
  | { status: 'invalid'; errorKind: string }
  | { status: 'unavailable'; errorKind: string };

export class MinisterstwoFinansowClient implements VatValidator {
  readonly provider = 'mf_pl' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(options: MinisterstwoFinansowClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://wykazpodatnikowvat.mf.gov.pl';
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.minIntervalMs = options.minIntervalMs ?? 100;
  }

  async validate(input: { taxId: string }): Promise<VatValidationResult> {
    const nip = input.taxId.replace(/^PL/i, '').replace(/[\s-]+/g, '');
    const result = await this.search(nip);
    switch (result.status) {
      case 'invalid':
        return {
          outcome: result.errorKind === 'invalid_format' ? 'unverified' : 'failed',
          legalName: null,
          address: null,
          errorKind: result.errorKind,
        };
      case 'unavailable':
        return { outcome: 'deferred', legalName: null, address: null, errorKind: result.errorKind };
      case 'not_found':
        return { outcome: 'failed', legalName: null, address: null, errorKind: 'not_found' };
      case 'found': {
        const subject = result.subject;
        // Active VAT-payer statuses on MF: 'Czynny' (active) is the green
        // light; everything else means the taxpayer is registered but
        // suspended / cancelled. We surface those as `failed` rather than
        // `validated` because they generally shouldn't trade.
        const statusOk = (subject.statusVat ?? '').toLowerCase().includes('czynn');
        return {
          outcome: statusOk ? 'validated' : 'failed',
          legalName: subject.name ?? null,
          address: subject.workingAddress
            ? { line1: subject.workingAddress, countryCode: 'PL' }
            : subject.residenceAddress
              ? { line1: subject.residenceAddress, countryCode: 'PL' }
              : { countryCode: 'PL' },
          errorKind: statusOk ? null : 'not_active_vat_payer',
        };
      }
    }
  }

  /** Ask the White List about one ten-digit NIP. Never throws. */
  async search(nip: string): Promise<MfSearchResult> {
    if (!/^[0-9]{10}$/.test(nip)) return { status: 'invalid', errorKind: 'invalid_format' };

    await this.throttle();

    const date = todayIsoDate();
    const url = `${this.baseUrl}/api/search/nip/${nip}?date=${date}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      // The White List's own error codes win over the HTTP status: T001 found
      // its daily-limit refusal undocumented and spelled by the body.
      const code = (json as { code?: unknown } | null)?.code;
      if (code === 'WL-1919') return { status: 'unavailable', errorKind: 'rate_limited' };
      if (code === 'WL-1188') return { status: 'unavailable', errorKind: 'provider_maintenance' };

      if (res.status === 429) return { status: 'unavailable', errorKind: 'rate_limited' };
      if (res.status >= 500) return { status: 'unavailable', errorKind: `provider_${res.status}` };
      if (res.status === 404) return { status: 'not_found' };
      if (!res.ok) return { status: 'invalid', errorKind: `http_${res.status}` };

      const parsed = MF_RESPONSE_SCHEMA.safeParse(json);
      if (!parsed.success) return { status: 'unavailable', errorKind: 'invalid_response_shape' };
      const subject = parsed.data.result?.subject ?? null;
      return subject ? { status: 'found', subject } : { status: 'not_found' };
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        return { status: 'unavailable', errorKind: 'network_timeout' };
      }
      return { status: 'unavailable', errorKind: 'network_error' };
    } finally {
      clearTimeout(timer);
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequestAt = Date.now();
  }
}

function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
