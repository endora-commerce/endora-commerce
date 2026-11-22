/**
 * The names the returns screens show in place of codes and ids (issue #1472, UX
 * audit SALES-07): a status by its name in the operator's language, a delivery
 * method by its name rather than its UUID. Pure, so the fallbacks are pinned
 * without rendering a screen.
 */

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@endora-commerce/contracts';

/** A translated text: the operator's language, else English, else the first one, else `fallback`. */
export function localizedText(
  text: Readonly<Record<string, string>> | null | undefined,
  language: string,
  fallback: string,
): string {
  if (!text) return fallback;
  return text[language] || text['en'] || Object.values(text).find((v) => v !== '') || fallback;
}

/**
 * A return status as the screens name it — the backend's own order
 * (`resolveReturnStatusName`): its name in `language`, else a non-empty entry of
 * the same primary language (`pl-PL` for `pl`, `pl` for `pl-PL`), else its
 * language-independent default name, else its code. Never another language.
 *
 * The names are operator content stored per language, so the admin reads all of
 * them and picks one (`specs/conventions/module-i18n.md`); an admin read's
 * `statusLabel` is the default name and is only the fallback for a status the
 * graph no longer holds (issue #1815).
 */
export function returnStatusName(
  status: { code: string; name: Readonly<Record<string, string>>; defaultName?: string | null },
  language: string,
): string {
  // Defensive: a status read from an older payload may carry no `name` map.
  const names = status.name ?? {};
  const exact = names[language];
  if (exact) return exact;
  const primary = language.split('-', 1)[0]!.toLowerCase();
  for (const [key, value] of Object.entries(names)) {
    const lowered = key.toLowerCase();
    if (value && (lowered === primary || lowered.startsWith(`${primary}-`))) return value;
  }
  return status.defaultName || status.code;
}

/** A delivery method as the `delivery_methods` admin list returns it, read as is. */
export interface DeliveryMethodOption {
  id: string;
  code: string;
  name: Record<string, string>;
}

/**
 * The name of the delivery method a return method points at. `null` when the
 * list does not hold it — the list could not be read, or the method was
 * deleted — so the screen can say so rather than print the UUID as a name.
 */
export function deliveryMethodName(
  id: string,
  methods: readonly DeliveryMethodOption[] | null | undefined,
  language: string,
): string | null {
  const method = methods?.find((m) => m.id === id);
  return method ? localizedText(method.name, language, method.code) : null;
}

/**
 * The name fields of a reason or status form: one per language the platform ships
 * (owner decision 2026-11-21 — a Polish name, not only an English one). The returns
 * clauses use the same set (`ReturnClausesPage`), and so does the storefront's
 * resolution (`ReturnFormLines`): the buyer's language, else English.
 */
export type NameDraft = Record<SupportedLanguage, string>;

/** The form's starting values: the stored name in each shipped language, else empty. */
export function nameDraft(names: Readonly<Record<string, string>> | null | undefined): NameDraft {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [lang, names?.[lang] ?? ''])) as NameDraft;
}

/**
 * The map to send: the stored one with every shipped language set from the form,
 * trimmed, and a cleared one dropped. A language the form does not draw (an older
 * row's `de`) is kept — the update replaces the whole map.
 */
export function mergeNames(existing: Readonly<Record<string, string>> | null | undefined, draft: NameDraft): Record<string, string> {
  const next: Record<string, string> = { ...(existing ?? {}) };
  for (const lang of SUPPORTED_LANGUAGES) {
    const value = draft[lang].trim();
    if (value) next[lang] = value;
    else delete next[lang];
  }
  return next;
}

/**
 * The language-independent name — a status's `defaultName`, the source its code is
 * derived from (Tesler): English, else Polish, else empty.
 */
export function primaryName(draft: NameDraft): string {
  for (const lang of SUPPORTED_LANGUAGES) {
    const value = draft[lang].trim();
    if (value) return value;
  }
  return '';
}

/** The shipped languages a stored map has no name in, for the row's "missing" badge. */
export function missingLanguages(names: Readonly<Record<string, string>> | null | undefined): SupportedLanguage[] {
  return SUPPORTED_LANGUAGES.filter((lang) => !names?.[lang]?.trim());
}
