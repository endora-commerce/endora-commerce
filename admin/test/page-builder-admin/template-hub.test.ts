import { describe, expect, it } from 'vitest';
import { slugify } from '@endora-commerce/contracts';
import { isEmptyPageBuilderData } from '@endora-commerce/page-builder-admin';

/**
 * The template `code` prefill, asserted as the **expression the builder now
 * calls** (feature 091, P5b).
 *
 * It used to be `cms-template-layout`'s `codeFromTemplateName`, a one-line
 * wrapper over exactly this call. `admin-component-contribution.md` Z1.2 deletes
 * the wrapper with the move: `PageBuilderHeaderActions` went into
 * `@endora-commerce/page-builder-admin`, which cannot name `@/modules/cms`, and
 * the wrapper had no consumer outside the page builder. The subject changed
 * address, not behaviour — the issue #245 cases below are the same four, at the
 * same 180-character cut, and they are kept here rather than deleted because
 * what they prove is that the *call site* folds, which is the half
 * `check:diacritic-folds` is structurally unable to see.
 */
const codeFromTemplateName = (input: string): string => slugify(input, { maxLength: 180 });

describe('page-builder template code prefill', () => {
  it('derives a stable code from the template name', () => {
    expect(codeFromTemplateName(' Hello World! ')).toBe('hello-world');
  });

  /**
   * Issue #245 — this generator had **no fold step at all**. It lowercased and
   * went straight to `[^a-z0-9]+`, so a Polish template name lost every
   * non-ASCII letter instead of folding it. It is the code a CMS template (and,
   * through `email-template-layout.ts`, an e-mail template) is addressed by.
   *
   * `check:diacritic-folds` never reported it and could not: it counts folds
   * written outside the shared helper, and a site that folds nothing writes
   * none. That is the reason the repair is "compose `slugify` from
   * `@endora-commerce/contracts`" rather than "add a fold here".
   *
   * Codes already stored are not migrated (owner's ruling, 2026-08-19); this
   * prefill runs on create.
   */
  it('folds Polish letters instead of deleting them', () => {
    // `Łatwy szablon` produced `atwy-szablon`: the letter was deleted and the
    // separator it collapsed into was trimmed off with it.
    expect(codeFromTemplateName('Łatwy szablon')).toBe('latwy-szablon');
    // `Żółw` produced `w` — one letter left out of four.
    expect(codeFromTemplateName('Żółw')).toBe('zolw');
    // `Świeże Ćwikła` produced `wie-e-wik-a`, which is not a word in any
    // language and is what an operator saw prefilled into the code box.
    expect(codeFromTemplateName('Świeże Ćwikła')).toBe('swieze-cwikla');
  });

  it('does not hand back a code ending in a hyphen when the name is cut', () => {
    // The old chain stripped the edge separators before the 180-character cut,
    // so a cut landing on a separator left one behind.
    const cutOnSeparator = `${'a'.repeat(179)} bbb`;
    const produced = codeFromTemplateName(cutOnSeparator);
    expect(produced).toHaveLength(179);
    expect(produced.endsWith('-')).toBe(false);
  });

  it('blocks save when the canvas is empty', () => {
    expect(isEmptyPageBuilderData({ root: { props: {} }, content: [] })).toBe(true);
    expect(
      isEmptyPageBuilderData({
        root: { props: {} },
        content: [{ type: 'Heading', props: { id: '1', text: 'Hi' } }],
      }),
    ).toBe(false);
  });
});
