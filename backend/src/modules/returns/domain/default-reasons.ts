/**
 * Default return/complaint reasons shipped on install (feature 046, US7).
 *
 * Single source of truth shared by the init migration and the runtime seeder
 * (`ReturnsSeeder`), so a reinstall after a lifecycle uninstall restores the
 * same defaults. B2B-oriented examples from the spec.
 */
export interface ReturnReasonSeed {
  label: Record<string, string>;
  appliesTo: 'return' | 'complaint' | 'both';
  weight: number;
}

export const DEFAULT_RETURN_REASONS: ReadonlyArray<ReturnReasonSeed> = [
  { label: { en: 'Overstock / surplus', pl: 'Nadwyżka magazynowa' }, appliesTo: 'return', weight: 10 },
  { label: { en: 'Ordered by mistake', pl: 'Błędne zamówienie' }, appliesTo: 'return', weight: 20 },
  { label: { en: 'Changed mind', pl: 'Rezygnacja' }, appliesTo: 'return', weight: 30 },
  { label: { en: 'Damaged in transit', pl: 'Uszkodzone w transporcie' }, appliesTo: 'complaint', weight: 40 },
  { label: { en: 'Factory defect', pl: 'Wada fabryczna' }, appliesTo: 'complaint', weight: 50 },
  { label: { en: 'Wrong item delivered', pl: 'Dostarczono niewłaściwy produkt' }, appliesTo: 'both', weight: 60 },
];
