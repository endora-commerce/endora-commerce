/**
 * The names the returns screens show in place of codes and ids (issue #1472, UX
 * audit SALES-07): a status by its name in the operator's language, a delivery
 * method by its name rather than its UUID. Pure, so the fallbacks are pinned
 * without rendering a screen.
 */

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
 * (`resolveReturnStatusName`): its name in `language`, else its
 * language-independent default name, else its code. Never another language.
 */
export function returnStatusName(
  status: { code: string; name: Readonly<Record<string, string>>; defaultName?: string | null },
  language: string,
): string {
  // Defensive: a status read from an older payload may carry no `name` map.
  return status.name?.[language] || status.defaultName || status.code;
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
