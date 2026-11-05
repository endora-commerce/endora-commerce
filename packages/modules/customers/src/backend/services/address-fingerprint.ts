/**
 * What counts as "the same address" when the release-1 retirement job moves a
 * B2C personal-book row into the personal Organization's book
 * (`specs/173-b2c-address-book-merge/` plan R-4).
 *
 * Two rows are equal when they are of the same kind and these fields match
 * after normalisation:
 *
 * - `recipientName`, `street`, `city`: trimmed, inner whitespace collapsed,
 *   NFC, case-folded;
 * - `postalCode`: whitespace removed, upper-cased;
 * - `country`: upper-cased;
 * - `phone`: digits and a leading `+` only; absent equals absent.
 *
 * Diacritics are **not** folded. The rule is narrow on purpose: a false merge
 * loses an address, a false non-merge only shows one twice.
 */
export interface FingerprintedAddress {
  readonly kind: 'delivery' | 'billing';
  readonly recipientName: string;
  readonly street: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
  readonly phone?: string | null | undefined;
}

function text(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
}

function phone(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/gu, '');
  if (digits === '') return '';
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/**
 * One string per address, equal exactly when two addresses are equal under
 * the rule above. The fields are joined with a separator no normalised field
 * can contain, so text cannot move from one field to the next and collide.
 */
export function addressFingerprint(address: FingerprintedAddress): string {
  return [
    address.kind,
    text(address.recipientName),
    text(address.street),
    text(address.city),
    address.postalCode.replace(/\s+/gu, '').toUpperCase(),
    address.country.trim().toUpperCase(),
    phone(address.phone),
  ].join('\u0000');
}

/**
 * Whether a moved row becomes the default of its kind (OD-2): only a row that
 * was the personal default, and only when the Organization book has no default
 * of that kind yet — an existing Organization default always stays.
 */
export function takesOverDefault(
  row: { readonly kind: 'delivery' | 'billing'; readonly isDefault: boolean },
  bookDefaultKinds: ReadonlySet<string>,
): boolean {
  return row.isDefault && !bookDefaultKinds.has(row.kind);
}
