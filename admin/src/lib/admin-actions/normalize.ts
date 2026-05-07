/**
 * Normalize a string for diacritic-insensitive substring matching.
 *
 * 1. Decompose Unicode (NFD) to separate base characters from their
 *    combining marks.
 * 2. Strip the combining marks via `\p{Diacritic}`.
 * 3. Hand-fold a small set of stroked-letter characters that NFD does
 *    not decompose (the U+0141 / U+0142 etc. group of standalone
 *    codepoints), so Polish "łatwy" → "latwy" and Danish "Ørsted" →
 *    "orsted". This is the minimum needed for our admin's Polish UI
 *    and avoids pulling in a full Unicode-folding library.
 * 4. Lowercase.
 *
 * Edge cases worth knowing:
 * - `ß` has no decomposition and is not in the stroked-letter map, so
 *   it stays as `ß` (not folded to `ss`). Search behaves like a
 *   case-insensitive substring match, not full case-folding.
 * - Empty strings normalize to empty strings — callers that want the
 *   "empty query matches everything" semantics check the input length
 *   before calling.
 */
const STROKED_LETTER_MAP: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Ø: 'O',
  ø: 'o',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  Ŧ: 'T',
  ŧ: 't',
  Ł: 'L',
};

export function normalize(input: string): string {
  let folded = input;
  for (const [src, tgt] of Object.entries(STROKED_LETTER_MAP)) {
    if (folded.includes(src)) folded = folded.split(src).join(tgt);
  }
  return folded.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
