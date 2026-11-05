import {
  registryLookupCountryForPicker,
  type RegistryLookupResult,
  type RegistrySource,
} from '@endora-commerce/contracts';
import {
  parsePlSources,
  type CompanyRegistryAnswer,
  type CompanyRegistryClient,
  type CompanyRegistryLookupInput,
  type GusCredential,
  type OrganizationsRegistryClients,
  type RegistryLookupAnswer,
  type RegistryPlSources,
  type RegistryProvider,
} from './company-registry-port.js';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { LOOKUP_DEADLINE_MS } from './limits.js';
import { mergePolishLegs, mergeViesLeg, type MergedLookup, type RegistryLeg } from './merge.js';
import { RegistryLookupStoreError, type RegistryLookupStore } from './registry-lookup-store.js';
import { normalizeTaxId } from './tax-id.js';

/**
 * Feature 173 — the registration lookup, end to end
 * (`specs/173-registration-registry-lookup/contracts/public-api.md` §2
 * "Behaviour", research R-3, R-7, R-8).
 *
 * Normalise first — an invalid number or an unsupported country touches
 * neither Redis nor a registry. Then, for a Polish NIP, read the Polish-sources
 * mode (fail-closed to `gus_mf`); serve the cache for that mode when it holds
 * the number; otherwise run the legs the mode selects, each behind its budget
 * and its timeout, merge, cache, and mint a ticket for the answer the buyer is
 * shown. A registry the mode excludes is neither called nor charged, and the
 * GUS credential is resolved only when the mode includes GUS.
 *
 * Fail-closed on Redis: any store error answers `unavailable` with no lookup id,
 * so the lookup never runs uncached and unmetered. The answer is computed from
 * public registry data alone; nothing here reads an Organization, so it cannot
 * say whether the tax ID is registered on this platform (FR-010).
 */

export interface RegistryLookupServiceDeps {
  /** Read per lookup, so a composition's override is what runs. */
  clients: () => OrganizationsRegistryClients;
  store: Pick<RegistryLookupStore, 'readAnswer' | 'writeAnswer' | 'mintTicket' | 'consumeBudget'>;
  /** `registry_lookup_pl_sources`; a throw or an unknown value reads as `gus_mf`. */
  readPlSources: () => Promise<unknown>;
  /** The GUS credential, or `null` when none is selected or it cannot be used. */
  resolveGusCredential: () => Promise<GusCredential | null>;
  now?: () => number;
  /** The whole lookup's ceiling for its registry legs; default {@link LOOKUP_DEADLINE_MS} less a second for Redis. */
  legDeadlineMs?: number;
  logger?: { info(obj: object, msg: string): void };
}

const SOURCE_OF: Readonly<Record<RegistryProvider, RegistrySource>> = { gus_pl: 'gus', mf_pl: 'mf', vies: 'vies' };

export class RegistryLookupService {
  private readonly now: () => number;
  private readonly legDeadlineMs: number;

  constructor(private readonly deps: RegistryLookupServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.legDeadlineMs = deps.legDeadlineMs ?? LOOKUP_DEADLINE_MS - 1000;
  }

  async lookup(request: { taxId: string; country: string }): Promise<RegistryLookupResult> {
    const normalized = normalizeTaxId(request);
    if (normalized.kind !== 'ok') {
      return {
        status: normalized.kind,
        lookupId: null,
        normalizedTaxId: null,
        country: registryLookupCountryForPicker(normalized.country),
        source: null,
        company: null,
        fetchedAt: null,
      };
    }
    const { country, taxId } = normalized;
    const plSources = country === 'PL' ? await this.readPlSources() : null;
    try {
      const cached = await this.deps.store.readAnswer(country, plSources, taxId);
      if (cached) {
        const ticket = await this.deps.store.mintTicket(cached, true);
        return toLookupResult(cached, ticket.lookupId);
      }
      const merged = plSources !== null ? await this.polish(plSources, taxId) : await this.vies(country, taxId);
      const answer: RegistryLookupAnswer = {
        status: merged.status,
        country,
        taxId,
        plSources,
        record: merged.record,
        dataSource: merged.dataSource,
        vatStatusSource: merged.vatStatusSource,
        attempts: merged.attempts,
        fetchedAt: new Date(this.now()).toISOString(),
      };
      await this.deps.store.writeAnswer(answer);
      const ticket = await this.deps.store.mintTicket(answer, false);
      return toLookupResult(answer, ticket.lookupId);
    } catch (err) {
      // A module's refusal is not an outage: it surfaces as the platform's 503.
      rethrowIfModuleDisabled(err);
      if (!(err instanceof RegistryLookupStoreError)) throw err;
      this.deps.logger?.info({ err: err.message }, 'organizations: registry lookup store unavailable; answering unavailable');
      return {
        status: 'unavailable',
        lookupId: null,
        normalizedTaxId: taxId,
        country: registryLookupCountryForPicker(country),
        source: null,
        company: null,
        fetchedAt: null,
      };
    }
  }

  private async readPlSources(): Promise<RegistryPlSources> {
    try {
      return parsePlSources(await this.deps.readPlSources());
    } catch {
      return 'gus_mf';
    }
  }

  private async polish(mode: RegistryPlSources, taxId: string): Promise<MergedLookup> {
    const clients = this.deps.clients();
    const input = { taxId, country: 'PL' };
    const [gus, mf] = await Promise.all([
      mode === 'mf' ? Promise.resolve(null) : this.gusLeg(clients.gusPl, input),
      mode === 'gus' ? Promise.resolve(null) : this.leg(clients.mfPl, input),
    ]);
    return mergePolishLegs(mode, { gus, mf });
  }

  private async vies(country: string, taxId: string): Promise<MergedLookup> {
    return mergeViesLeg(await this.leg(this.deps.clients().vies, { taxId, country }));
  }

  private async gusLeg(client: CompanyRegistryClient, input: CompanyRegistryLookupInput): Promise<RegistryLeg> {
    let credential: GusCredential | null;
    try {
      credential = await this.deps.resolveGusCredential();
    } catch (err) {
      // The composition's resolver asks whether `credentials` is present before
      // touching its port; a refusal that still arrives is the owner's to raise.
      rethrowIfModuleDisabled(err);
      credential = null;
    }
    if (credential === null) {
      return { provider: 'gus_pl', outcome: 'skipped', record: null, errorKind: 'not_configured', durationMs: null };
    }
    return this.leg(client, { ...input, gusCredential: credential });
  }

  /**
   * One registry call behind its budget and the lookup's deadline. A store
   * error propagates (fail closed); a client that throws or does not answer in
   * time is an `unavailable` leg.
   */
  private async leg(client: CompanyRegistryClient, input: CompanyRegistryLookupInput): Promise<RegistryLeg> {
    const provider = client.provider;
    if (!(await this.deps.store.consumeBudget(provider))) {
      return { provider, outcome: 'unavailable', record: null, errorKind: 'budget_exhausted', durationMs: null };
    }
    const started = this.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<CompanyRegistryAnswer>((resolve) => {
      timer = setTimeout(
        () => resolve({ provider, outcome: 'unavailable', record: null, errorKind: 'network_timeout' }),
        this.legDeadlineMs,
      );
    });
    try {
      const answer = await Promise.race([
        client.lookup(input).catch(
          (): CompanyRegistryAnswer => ({ provider, outcome: 'unavailable', record: null, errorKind: 'client_error' }),
        ),
        deadline,
      ]);
      return {
        provider,
        outcome: answer.outcome,
        record: answer.outcome === 'found' ? answer.record : null,
        errorKind: answer.errorKind,
        durationMs: Math.max(0, this.now() - started),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The public answer for a cached or fresh lookup (`contracts/public-api.md` §2). */
export function toLookupResult(answer: RegistryLookupAnswer, lookupId: string): RegistryLookupResult {
  const found = answer.status === 'found' && answer.record !== null;
  return {
    status: answer.status,
    lookupId,
    normalizedTaxId: answer.taxId,
    country: registryLookupCountryForPicker(answer.country),
    source: found && answer.dataSource ? SOURCE_OF[answer.dataSource] : null,
    company:
      found && answer.record
        ? {
            legalName: answer.record.legalName,
            registeredAddress: {
              street: answer.record.address.street,
              postalCode: answer.record.address.postalCode,
              city: answer.record.address.city,
              country: registryLookupCountryForPicker(answer.record.address.country),
            },
            regon: answer.record.regon,
            vatStatus: answer.record.vatPayerStatus,
            activityStatus: answer.record.activityStatus,
          }
        : null,
    fetchedAt: answer.fetchedAt,
  };
}
