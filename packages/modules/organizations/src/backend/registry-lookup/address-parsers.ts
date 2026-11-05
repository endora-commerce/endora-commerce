/**
 * Feature 173 — splitting the White List's and VIES's one-line addresses into
 * the registration form's street, postal code and city (research R-6).
 *
 * Best-effort by design: whatever cannot be split confidently stays in the
 * street and the rest is left empty for the buyer, because an empty field beats
 * an invented one (FR-005). The case is kept as the registry wrote it —
 * title-casing Polish names is wrong often enough to be worse than upper case
 * in an editable field.
 */

export interface ParsedAddress {
  street: string | null;
  postalCode: string | null;
  city: string | null;
}

const EMPTY: ParsedAddress = { street: null, postalCode: null, city: null };
const PL_POSTAL_AND_CITY = /^(\d{2}-\d{3})\s+(.+)$/;
const ANY_POSTAL_AND_CITY = /^(\S*\d\S*)\s+(.+)$/;

/** `"<street part>, <NN-NNN> <CITY>"`, split at the last `", "`. */
export function parseWhiteListAddress(value: string | null | undefined): ParsedAddress {
  const address = (value ?? '').trim();
  if (address === '') return EMPTY;
  const comma = address.lastIndexOf(', ');
  if (comma <= 0) return { ...EMPTY, street: address };
  const match = PL_POSTAL_AND_CITY.exec(address.slice(comma + 2).trim());
  if (!match) return { ...EMPTY, street: address };
  return { street: address.slice(0, comma).trim(), postalCode: match[1]!, city: match[2]!.trim() };
}

/**
 * Lines of a VIES address: when there are several and the last one starts with
 * a token holding a digit, that token is the postal code and the rest the
 * city; the earlier lines, joined with `", "`, are the street. A single line is
 * all street — one line cannot tell a house number from a postal code. `---`
 * is how a member state that does not disclose the address answers.
 */
export function parseViesAddress(value: string | null | undefined): ParsedAddress {
  const address = (value ?? '').trim();
  if (address === '' || address === '---') return EMPTY;
  const lines = address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return EMPTY;
  const last = lines[lines.length - 1]!;
  const match = lines.length > 1 ? ANY_POSTAL_AND_CITY.exec(last) : null;
  if (!match) return { ...EMPTY, street: lines.join(', ') };
  return { street: lines.slice(0, -1).join(', '), postalCode: match[1]!, city: match[2]!.trim() };
}

/** VIES and the White List spell "not disclosed" as `---`; that and blank are no value. */
export function registryText(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' || text === '---' ? null : text;
}
