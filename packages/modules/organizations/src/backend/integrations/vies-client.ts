import { z } from 'zod';
import type {
  VatValidationResult,
  VatValidator,
} from '../services/vat-validator-port.js';

/**
 * VIES REST client (feature 026 US7).
 *
 * Hits `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`.
 * Times out at 5 s; degrades to `deferred` on network errors or 5xx
 * responses. A clean `valid=false` becomes `failed` / `not_found`.
 *
 * The response shape is validated by Zod — if VIES ever surfaces a
 * different schema we degrade to `deferred` rather than crashing.
 */
const VIES_RESPONSE_SCHEMA = z.object({
  valid: z.boolean().optional(),
  isValid: z.boolean().optional(),
  countryCode: z.string().optional(),
  vatNumber: z.string().optional(),
  name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  /** `VALID`, `INVALID`, or why VIES could not answer (`MS_UNAVAILABLE`, `TIMEOUT`, …). */
  userError: z.string().nullable().optional(),
});

/**
 * The `userError` values that mean VIES (or the member state behind it) did not
 * answer, rather than that the number is invalid. With them VIES also sends
 * `valid: false`, which read alone would be a "not registered" (feature 173).
 */
const VIES_UNAVAILABLE_ERRORS: ReadonlySet<string> = new Set([
  'MS_UNAVAILABLE',
  'MS_MAX_CONCURRENT_REQ',
  'GLOBAL_MAX_CONCURRENT_REQ',
  'SERVICE_UNAVAILABLE',
  'TIMEOUT',
]);

/**
 * One parsed VIES answer (feature 173, research R-2), shared by `validate()`
 * and the registration lookup's adapter: one HTTP implementation per registry.
 * `name` / `address` are as VIES wrote them — `'---'` included, which is how a
 * member state that does not disclose them answers (T001, Germany).
 */
export type ViesCheckResult =
  | { status: 'valid'; name: string | null; address: string | null }
  | { status: 'invalid' }
  | { status: 'refused'; errorKind: string }
  | { status: 'unavailable'; errorKind: string };

export interface ViesClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export class ViesClient implements VatValidator {
  readonly provider = 'vies' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ViesClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ?? 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async validate(input: {
    taxId: string;
    countryCode?: string | undefined;
  }): Promise<VatValidationResult> {
    const { countryCode, number } = splitEuVatId(input.taxId, input.countryCode);
    if (!countryCode || !number) {
      return {
        outcome: 'unverified',
        legalName: null,
        address: null,
        errorKind: 'invalid_format',
      };
    }

    const result = await this.check(countryCode, number);
    switch (result.status) {
      case 'unavailable':
        return { outcome: 'deferred', legalName: null, address: null, errorKind: result.errorKind };
      case 'refused':
        return { outcome: 'failed', legalName: null, address: null, errorKind: result.errorKind };
      case 'invalid':
        return { outcome: 'failed', legalName: null, address: null, errorKind: 'not_found' };
      case 'valid':
        return {
          outcome: 'validated',
          legalName: result.name,
          address: result.address ? { line1: result.address, countryCode } : { countryCode },
          errorKind: null,
        };
    }
  }

  /** Ask VIES about one number of one member state (VIES spelling: `EL`). Never throws. */
  async check(countryCode: string, number: string): Promise<ViesCheckResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ countryCode, vatNumber: number }),
        signal: controller.signal,
      });
      if (res.status >= 500) return { status: 'unavailable', errorKind: `provider_${res.status}` };
      if (!res.ok) return { status: 'refused', errorKind: `http_${res.status}` };
      const json = await res.json().catch(() => null);
      const parsed = VIES_RESPONSE_SCHEMA.safeParse(json);
      if (!parsed.success) return { status: 'unavailable', errorKind: 'invalid_response_shape' };
      const userError = parsed.data.userError ?? null;
      if (userError !== null && VIES_UNAVAILABLE_ERRORS.has(userError)) {
        return { status: 'unavailable', errorKind: `vies_${userError.toLowerCase()}` };
      }
      const valid = parsed.data.valid ?? parsed.data.isValid ?? false;
      if (!valid) return { status: 'invalid' };
      return { status: 'valid', name: parsed.data.name ?? null, address: parsed.data.address ?? null };
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        return { status: 'unavailable', errorKind: 'network_timeout' };
      }
      return { status: 'unavailable', errorKind: 'network_error' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * VIES expects the country code split from the digits. Accept either
 * `'PL1234567890'`, `'PL 123-456-78-90'`, or a separate country hint +
 * a digit-only tax id. The function strips whitespace and dashes
 * defensively (the Zod boundary already does this for new orgs but the
 * service-side path also accepts historical inputs).
 */
function splitEuVatId(
  taxId: string,
  hint: string | undefined,
): { countryCode: string | null; number: string | null } {
  const cleaned = taxId.replace(/[\s-]+/g, '').toUpperCase();
  const m = cleaned.match(/^([A-Z]{2})(.+)$/);
  if (m) {
    return { countryCode: m[1]!, number: m[2]! };
  }
  if (hint && /^[A-Z]{2}$/.test(hint)) {
    return { countryCode: hint.toUpperCase(), number: cleaned };
  }
  return { countryCode: null, number: null };
}
