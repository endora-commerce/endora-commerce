/**
 * A `details[]` entry whose `message` the error envelope translates into the
 * response language (`specs/193-admin-form-extensions/` FR-042, research R-17).
 *
 * The thrower cannot translate: the platform's field-rule check runs inside a
 * Command, where no request — and so no reader's language — is in reach. It
 * writes the English sentence as `message` and marks the entry with the bundle
 * key that holds the sentence; the envelope, which resolves the language for
 * the top-level message already, resolves each marked entry the same way.
 *
 * The mark is a symbol-keyed property, so it never reaches the wire: an entry
 * serialises to exactly what the thrower wrote. An unmarked entry — every
 * entry any other code writes — is left alone.
 */

const LOCALIZABLE = Symbol.for('endora-commerce.platform.localizable-detail');

/** Which bundle sentence an entry's `message` is, and the values for its placeholders. */
export interface LocalizableMessageRef {
  readonly moduleId: string;
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** Mark `entry` as carrying the sentence `ref` names, and return it. */
export function localizableDetail<T extends { message: string }>(entry: T, ref: LocalizableMessageRef): T {
  Object.defineProperty(entry, LOCALIZABLE, { value: ref, enumerable: false });
  return entry;
}

/** The mark on `entry`, or `undefined`. */
export function localizableMessageRef(entry: unknown): LocalizableMessageRef | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  return (entry as { [LOCALIZABLE]?: LocalizableMessageRef })[LOCALIZABLE];
}
