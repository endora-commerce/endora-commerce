/**
 * One namespace of the storefront's message catalogue (issue #85).
 *
 * The catalogue was one file — a hand-written `MessageKey` union and two locale
 * blocks — so every change appended to the same three places and any two
 * branches adding keys collided. It is a set of namespace files now, one per
 * area of the storefront, and `../messages.ts` composes them. This is the one
 * shape each of them is written in.
 *
 * **`pl-PL` must carry exactly the keys `en-US` does, and `tsc` says so.** The
 * English block is what the key set is inferred from; the Polish block is
 * checked against it with inference switched off (`NoInfer`), so a key missing
 * from it is a missing-property error and a key only it has is an
 * excess-property error. That keeps the property the single-file catalogue had
 * through its total inner `Record` — a Polish string missing from the
 * catalogue is a type error, not a runtime fallback — now per namespace.
 */
export interface MessageNamespace<K extends string> {
  readonly 'en-US': Readonly<Record<K, string>>;
  readonly 'pl-PL': Readonly<Record<K, string>>;
}

/** The keys a namespace declares. */
export type NamespaceKey<N> = N extends MessageNamespace<infer K> ? K : never;

/**
 * Declare one namespace. Write the English block first: it defines the keys.
 *
 * ```ts
 * export const commerce = defineMessages({
 *   'en-US': { 'commerce.cart.heading': 'Your cart' },
 *   'pl-PL': { 'commerce.cart.heading': 'Twój koszyk' },
 * });
 * ```
 */
export function defineMessages<const E extends Readonly<Record<string, string>>>(blocks: {
  readonly 'en-US': E;
  readonly 'pl-PL': NoInfer<{ readonly [K in keyof E]: string }>;
}): MessageNamespace<keyof E & string> {
  return blocks;
}
