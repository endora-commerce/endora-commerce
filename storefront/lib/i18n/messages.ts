import { account } from './messages/account';
import { auth } from './messages/auth';
import { chrome } from './messages/chrome';
import { commerce } from './messages/commerce';
import { content } from './messages/content';
import { core } from './messages/core';
import type { NamespaceKey } from './messages/define';

/**
 * Tiny in-tree message catalogue. The reference theme uses this for
 * navigation labels, button captions, and other chrome that is *not*
 * editorial content (CMS pages cover editorial).
 *
 * Themes typically override `components/*` rather than message keys; if
 * a theme wants its own copy, it can replace this file or extend the
 * record.
 */

export type SupportedLocale = string;

/**
 * The catalogue's namespaces (issue #85), one file per area of the storefront
 * under `./messages/`. A new key goes in the namespace of the area that renders
 * it — never here, so branches keying different areas never touch this file.
 *
 * `core` holds every key that existed when the catalogue was split; the five
 * others are the areas the remaining hard-coded strings are keyed into. No key
 * may be declared in two namespaces: the merge below would silently keep the
 * later one, so `test/i18n/message-namespaces.test.ts` refuses it.
 */
export const MESSAGE_NAMESPACES = {
  core,
  commerce,
  account,
  auth,
  chrome,
  content,
} as const;

type Namespaces = typeof MESSAGE_NAMESPACES;

/** Every catalogue key — the union of the namespaces' keys, derived rather than written. */
export type MessageKey = { [N in keyof Namespaces]: NamespaceKey<Namespaces[N]> }[keyof Namespaces];

function merged(locale: 'en-US' | 'pl-PL'): Record<MessageKey, string> {
  return Object.assign(
    {},
    ...Object.values(MESSAGE_NAMESPACES).map((namespace) => namespace[locale]),
  ) as Record<MessageKey, string>;
}

export const MESSAGES: Record<string, Record<MessageKey, string>> = {
  'en-US': merged('en-US'),
  'pl-PL': merged('pl-PL'),
};

/**
 * The locales this catalogue carries.
 *
 * Derived from the catalogue rather than written beside it, so a third language
 * is reachable by the outage notice the moment its block exists and there is no
 * second list to keep in step.
 */
export const CATALOGUE_LOCALES: readonly string[] = Object.keys(MESSAGES);

export function tForLocale(locale: string): (key: MessageKey) => string {
  const dictionary = MESSAGES[locale] ?? MESSAGES['en-US']!;
  return (key) => dictionary[key] ?? MESSAGES['en-US']![key] ?? key;
}
