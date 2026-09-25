/**
 * The front-matter quoting rule, asserted directly rather than emergently.
 *
 * `yamlScalar` guards `title`, `sidebar_label` and `description` on every
 * generated documentation page, and until this file existed it was exercised
 * only through whatever strings the module registry happened to hold — none of
 * which carried a `#`. That is why the `#` branch shipped inverted: it tested
 * for a `#` *followed* by whitespace, while YAML starts a comment at a `#`
 * *preceded* by whitespace or at the start of the value. The first module whose
 * summary read *"…(see issue #123)"* would have published a description
 * truncated at the `#`, with no parse error and no failing build to say so.
 *
 * The cases below are the rule, not samples of it: a comment-triggering `#`, a
 * `#` that triggers nothing, and the colon and indicator cases the helper was
 * originally written for, which must classify exactly as they did before.
 */
import { describe, expect, it } from 'vitest';
import { yamlScalar } from '../src/lib/docs-artefacts.js';

function isQuoted(value: string): boolean {
  return yamlScalar(value) !== value;
}

describe('yamlScalar', () => {
  describe('quotes a value YAML would read as a comment', () => {
    it.each([
      'Sync catalog #1 with PIM',
      'Webhook events for PR #45',
      'supports retries (see issue #123)',
      '#1 priority',
      'trailing hash #',
    ])('%j', (value) => {
      expect(isQuoted(value)).toBe(true);
      expect(yamlScalar(value)).toBe(`"${value}"`);
    });
  });

  describe('leaves a `#` that starts no comment plain', () => {
    it.each(['C#', 'a#b', 'F# and C# interop', 'issue#123'])('%j', (value) => {
      expect(yamlScalar(value)).toBe(value);
    });
  });

  describe('quotes the colon cases it was written for', () => {
    it.each([
      'What the manifest declares: permissions, settings and routes',
      'ratio 1: 2',
      'ends with a colon:',
    ])('%j', (value) => {
      expect(isQuoted(value)).toBe(true);
    });
  });

  it('leaves a colon inside a word plain', () => {
    expect(yamlScalar('endora:module:sync')).toBe('endora:module:sync');
  });

  describe('quotes a value opening on a YAML indicator', () => {
    it.each(['> folded', '| literal', '- item', '& anchor', '* alias', '! tag', '% directive', '@ reserved', '` backtick', "' quote", '" quote', '[ seq', '{ map', ' leading space'])(
      '%j',
      (value) => {
        expect(isQuoted(value)).toBe(true);
      },
    );
  });

  it('quotes a value ending in whitespace', () => {
    expect(isQuoted('trailing space ')).toBe(true);
  });

  describe('leaves an ordinary value plain', () => {
    it.each([
      'Catalog',
      'Products, categories and variants',
      'Order fulfilment (returns included)',
      'A sentence with a full stop.',
    ])('%j', (value) => {
      expect(yamlScalar(value)).toBe(value);
    });
  });

  it('escapes backslashes and double quotes when it does quote', () => {
    expect(yamlScalar('a "quoted" path C:\\tmp and a # comment')).toBe(
      '"a \\"quoted\\" path C:\\\\tmp and a # comment"',
    );
  });
});
