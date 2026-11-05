import { createHash } from 'node:crypto';
import type {
  CompanyRegistryAnswer,
  CompanyRegistryClient,
  CompanyRegistryLookupInput,
  CompanyRegistryRecord,
  GusCredential,
} from '../registry-lookup/company-registry-port.js';
import {
  GUS_ENDPOINTS,
  GUS_SOAP_CONTENT_TYPE,
  GusSoapError,
  daneSzukajPodmiotyEnvelope,
  getValueEnvelope,
  readDaneUnits,
  readSoapResult,
  zalogujEnvelope,
} from './gus-bir-soap.js';

/**
 * Feature 173 — the GUS REGON registry (BIR1.1) as a `CompanyRegistryClient`
 * (`specs/173-registration-registry-lookup/contracts/gus-bir11-client.md`,
 * research R-4, R-9).
 *
 * One `DaneSzukajPodmioty` call per lookup — it already carries the name and
 * the whole postal address — after a `Zaloguj` when there is no live session.
 * `GetValue` is read only when a search comes back empty: T001 found that a
 * stale session answers an empty result, an **empty** `KomunikatKod` and
 * `StatusSesji` `0`, so `StatusSesji` is the session signal.
 *
 * **Session**: one per process, in memory, reused while it was used less than
 * 50 minutes ago and the key fingerprint (SHA-256 of environment and key) is
 * unchanged; concurrent lookups share one in-flight login; a session found
 * stale is cleared and the search retried once after a fresh login.
 *
 * **What never leaves this file**: the key and the session id. Neither is
 * logged, put in an error kind or returned; the only log line is the
 * once-an-hour warning that a key was refused, and it names the environment.
 *
 * Never throws: every failure is an `unavailable` answer.
 */

export interface GusBirClientOptions {
  fetchImpl?: typeof globalThis.fetch;
  /** Per HTTP request. Default 4000. */
  requestTimeoutMs?: number;
  /** Login + search, including one re-login and retry. Default 6000. */
  totalTimeoutMs?: number;
  now?: () => number;
  logger?: { warn(obj: object, msg: string): void; info(obj: object, msg: string): void };
}

const SESSION_REUSE_MS = 50 * 60 * 1000;
const INVALID_KEY_WARNING_MS = 60 * 60 * 1000;

interface Session {
  sid: string;
  fingerprint: string;
  lastUsedAt: number;
}

type LoginResult = { kind: 'ok'; sid: string } | { kind: 'invalid_key' };
type SearchResult = { kind: 'answer'; answer: CompanyRegistryAnswer } | { kind: 'session' };

/** A refusal that ends the lookup with this error kind. */
class LookupFailure extends Error {
  constructor(readonly errorKind: string) {
    super(errorKind);
  }
}

function unavailable(errorKind: string): CompanyRegistryAnswer {
  return { provider: 'gus_pl', outcome: 'unavailable', record: null, errorKind };
}

/** Only a short number is ever put into an error kind — never registry text. */
function codeKind(code: string): string {
  return /^\d{1,4}$/.test(code) ? `gus_code_${code}` : 'gus_code_unknown';
}

export class GusBirClient implements CompanyRegistryClient {
  readonly provider = 'gus_pl' as const;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly requestTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly now: () => number;
  private readonly logger: GusBirClientOptions['logger'];
  private session: Session | null = null;
  private readonly loginsInFlight = new Map<string, Promise<LoginResult>>();
  private readonly invalidKeyWarnedAt = new Map<string, number>();

  constructor(options: GusBirClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 4000;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 6000;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
  }

  async lookup(input: CompanyRegistryLookupInput): Promise<CompanyRegistryAnswer> {
    const credential = input.gusCredential;
    if (!credential) return unavailable('not_configured');
    const total = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ceiling = new Promise<CompanyRegistryAnswer>((resolve) => {
      timer = setTimeout(() => {
        total.abort();
        resolve(unavailable('network_timeout'));
      }, this.totalTimeoutMs);
    });
    try {
      return await Promise.race([this.run(input.taxId, credential, total.signal), ceiling]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async run(nip: string, credential: GusCredential, signal: AbortSignal): Promise<CompanyRegistryAnswer> {
    const endpoint = GUS_ENDPOINTS[credential.environment] ?? GUS_ENDPOINTS.production;
    const fingerprint = createHash('sha256').update(`${credential.environment}:${credential.apiKey}`).digest('hex');
    try {
      let sid = await this.sessionFor(credential, fingerprint, endpoint, signal);
      let result = await this.search(endpoint, sid, nip, signal);
      if (result.kind === 'session') {
        this.dropSession(fingerprint);
        sid = await this.sessionFor(credential, fingerprint, endpoint, signal);
        result = await this.search(endpoint, sid, nip, signal);
        if (result.kind === 'session') {
          this.dropSession(fingerprint);
          return unavailable('gus_session');
        }
      }
      if (this.session?.fingerprint === fingerprint) this.session.lastUsedAt = this.now();
      return result.answer;
    } catch (err) {
      return unavailable(this.errorKindOf(err));
    }
  }

  private errorKindOf(err: unknown): string {
    if (err instanceof LookupFailure) return err.errorKind;
    if (err instanceof GusSoapError) return 'invalid_response';
    if ((err as { name?: string } | null)?.name === 'AbortError') return 'network_timeout';
    return 'network_error';
  }

  private dropSession(fingerprint: string): void {
    if (this.session?.fingerprint === fingerprint) this.session = null;
  }

  private async sessionFor(
    credential: GusCredential,
    fingerprint: string,
    endpoint: string,
    signal: AbortSignal,
  ): Promise<string> {
    const current = this.session;
    if (current && current.fingerprint === fingerprint && this.now() - current.lastUsedAt < SESSION_REUSE_MS) {
      return current.sid;
    }
    let inFlight = this.loginsInFlight.get(fingerprint);
    if (!inFlight) {
      inFlight = this.login(credential.apiKey, endpoint, signal).finally(() => {
        this.loginsInFlight.delete(fingerprint);
      });
      this.loginsInFlight.set(fingerprint, inFlight);
    }
    const result = await inFlight;
    if (result.kind === 'invalid_key') {
      this.warnInvalidKey(fingerprint, credential.environment);
      throw new LookupFailure('gus_invalid_key');
    }
    this.session = { sid: result.sid, fingerprint, lastUsedAt: this.now() };
    return result.sid;
  }

  private async login(apiKey: string, endpoint: string, signal: AbortSignal): Promise<LoginResult> {
    const sid = readSoapResult(await this.post(endpoint, zalogujEnvelope(endpoint, apiKey), null, signal), 'ZalogujResult').trim();
    return sid === '' ? { kind: 'invalid_key' } : { kind: 'ok', sid };
  }

  private warnInvalidKey(fingerprint: string, environment: GusCredential['environment']): void {
    const now = this.now();
    const last = this.invalidKeyWarnedAt.get(fingerprint);
    if (last !== undefined && now - last < INVALID_KEY_WARNING_MS) return;
    this.invalidKeyWarnedAt.set(fingerprint, now);
    this.logger?.warn({ provider: 'gus_pl', environment }, 'organizations: the GUS REGON registry refused the configured key');
  }

  private async search(endpoint: string, sid: string, nip: string, signal: AbortSignal): Promise<SearchResult> {
    const document = readSoapResult(
      await this.post(endpoint, daneSzukajPodmiotyEnvelope(endpoint, nip), sid, signal),
      'DaneSzukajPodmiotyResult',
    );
    if (document.trim() !== '') {
      const units = readDaneUnits(document);
      const error = units.find((unit) => (unit['ErrorCode'] ?? '') !== '');
      if (error) return this.fromCode(error['ErrorCode']!);
      const record = recordFrom(units);
      return record
        ? { kind: 'answer', answer: { provider: 'gus_pl', outcome: 'found', record, errorKind: null } }
        : { kind: 'answer', answer: unavailable('gus_empty_result') };
    }
    const code = await this.getValue(endpoint, sid, 'KomunikatKod', signal);
    if (code !== '') return this.fromCode(code);
    const status = await this.getValue(endpoint, sid, 'StatusSesji', signal);
    return status === '0' ? { kind: 'session' } : { kind: 'answer', answer: unavailable('gus_empty_result') };
  }

  private fromCode(code: string): SearchResult {
    if (code === '4') return { kind: 'answer', answer: { provider: 'gus_pl', outcome: 'not_found', record: null, errorKind: null } };
    if (code === '7') return { kind: 'session' };
    return { kind: 'answer', answer: unavailable(codeKind(code)) };
  }

  private async getValue(
    endpoint: string,
    sid: string,
    name: 'KomunikatKod' | 'StatusSesji',
    signal: AbortSignal,
  ): Promise<string> {
    return readSoapResult(await this.post(endpoint, getValueEnvelope(endpoint, name), sid, signal), 'GetValueResult').trim();
  }

  private async post(endpoint: string, envelope: string, sid: string | null, total: AbortSignal): Promise<string> {
    if (total.aborted) throw new LookupFailure('network_timeout');
    const controller = new AbortController();
    const abort = () => controller.abort();
    total.addEventListener('abort', abort);
    const timer = setTimeout(abort, this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': GUS_SOAP_CONTENT_TYPE, ...(sid !== null ? { sid } : {}) },
        body: envelope,
        signal: controller.signal,
      });
      if (!response.ok) throw new LookupFailure(`provider_${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
      total.removeEventListener('abort', abort);
    }
  }
}

const MAIN_UNIT_TYPES: ReadonlySet<string> = new Set(['P', 'F']);

/**
 * The unit a registration means, and its record (research R-4): a main unit
 * (`Typ` `P` / `F`) over a local one (`LP`, `LF`), then one with no end date,
 * then registry order.
 */
function recordFrom(units: Array<Record<string, string>>): CompanyRegistryRecord | null {
  const candidates = units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => (unit['Regon'] ?? '') !== '');
  if (candidates.length === 0) return null;
  const rank = (unit: Record<string, string>): number =>
    (MAIN_UNIT_TYPES.has(unit['Typ'] ?? '') ? 0 : 2) + ((unit['DataZakonczeniaDzialalnosci'] ?? '') !== '' ? 1 : 0);
  candidates.sort((a, b) => rank(a.unit) - rank(b.unit) || a.index - b.index);
  const unit = candidates[0]!.unit;
  const value = (name: string): string | null => {
    const text = (unit[name] ?? '').trim();
    return text === '' ? null : text;
  };
  const number = [value('NrNieruchomosci'), value('NrLokalu')].filter((part) => part !== null).join('/');
  const streetName = value('Ulica');
  const place = streetName ?? value('Miejscowosc');
  const street = [place, number === '' ? null : number].filter((part) => part !== null).join(' ');
  const city = streetName !== null ? value('Miejscowosc') : (value('MiejscowoscPoczty') ?? value('Miejscowosc'));
  const postal = value('KodPocztowy');
  return {
    legalName: value('Nazwa'),
    address: {
      street: street === '' ? null : street,
      postalCode: postal !== null && /^\d{5}$/.test(postal) ? `${postal.slice(0, 2)}-${postal.slice(2)}` : postal,
      city,
      country: 'PL',
    },
    regon: value('Regon'),
    vatPayerStatus: 'unknown',
    activityStatus: value('DataZakonczeniaDzialalnosci') !== null ? 'ceased' : 'active',
  };
}
