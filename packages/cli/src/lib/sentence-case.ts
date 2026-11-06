/**
 * The one sentence-case rule for English UI labels and documentation titles
 * (issues #746 and #776), and its one allowlist.
 *
 * Two callers read it: `endora new module`, which refuses a title-case
 * `--name` before it writes a byte, and the backend drift test
 * (`backend/test/unit/_i18n/registered-bundles-shape.test.ts`), which judges
 * every registered label and holds the allowlist two-way — an entry nothing
 * uses fails there.
 *
 * The rule: after the first word, no word may start with a capital followed by
 * a lowercase letter, and the first word may not start lowercase. Acronyms
 * (`API`, `CRM`, `PDF`) are all capitals and pass. Product names and other
 * proper nouns are the allowlist.
 */

/**
 * Proper nouns that keep their capitals inside a sentence-case label. A
 * multi-word entry is matched as a phrase, so `Google Tag Manager` passes
 * whole while `Tag Manager` alone would not.
 */
export const SENTENCE_CASE_PROPER_NOUNS: readonly string[] = [
  // Constitution XIII's name for the write path, used as a name in the docs.
  'Command Bus',
  'Endora Commerce',
  'Google Analytics',
  'Google Tag Manager',
  'LinkedIn Ads',
  'LinkedIn',
  'Meta Ads',
  'Meta',
  // The CMS editor's product name, written so across the admin bundles.
  'Page Builder',
  'Warden',
];

export interface SentenceCaseVerdict {
  /** The words that break the rule, in the order they appear. Empty when the text passes. */
  readonly offending: readonly string[];
  /** The allowlist entries the text contains. */
  readonly nouns: readonly string[];
}

/** Leading punctuation does not hide a word: `(Cross` is judged as `Cross`. */
const wordOf = (token: string): string => token.replace(/^[^\p{L}\p{N}]+/u, '');

/** A standalone dash separates two titles: `Newsletter — Email blocks`. */
const isSeparator = (token: string): boolean => token === '—' || token === '–';

/** A word after `.`, `!` or `?` begins a new sentence and may be capitalised. */
const endsSentence = (token: string): boolean => /[.!?]["')\]]*$/u.test(token);

const isTitleCaseWord = (word: string): boolean => /^\p{Lu}\p{Ll}/u.test(word);

/**
 * Walk the words of `text` with the allowlisted nouns and `{placeholders}`
 * masked, calling `visit` for each word that is not free to be capitalised.
 * Returns the masked text rebuilt from what `visit` returned.
 */
function walk(
  text: string,
  nouns: readonly string[],
  visit: (word: string, first: boolean) => string,
): { readonly rebuilt: string; readonly found: readonly string[] } {
  const kept: string[] = [];
  const found: string[] = [];
  let rest = text.replace(/\{[^}]*\}/g, (placeholder) => {
    kept.push(placeholder);
    return `\u0000${kept.length - 1}\u0000`;
  });
  for (const noun of nouns) {
    // Whole words only: `Meta` must not hide `Metadata`.
    const escaped = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
    if (pattern.test(rest)) {
      found.push(noun);
      rest = rest.replace(pattern, `\u0000${kept.length}\u0000`);
      kept.push(noun);
    }
  }
  let first = true;
  let free = false;
  const rebuilt = rest.replace(/\S+/g, (token) => {
    if (isSeparator(token)) {
      free = true;
      return token;
    }
    const word = wordOf(token);
    if (word.length === 0 || /^[^\p{L}\p{N}]*\u0000/u.test(token)) {
      first = false;
      free = endsSentence(token);
      return token;
    }
    const lead = token.slice(0, token.length - word.length);
    const out = free && !first ? word : visit(word, first);
    first = false;
    free = endsSentence(token);
    return lead + out;
  });
  return {
    rebuilt: rebuilt.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => kept[Number(index)]!),
    found,
  };
}

/** Judge one English label against the rule. */
export function judgeSentenceCase(
  text: string,
  nouns: readonly string[] = SENTENCE_CASE_PROPER_NOUNS,
): SentenceCaseVerdict {
  const offending: string[] = [];
  const { found } = walk(text, nouns, (word, first) => {
    if (first ? /^\p{Ll}/u.test(word) : isTitleCaseWord(word)) offending.push(word);
    return word;
  });
  return { offending, nouns: found };
}

/**
 * The sentence-case form of `text`, for a refusal message to suggest: the first
 * letter raised, every offending word after it lowered, allowlisted nouns kept.
 */
export function toSentenceCase(
  text: string,
  nouns: readonly string[] = SENTENCE_CASE_PROPER_NOUNS,
): string {
  return walk(text, nouns, (word, first) => {
    if (first) return word.charAt(0).toUpperCase() + word.slice(1);
    return isTitleCaseWord(word) ? word.charAt(0).toLowerCase() + word.slice(1) : word;
  }).rebuilt;
}
