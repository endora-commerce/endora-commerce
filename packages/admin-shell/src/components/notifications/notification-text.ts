import { interpolate } from '../../i18n/interpolate.js';
import { resolve } from '../../i18n/resolver.js';
import type { Bundle, SupportedAdminLanguage } from '../../i18n/types.js';

/**
 * A translatable sentence as the feed delivers it — `AdminNotificationMessage`
 * in `@endora-commerce/contracts`, restated structurally because what arrives
 * here is JSON and is read as such: every member is checked before it is used.
 */
export interface NotificationMessage {
  scope: string;
  key: string;
  params?: Record<string, string | number>;
}

/** The slice of the translation context a notification is resolved against. */
export interface NotificationTextBundles {
  language: SupportedAdminLanguage;
  bundle: Bundle;
  fallbackBundle: Bundle | undefined;
}

const PLACEHOLDER_RE = /\{(\w+)\}/g;

/**
 * The text of a bell entry in the reader's language, or the finished sentence
 * it was recorded with.
 *
 * An entry is one row read by several administrators, so it cannot arrive
 * translated (`specs/conventions/module-i18n.md`, the reader-is-plural case):
 * it carries the address of a template and the sentence its writer composed in
 * English. `fallback` is that sentence and it is answered whenever the message
 * cannot be drawn whole:
 *
 *  - there is no message — an older entry, an older backend, a writer that
 *    gives none;
 *  - no loaded bundle holds the key, in the reader's language or in English.
 *    The module that wrote the entry may be switched off or uninstalled by the
 *    time it is read, and an entry outlives both;
 *  - the template names a param the entry does not carry — a sentence with a
 *    hole in it is worse than a whole one in English.
 *
 * So the lookup goes through `resolve` and not through `t()`: `t()` answers
 * `scope.key` for a miss, and a raw key in the bell is exactly what this
 * exists to prevent. The result is a string for a React text node; a param is
 * never markup.
 */
export function notificationText<T extends string | null>(
  bundles: NotificationTextBundles,
  message: unknown,
  fallback: T,
): string | T {
  // No finished sentence means nothing to draw: a message never travels alone.
  if (fallback === null) return fallback;
  const parsed = parseMessage(message);
  if (!parsed) return fallback;

  const template = resolve({
    scope: parsed.scope,
    key: parsed.key,
    language: bundles.language,
    bundle: bundles.bundle,
    ...(bundles.fallbackBundle !== undefined ? { fallbackBundle: bundles.fallbackBundle } : {}),
  });
  if (template.outcome === 'placeholder') return fallback;

  for (const [, name] of template.value.matchAll(PLACEHOLDER_RE)) {
    if (name === undefined || !Object.hasOwn(parsed.params, name)) return fallback;
  }
  return interpolate(template.value, parsed.params);
}

function parseMessage(
  message: unknown,
): { scope: string; key: string; params: Record<string, string | number> } | null {
  if (typeof message !== 'object' || message === null) return null;
  const { scope, key, params } = message as Partial<Record<keyof NotificationMessage, unknown>>;
  if (typeof scope !== 'string' || scope === '' || typeof key !== 'string' || key === '')
    return null;
  const plain: Record<string, string | number> = {};
  if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
    for (const [name, value] of Object.entries(params)) {
      if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
        plain[name] = value;
      }
    }
  }
  return { scope, key, params: plain };
}
