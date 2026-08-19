import { describe, expect, it } from 'vitest';
import { codeFromTemplateName } from '../../../src/modules/cms/components/cms-template-layout';
import { isEmptyPageBuilderData } from '../../../src/modules/cms/components/page-builder-data';

describe('cms-template-layout guards', () => {
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
   * `@b2b/contracts`" rather than "add a fold here".
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
