import type {
  CompanyRegistryRecord,
  RegistryAttempt,
  RegistryPlSources,
  RegistryProvider,
} from './company-registry-port.js';

/**
 * Feature 173 — how one lookup's registry legs become one answer (research
 * R-3). Pure: the service runs the legs, this decides.
 *
 * A leg the Polish-sources mode excludes is passed as `null`, and is recorded
 * in the attempts as `skipped` / `excluded_by_setting`, so a moderator can tell
 * "not asked" from "failed". A leg the mode includes but could not run —
 * GUS with no usable credential — arrives as `skipped` / `not_configured`, and
 * one refused by its budget as `unavailable` / `budget_exhausted`; for the
 * merge both are "GUS did not answer".
 */

export interface RegistryLeg {
  provider: RegistryProvider;
  outcome: RegistryAttempt['outcome'];
  record: CompanyRegistryRecord | null;
  errorKind: string | null;
  durationMs: number | null;
}

export interface MergedLookup {
  status: 'found' | 'not_found' | 'unavailable';
  record: CompanyRegistryRecord | null;
  dataSource: RegistryProvider | null;
  vatStatusSource: 'mf_pl' | 'vies' | null;
  attempts: RegistryAttempt[];
}

function attemptOf(leg: RegistryLeg): RegistryAttempt {
  return { provider: leg.provider, outcome: leg.outcome, errorKind: leg.errorKind, durationMs: leg.durationMs };
}

function excluded(provider: RegistryProvider): RegistryAttempt {
  return { provider, outcome: 'skipped', errorKind: 'excluded_by_setting', durationMs: null };
}

function nothing(status: 'not_found' | 'unavailable', attempts: RegistryAttempt[]): MergedLookup {
  return { status, record: null, dataSource: null, vatStatusSource: null, attempts };
}

/**
 * A Polish NIP, under the mode in force. `gus` is `null` under `mf`, `mf` is
 * `null` under `gus`; under `gus_mf` both are legs.
 */
export function mergePolishLegs(
  mode: RegistryPlSources,
  legs: { gus: RegistryLeg | null; mf: RegistryLeg | null },
): MergedLookup {
  const attempts = [
    legs.gus ? attemptOf(legs.gus) : excluded('gus_pl'),
    legs.mf ? attemptOf(legs.mf) : excluded('mf_pl'),
  ];
  const gus = mode === 'mf' ? null : legs.gus;
  const mf = mode === 'gus' ? null : legs.mf;

  if (gus?.outcome === 'found' && gus.record) {
    // GUS supplies name, REGON, the structured address and the activity; the
    // White List, when asked, the VAT status.
    if (mf === null) {
      return { status: 'found', record: { ...gus.record, vatPayerStatus: 'unknown' }, dataSource: 'gus_pl', vatStatusSource: null, attempts };
    }
    if (mf.outcome === 'found' && mf.record) {
      return {
        status: 'found',
        record: { ...gus.record, vatPayerStatus: mf.record.vatPayerStatus },
        dataSource: 'gus_pl',
        vatStatusSource: 'mf_pl',
        attempts,
      };
    }
    if (mf.outcome === 'not_found') {
      return {
        status: 'found',
        record: { ...gus.record, vatPayerStatus: 'not_registered' },
        dataSource: 'gus_pl',
        vatStatusSource: 'mf_pl',
        attempts,
      };
    }
    return { status: 'found', record: { ...gus.record, vatPayerStatus: 'unknown' }, dataSource: 'gus_pl', vatStatusSource: null, attempts };
  }

  if (mf?.outcome === 'found' && mf.record) {
    return { status: 'found', record: mf.record, dataSource: 'mf_pl', vatStatusSource: 'mf_pl', attempts };
  }
  // GUS is authoritative for existence; the White List speaks for it when GUS
  // could not answer.
  if (gus?.outcome === 'not_found' || mf?.outcome === 'not_found') return nothing('not_found', attempts);
  return nothing('unavailable', attempts);
}

/** Every other EU VAT number: VIES alone, whatever the Polish-sources mode. */
export function mergeViesLeg(leg: RegistryLeg): MergedLookup {
  const attempts = [attemptOf(leg)];
  if (leg.outcome === 'found' && leg.record) {
    return { status: 'found', record: leg.record, dataSource: 'vies', vatStatusSource: 'vies', attempts };
  }
  return nothing(leg.outcome === 'not_found' ? 'not_found' : 'unavailable', attempts);
}
