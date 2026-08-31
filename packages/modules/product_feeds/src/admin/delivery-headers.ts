import { FEED_DELIVERY_REDACTED, isSecretDeliveryHeader } from '@endora-commerce/contracts';
import type { FeedDeliveryHeader, FeedDeliveryHeaderInput } from '@endora-commerce/contracts';

/**
 * The Headers textarea ↔ header list conversion — feature 070.
 *
 * The reference screenshot offers a textarea, one `Name: Value` per line, and
 * that is the right control: an operator pastes what the partner e-mailed them.
 * The API takes a list, so the conversion lives here, pure and on its own, for
 * the reason the storefront harness note gives — a pure function is unit-
 * testable, a `useState` inside a form is not.
 *
 * A secret header round-trips as `Authorization: [redacted]`. Showing the name
 * and hiding the value is the only honest rendering: dropping the line entirely
 * would make the operator re-add a header that is already stored, and showing
 * the value would defeat FR-107.
 */

/** Parses the textarea. Blank lines and `#` comments are ignored, not errors. */
export function parseHeaderLines(text: string): FeedDeliveryHeaderInput[] {
  const out: FeedDeliveryHeaderInput[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    // A line with no colon is kept as a name with an empty value rather than
    // dropped, so the server's validation error names it and the operator can
    // see which line it meant.
    if (colon === -1) {
      out.push({ name: line, value: '' });
      continue;
    }
    out.push({
      name: line.slice(0, colon).trim(),
      value: line.slice(colon + 1).trim(),
    });
  }
  return out;
}

/** Renders stored headers back into the textarea, secrets masked. */
export function toHeaderLines(headers: readonly FeedDeliveryHeader[]): string {
  return headers
    .map((header) => `${header.name}: ${header.secret ? FEED_DELIVERY_REDACTED : header.value ?? ''}`)
    .join('\n');
}

/** The header names on screen whose value will be stored encrypted (FR-107). */
export function secretHeaderNames(text: string): string[] {
  return parseHeaderLines(text)
    .map((header) => header.name)
    .filter((name) => isSecretDeliveryHeader(name));
}

/** Duplicate names, case-insensitively — the one error worth catching on screen. */
export function duplicateHeaderNames(text: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const header of parseHeaderLines(text)) {
    const key = header.name.toLowerCase();
    if (seen.has(key)) duplicates.add(header.name);
    seen.add(key);
  }
  return [...duplicates];
}
