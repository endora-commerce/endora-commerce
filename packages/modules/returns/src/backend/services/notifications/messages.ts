/**
 * The variables of the four e-mails of `specs/180-off-platform-complaints/`
 * (contracts/settings-emails-events.md §2, research R-5) — pure builders over what
 * a job read, so the wording rules are testable with nothing composed.
 *
 * E-mail *content* is the template's (`module-i18n.md`): what is built here is
 * values — the reference, a kind label in the channel's language, the product
 * list, a date and two links. An empty string is what a template's `{{if}}` reads
 * as absent, so a link that cannot be built is `''`, never a broken URL.
 */

/** Two-letter primary subtag of a language tag (`pl-PL` → `pl`). */
function primary(language: string): string {
  return language.split('-')[0]!.toLowerCase();
}

const KIND_LABELS: Record<string, Record<'return' | 'complaint', string>> = {
  en: { return: 'Return', complaint: 'Complaint' },
  pl: { return: 'Zwrot', complaint: 'Reklamacja' },
};

/** `Return` / `Complaint` in the e-mail's language; English for a language without a label. */
export function kindLabel(kind: 'return' | 'complaint', language: string): string {
  return (KIND_LABELS[primary(language)] ?? KIND_LABELS['en']!)[kind];
}

/** `2 × Widget, 1 × Gadget`. */
export function productList(lines: ReadonlyArray<{ productName: string; quantity: number }>): string {
  return lines.map((l) => `${l.quantity} × ${l.productName}`).join(', ');
}

/** The filing moment, as a date and a time in the shop's zone and the e-mail's language. */
export function formatSubmittedAt(at: Date, language: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(at);
  } catch {
    return at.toISOString();
  }
}

/** `<base>/returns/<id>`, or `''` without a base. */
export function caseLink(base: string | null | undefined, returnCaseId: string): string {
  const trimmed = (base ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? '' : `${trimmed}/returns/${returnCaseId}`;
}

/** A status's name in the e-mail's language: exact tag, then its primary subtag, then the default name. */
export function statusNameIn(
  status: { code: string; name: Record<string, string>; defaultName: string },
  language: string,
): string {
  return status.name[language] ?? status.name[primary(language)] ?? (status.defaultName || status.code);
}
