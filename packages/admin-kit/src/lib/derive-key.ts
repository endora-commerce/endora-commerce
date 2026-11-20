import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { slugify } from '@endora-commerce/contracts';

/**
 * Issue #1450 (DS-22) — a slug, key or code proposed from the name.
 *
 * Category slugs, custom-field keys, attribute keys and status or priority
 * codes used to be typed by hand and refused when malformed, which made the
 * operator do work the system can do (Tesler's law) and punished input the
 * system could have accepted (Postel's law). Every such field now behaves the
 * same way:
 *
 * 1. **It follows the name** until the operator edits it — `useDerivedKey`.
 *    Clearing it resumes following.
 * 2. **It is normalised on blur**: `In Review` becomes `in_review` rather than
 *    being refused.
 * 3. **Only what is still invalid is refused**, by the screen — a leading digit,
 *    a reserved word, a key already taken. A collision is refused, never
 *    auto-suffixed: the key is an identifier the operator will see again, and
 *    `in_review_2` is a decision nobody made (architect ruling on #512).
 *
 * The derivation is `slugify` from `@endora-commerce/contracts`, the one slug
 * generator, so the fold (`ł` → `l`, `ß` → `ss`) is the backend's too.
 */
export interface DeriveKeyOptions {
  /** `'-'` for slugs (the default), `'_'` for keys and codes. */
  separator?: string;
  /** The longest key the server accepts; the cut never leaves a trailing separator. */
  maxLength?: number;
}

/** The key `name` proposes: folded, lower-case, every other run collapsed to the separator. */
export function deriveKey(name: string, options: DeriveKeyOptions = {}): string {
  return slugify(name, {
    separator: options.separator ?? '-',
    ...(options.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
  });
}

export interface UseDerivedKeyOptions extends DeriveKeyOptions {
  /** The name the key is derived from — for a translated name, the English one. */
  source: string;
  /** The key as the screen holds it: the hook owns no copy. */
  value: string;
  onChange: (key: string) => void;
  /**
   * `false` where the key is fixed — an edit view of a record whose key is
   * immutable. The hook then neither follows nor normalises.
   */
  enabled?: boolean;
}

export interface DerivedKeyField {
  /** Whether the key still follows the name. */
  following: boolean;
  /** For the key input: what the operator types is kept as typed until blur. */
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** For the key input: normalises the key, or fills it from the name when left empty. */
  onBlur: () => void;
  /**
   * What `onBlur` does, returning the key it wrote — for the submit handler, so
   * a form sent with Enter from the key field is normalised too (no blur fires).
   * Where the hook is disabled it returns the value unchanged.
   */
  commit: () => string;
}

/**
 * The key field's behaviour, for a controlled input. The screen keeps the key
 * in its own state and validates it on submit as before; this hook only writes
 * the derived or normalised value through `onChange`.
 *
 * A key the screen starts with that the name does not produce — a draft
 * restored, a value passed in — counts as edited, so it is never overwritten.
 */
export function useDerivedKey(options: UseDerivedKeyOptions): DerivedKeyField {
  const { source, value, onChange, separator, maxLength } = options;
  const enabled = options.enabled ?? true;
  const derive = useCallback(
    (text: string): string =>
      deriveKey(text, { ...(separator !== undefined ? { separator } : {}), ...(maxLength !== undefined ? { maxLength } : {}) }),
    [separator, maxLength],
  );
  const [following, setFollowing] = useState(() => value === '' || value === derive(source));
  // The latest key and writer, read by the follow effect without re-running it
  // on every keystroke in the key field: it follows the *name*.
  const latest = useRef({ value, onChange, following });
  latest.current = { value, onChange, following };

  useEffect(() => {
    if (!enabled || !latest.current.following) return;
    const next = derive(source);
    if (next !== latest.current.value) latest.current.onChange(next);
  }, [enabled, source, derive]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const typed = event.target.value;
      if (enabled) setFollowing(typed === '');
      onChange(typed);
    },
    [enabled, onChange],
  );

  const commit = useCallback((): string => {
    if (!enabled) return value;
    const normalised = derive(value);
    const next = normalised === '' ? derive(source) : normalised;
    if (normalised === '') setFollowing(true);
    if (next !== value) onChange(next);
    return next;
  }, [enabled, derive, value, source, onChange]);
  const handleBlur = useCallback((): void => {
    commit();
  }, [commit]);

  return { following: enabled && following, onChange: handleChange, onBlur: handleBlur, commit };
}
