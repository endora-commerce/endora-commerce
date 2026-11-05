import { foldDiacritics, type RegistryDivergence, type SubmittedCompanyValues } from '@endora-commerce/contracts';

/**
 * Feature 173 — where a registration's submission differs from what the
 * registry answered (research R-14; FR-022), computed on read from the two
 * persisted snapshots, so the comparison rules can improve without rewriting
 * history.
 *
 * Two values are equal when their comparison forms are: Unicode NFC, folded
 * diacritics, lower case, punctuation removed, whitespace collapsed; a leading
 * street-type prefix (`ul`, `al`, `pl`, `os` and their full words) dropped
 * from a street; a postal code reduced to its digits; the Polish legal forms
 * reduced to one token each. The White List writes upper case, so an exact
 * comparison would flag every Polish registration. A field the registry left
 * empty is never a divergence.
 */

export interface RegistrySide {
  name: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

const PUNCTUATION = /[.,"'„”“’`-]/g;

/** Longest first: a longer form contains a shorter one. */
const LEGAL_FORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ prosta spolka akcyjna /g, ' psa '],
  [/ p s a /g, ' psa '],
  [/ spolka komandytowo akcyjna /g, ' ska '],
  [/ s k a /g, ' ska '],
  [/ spolka z ograniczona odpowiedzialnoscia /g, ' spzoo '],
  [/ (?:sp|spolka) z o ?o /g, ' spzoo '],
  [/ (?:sp|spolka) zoo /g, ' spzoo '],
  [/ spolka komandytowa /g, ' spk '],
  [/ sp k /g, ' spk '],
  [/ spolka jawna /g, ' spj '],
  [/ sp j /g, ' spj '],
  [/ spolka akcyjna /g, ' sa '],
  [/ s a /g, ' sa '],
];

const STREET_PREFIX = /^(?:ul|ulica|al|aleja|aleje|pl|plac|os|osiedle) /;

function base(value: string): string {
  return foldDiacritics(value.normalize('NFC')).toLowerCase().replace(PUNCTUATION, ' ').replace(/\s+/g, ' ').trim();
}

function nameForm(value: string): string {
  let padded = ` ${base(value)} `;
  for (const [pattern, token] of LEGAL_FORMS) padded = padded.replace(pattern, token);
  return padded.replace(/\s+/g, ' ').trim();
}

function streetForm(value: string): string {
  return base(value).replace(STREET_PREFIX, '');
}

function postalForm(value: string): string {
  return value.replace(/\D/g, '');
}

function countryForm(value: string): string {
  const upper = value.trim().toUpperCase();
  return upper === 'EL' ? 'GR' : upper;
}

const FIELDS: ReadonlyArray<{
  field: RegistryDivergence['field'];
  registry: (side: RegistrySide) => string | null;
  submitted: (values: SubmittedCompanyValues) => string;
  form: (value: string) => string;
}> = [
  { field: 'name', registry: (r) => r.name, submitted: (s) => s.name, form: nameForm },
  { field: 'street', registry: (r) => r.street, submitted: (s) => s.registeredAddress.street, form: streetForm },
  { field: 'postalCode', registry: (r) => r.postalCode, submitted: (s) => s.registeredAddress.postalCode, form: postalForm },
  { field: 'city', registry: (r) => r.city, submitted: (s) => s.registeredAddress.city, form: base },
  { field: 'country', registry: (r) => r.country, submitted: (s) => s.registeredAddress.country, form: countryForm },
];

export function computeRegistryDivergence(registry: RegistrySide, submitted: SubmittedCompanyValues): RegistryDivergence[] {
  const differences: RegistryDivergence[] = [];
  for (const { field, registry: registryOf, submitted: submittedOf, form } of FIELDS) {
    const registryValue = registryOf(registry);
    if (registryValue === null || registryValue.trim() === '') continue;
    const submittedValue = submittedOf(submitted);
    if (form(registryValue) !== form(submittedValue)) {
      differences.push({ field, registry: registryValue, submitted: submittedValue });
    }
  }
  return differences;
}
