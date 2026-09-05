import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOnly } from '../../../scripts/lib/source-text.js';

/**
 * The one comment stripper, and the shapes a hand-rolled one gets wrong.
 *
 * Issue #241. "Remove the comments before matching" was written three times in
 * this tree, independently, and each copy was a pair of regexes whose **order**
 * decided whether it was correct. One of them was wrong:
 * `harness-parity.test.ts` ran the block pass first, so a `//` line ending in a
 * route glob opened a block comment that ran to the next real terminator —
 * 1135 of 2767 lines of the harness — and every
 * `expect(harnessCode).not.toContain(…)` inside that window was green because
 * the text was gone.
 *
 * ## Every fixture below is red against at least one hand-rolled order
 *
 * That property is the point of the file and it is not free: the first draft of
 * these cases passed under **both** orders, because a lone fake opener with no
 * later terminator removes nothing (issue #130 — a fixture that enters below
 * the defect cannot catch it). Each case therefore carries the second half of
 * the real shape — the later block comment the runaway match ends on. Which
 * order each case falsifies is stated on the case.
 */

const HARNESS = fileURLToPath(new URL('../../helpers/test-server.ts', import.meta.url));

/** The two hand-rolled strippers this helper replaces, kept as the red proof. */
const blockFirst = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const lineFirst = (source: string): string =>
  source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('codeOnly', () => {
  it('does not let a route glob inside a line comment open a block comment', () => {
    // The exact defect: `test-server.ts:1544` and `composition.ts:1052` both
    // end a `//` line on a slash-star, and both files carry later doc blocks
    // for the runaway match to end on.
    const source = [
      '// Routes mount under /api/v1/admin/assets/*',
      'runBootHooks();',
      '/** A later doc block. */',
      '',
    ].join('\n');
    expect(blockFirst(source)).not.toContain('runBootHooks();');
    expect(codeOnly(source)).toContain('runBootHooks();');
  });

  it('does not let a block-comment token inside a string literal open a comment', () => {
    // `assets_library`'s wildcard-MIME test writes this literal.
    const source = [
      "const wildcard = '/*';",
      'runBootHooks();',
      '/** A later doc block. */',
      '',
    ].join('\n');
    expect(blockFirst(source)).not.toContain('runBootHooks();');
    expect(lineFirst(source)).not.toContain('runBootHooks();');
    expect(codeOnly(source)).toContain('runBootHooks();');
  });

  it('does not let a closing token inside a string literal terminate a comment', () => {
    // `pim_ergonode`'s Accept header. Nothing runs away here — the literal is
    // simply eaten from the middle, so a consumer matching on it sees a string
    // the source does not contain.
    const source = ["const accept = 'image/*, */*;q=0.5';", ''].join('\n');
    expect(blockFirst(source)).not.toContain("'image/*, */*;q=0.5'");
    expect(lineFirst(source)).not.toContain("'image/*, */*;q=0.5'");
    expect(codeOnly(source)).toContain("'image/*, */*;q=0.5'");
  });

  it('does not let a line-comment token inside a block comment truncate it', () => {
    // The symmetric hole, and the reason "just swap the order" is not the fix:
    // line-first deletes the line carrying the block's own terminator, so the
    // opener runs on to the next one.
    const source = [
      '/*',
      '// a note */',
      'runBootHooks();',
      '/** A later doc block. */',
      '',
    ].join('\n');
    expect(lineFirst(source)).not.toContain('runBootHooks();');
    expect(codeOnly(source)).toContain('runBootHooks();');
  });

  it('removes a trailing line comment, not only a whole-line one', () => {
    // The anchored `^\s*//` spelling leaves these standing, so a mention of a
    // call on a code line reads as a call.
    const source = ['start(); // then loadModulePresence() runs', ''].join('\n');
    expect(blockFirst(source)).toContain('loadModulePresence()');
    expect(lineFirst(source)).toContain('loadModulePresence()');
    const code = codeOnly(source);
    expect(code).toContain('start();');
    expect(code).not.toContain('loadModulePresence()');
  });

  it('preserves line numbers, so a finding still points at a line a reader can open', () => {
    const source = ['/**', ' * doc', ' */', 'start();', ''].join('\n');
    expect(blockFirst(source).split('\n')).not.toHaveLength(source.split('\n').length);
    const code = codeOnly(source);
    expect(code.split('\n')).toHaveLength(source.split('\n').length);
    expect(code.split('\n')[3]).toBe('start();');
  });

  it('does not treat a protocol separator in a string as a comment', () => {
    const source = ["const url = 'https://example.test/x';", ''].join('\n');
    expect(codeOnly(source)).toContain("'https://example.test/x'");
  });

  it('removes a doc block and a line comment alike', () => {
    const source = ['/** loadModulePresence() */', '// composeModules()', 'start();', ''].join('\n');
    const code = codeOnly(source);
    expect(code).not.toContain('loadModulePresence()');
    expect(code).not.toContain('composeModules()');
    expect(code).toContain('start();');
  });

  it('reads the real harness without eating it', () => {
    // The regression the issue was opened on, measured on the artefact itself:
    // three probes a block-first stripper makes invisible.
    //
    // `runBootHooks(` was one of them and has left this file: feature 109's
    // Phase 1c moved the boot phase into `@endora-commerce/test-kit`, and
    // `harness-parity.test.ts` asserts it against the composition rather than
    // against this root. `beforeBoot:` replaces it — the hook the harness now
    // runs its manifest reconcile in, code rather than comment, inside the same
    // runaway match — because what this case needs is a token that is really
    // there and really eaten. A probe that has left the file makes the case red
    // for a reason that is not the stripper's, which is what it just was.
    const source = readFileSync(HARNESS, 'utf8');
    const code = codeOnly(source);
    const eaten = blockFirst(source);
    expect(code.split('\n')).toHaveLength(source.split('\n').length);
    for (const probe of ['beforeBoot:', 'errorEnvelope', 'resolvePreferredLanguage']) {
      expect(eaten, `${probe} was visible to the block-first stripper after all`).not.toContain(
        probe,
      );
      expect(code, `${probe} is invisible to the stripper`).toContain(probe);
    }
  });

  it('reads a .tsx source', () => {
    const source = ['const el = <div a={1} />; // gone', ''].join('\n');
    const code = codeOnly(source, 'x.tsx');
    expect(code).toContain('<div a={1} />');
    expect(code).not.toContain('gone');
  });
});
