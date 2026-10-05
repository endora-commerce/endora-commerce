import type { EntityManager } from '@mikro-orm/postgresql';

const PREFIX = 'OPP-';
const PAD = 6;

/**
 * The human-readable number of an Opportunity: `OPP-` and the sequence value,
 * zero-padded to six digits (`OPP-000123`). A value past six digits is written
 * in full — the padding is a floor, never a truncation.
 *
 * The sequence value arrives from the driver as a string (`bigint`), so both
 * spellings are accepted.
 */
export function formatOpportunityNumber(sequenceValue: number | string | bigint): string {
  const digits = String(sequenceValue).trim();
  if (!/^[1-9]\d*$/.test(digits)) {
    throw new Error(`crm: "${String(sequenceValue)}" is not a value of crm_opportunity_number_seq.`);
  }
  return `${PREFIX}${digits.padStart(PAD, '0')}`;
}

/**
 * The next number, taken from `crm_opportunity_number_seq` on the caller's
 * transaction. A sequence does not roll back, so a refused create leaves a gap
 * rather than a duplicate — which is the trade a sequence is for.
 */
export async function nextOpportunityNumber(em: EntityManager): Promise<string> {
  const rows = (await em.execute(`select nextval('crm_opportunity_number_seq') as value`)) as Array<{
    value: string | number;
  }>;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('crm: crm_opportunity_number_seq returned no value.');
  return formatOpportunityNumber(value);
}
