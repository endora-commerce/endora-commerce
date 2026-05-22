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
});

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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ countryCode, vatNumber: number }),
        signal: controller.signal,
      });
      if (res.status >= 500) {
        return {
          outcome: 'deferred',
          legalName: null,
          address: null,
          errorKind: `provider_${res.status}`,
        };
      }
      if (!res.ok) {
        return {
          outcome: 'failed',
          legalName: null,
          address: null,
          errorKind: `http_${res.status}`,
        };
      }
      const json = await res.json().catch(() => null);
      const parsed = VIES_RESPONSE_SCHEMA.safeParse(json);
      if (!parsed.success) {
        return {
          outcome: 'deferred',
          legalName: null,
          address: null,
          errorKind: 'invalid_response_shape',
        };
      }
      const valid = parsed.data.valid ?? parsed.data.isValid ?? false;
      if (!valid) {
        return {
          outcome: 'failed',
          legalName: null,
          address: null,
          errorKind: 'not_found',
        };
      }
      return {
        outcome: 'validated',
        legalName: parsed.data.name ?? null,
        address: parsed.data.address
          ? { line1: parsed.data.address, countryCode }
          : { countryCode },
        errorKind: null,
      };
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        return {
          outcome: 'deferred',
          legalName: null,
          address: null,
          errorKind: 'network_timeout',
        };
      }
      return {
        outcome: 'deferred',
        legalName: null,
        address: null,
        errorKind: 'network_error',
      };
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
