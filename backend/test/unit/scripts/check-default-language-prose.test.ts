/**
 * `check:default-language-prose` — the detail of every shape it refuses and
 * every shape it must not
 * (`specs/094-translation-boundary/contracts/default-language-prose-check.md`).
 *
 * `check-inventory.test.ts` carries one proof per shape; this file is where the
 * shape's behaviour is asserted, including the two things a count cannot say:
 * **which** literal was reported, and that the exemptions hold for the reason
 * they claim rather than by accident.
 *
 * The exemptions are the whole risk. 50 correct sites are one predicate mistake
 * away from being ledger entries — 14 per-language seed maps, 18 `invoices`
 * pdfmake labels, a SOAP envelope, an OAuth form body, an LLM prompt — and a
 * ledger that is mostly exceptions is the shape `check:diacritic-folds`'
 * `slug-run` design already refuses.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  analyzeSource,
  blankProperNouns,
  detectLanguage,
  hasPolishStopword,
  isProse,
  ledgerKey,
  literalDigest,
  POLISH_DIACRITICS,
  POLISH_PROPER_NOUNS,
  POLISH_STOPWORDS,
  primarySubtag,
  proseTokens,
} from '../../../scripts/check-default-language-prose.js';
import {
  FIXTURE_FILE,
  keyFor,
  proseFindings,
  proseSites,
  runDefaultLanguageProse,
  shard,
} from '../../helpers/default-language-prose-fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('the three findings', () => {
  it('reports a Polish sentence returned from a route handler (shape A)', () => {
    const found = proseSites(`
      export function describeStatus(status: string): string {
        if (status === 'pending') {
          return 'Twoja Organizacja oczekuje na weryfikację.';
        }
        return 'Orders are unavailable.';
      }
    `);
    expect(found.map((site) => site.kind)).toEqual(['non-english-default']);
    expect(found[0]?.text).toBe('Twoja Organizacja oczekuje na weryfikację.');
    expect(found[0]?.language).toBe('pl');
    expect(found[0]?.placement).toBe('outside');
  });

  it('reports a push into a persisted log and a persisted field assignment alike', () => {
    // The mechanism is incidental: neither of these is a delivery call, which is
    // exactly why `check:untranslated-delivery` sees neither (D-8).
    const found = proseSites(`
      export function run(logs: string[]) {
        logs.push('Rozpoczęto przetwarzanie operacji.');
        line.name = 'Dopłata za metodę płatności';
      }
    `);
    expect(found.map((site) => site.text)).toEqual([
      'Rozpoczęto przetwarzanie operacji.',
      'Dopłata za metodę płatności',
    ]);
  });

  it('reports a Polish default behind an operator-editable prop apart from the rest', () => {
    const found = proseSites(`
      export function saleDate(props: Props) {
        return { text: str(props, 'labelSaleDate', 'Data sprzedaży') };
      }
    `);
    expect(found.map((site) => site.kind)).toEqual(['polish-default-behind-a-prop']);
    expect(found[0]?.text).toBe('Data sprzedaży');
  });

  it('reports the `??` spelling of a prop default too', () => {
    expect(
      proseFindings(
        `export const label = props['labelSaleDate'] ?? 'Data sprzedaży';`,
        'polish-default-behind-a-prop',
      ),
    ).toBe(1);
  });

  it('takes a one-word default in the prop position, where the position is the evidence', () => {
    // `'Zapłacono'` is one word, so the prose gate would drop it anywhere else.
    // In the default slot of a label accessor the position says it is a label.
    expect(
      proseFindings(
        `export const paid = str(props, 'labelPaid', 'Zapłacono');`,
        'polish-default-behind-a-prop',
      ),
    ).toBe(1);
  });

  it('reports a computed key as unclassifiable rather than skipping it (issue #113)', () => {
    const found = proseSites(`
      export const MESSAGES = {
        [language]: 'Przesyłka wysłana do klienta',
      };
    `);
    expect(found.map((site) => site.kind)).toEqual(['unclassifiable-literal']);
    expect(found[0]?.placement).toBe('unclassifiable');
  });
});

describe('the exemptions — where the check earns its keep', () => {
  it('leaves a `pl-PL` keyed structure alone, however deep the literal sits', () => {
    const found = proseSites(`
      export const EMAIL_DEFAULT = {
        defaultContent: {
          languages: {
            'en-US': tree({ heading: 'Verify your email', text: ['Welcome.'].join('') }),
            'pl-PL': tree({ heading: 'Zweryfikuj swój e-mail', text: ['Witamy tutaj.'].join('') }),
          },
        },
      };
      export const stray = 'Rejestracja Twojej Organizacji została odrzucona.';
    `);
    expect(found.map((site) => site.text)).toEqual([
      'Rejestracja Twojej Organizacji została odrzucona.',
    ]);
  });

  it('leaves an `{ en, pl }` sibling map alone', () => {
    const found = proseSites(`
      export const STATUSES = [
        { code: 'shipment_sent', name: { en: 'Shipment Sent', pl: 'Przesyłka wysłana' } },
      ];
      export const stray = 'Zamówienie zostało anulowane przez operatora.';
    `);
    expect(found.map((site) => site.text)).toEqual([
      'Zamówienie zostało anulowane przez operatora.',
    ]);
  });

  it('leaves a row that declares the language it is written in alone', () => {
    const found = proseSites(`
      export const POLISH_TRANSLATION_SEED = [
        { entryType: 'currency', entryCode: 'PLN', languageCode: 'pl-PL', label: 'Polski złoty' },
      ];
      export const stray = 'Faktura nie została jeszcze opłacona.';
    `);
    expect(found.map((site) => site.text)).toEqual(['Faktura nie została jeszcze opłacona.']);
  });

  it('does not read a row whose own subject is a language code as declaring one', () => {
    // `entryCode: 'pl-PL'` is what the row is *about*; `languageCode` is what it
    // is *written in*. A rule reading "any sibling holding a language code"
    // would exempt this, which is the false exemption the field names prevent.
    expect(
      proseSites(`
        export const ROWS = [
          { entryType: 'language', entryCode: 'pl-PL', label: 'Polska wersja językowa' },
        ];
      `).map((site) => site.text),
    ).toEqual(['Polska wersja językowa']);
  });

  it('leaves a file whose declared export names a language code alone', () => {
    expect(
      proseSites(`
        export const PL_MESSAGES = ['Zamówienie zostało anulowane.', 'Faktura wystawiona.'];
      `),
    ).toEqual([]);
  });

  it('is a structure rule and not a filename rule', () => {
    // The same source, in a file named after a language, is still judged: the
    // exemption is a property of the syntax (`check:diacritic-folds`' discipline).
    const found = runDefaultLanguageProse({
      'packages/modules/blog/src/backend/seed/translations.pl-PL.ts':
        "export const rows = [{ label: 'Zamówienie zostało anulowane.' }];",
    }).findings;
    expect(found.map((site) => site.text)).toEqual(['Zamówienie zostało anulowane.']);
  });
});

describe('the detector, and the bound it declares', () => {
  it('says nothing about English prose, however prose-like', () => {
    expect(
      proseSites(`
        export const message =
          'We have reviewed your return request and are unable to accept it.';
      `),
    ).toEqual([]);
  });

  it('reads a Polish diacritic as Polish', () => {
    expect(detectLanguage('Faktura korygująca', ['en', 'pl'])).toBe('pl');
  });

  it('reads a Polish function word as Polish where no diacritic survives', () => {
    // The stopword list is why § 1.3 says the two signals sit beside each other.
    // It contributes nothing on the tree today, so this is the only thing
    // standing between it and becoming dead code without anybody noticing.
    expect(detectLanguage('Zamowienie nie zostalo oplacone', ['en', 'pl'])).toBe('pl');
    expect(hasPolishStopword('Zamowienie nie zostalo oplacone')).toBe(true);
  });

  it('is silent for the language it has no detector for', () => {
    // Every shipped language other than English needs its own; the CLI refuses a
    // set in which none has one, so this is the analysis half of § 4.5.
    expect(detectLanguage('Faktura korygująca', ['en', 'de'])).toBeNull();
  });

  it('blanks the shared proper nouns before deciding', () => {
    expect(blankProperNouns('Source: Ministerstwo Finansów').trim()).toBe('Source:');
    expect(proseSites("export const source = 'Data from Ministerstwo Finansów';")).toEqual([]);
  });

  it('reuses `scripts/check-language.sh`’s diacritic class and proper-noun list', () => {
    // Two derivations of one answer are two answers waiting to disagree, and the
    // shell script is the older of the two — so it is the author, and this is
    // the ratchet in both directions.
    const shell = readFileSync(`${REPO_ROOT}scripts/check-language.sh`, 'utf8');
    const pattern = /^pattern='\[([^']+)\]'$/m.exec(shell);
    expect(pattern, 'no `pattern=` line in check-language.sh').not.toBeNull();
    expect(POLISH_DIACRITICS).toBe(pattern?.[1]);

    const block = /^proper_nouns=\(\n([\s\S]*?)^\)$/m.exec(shell);
    expect(block, 'no `proper_nouns=(` block in check-language.sh').not.toBeNull();
    const declared = [...(block?.[1] ?? '').matchAll(/^\s*'([^']+)'/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect([...POLISH_PROPER_NOUNS].sort()).toEqual([...declared].sort());
  });

  it('keeps every stopword at two letters or more, and none of them an English word', () => {
    // Measured rather than assumed: `we` reported five English sentences and
    // one-letter `w` reported a `select w.id` join alias and seven
    // `http://www.w3.org/` URIs. Both are out, and this is what keeps them out.
    for (const word of POLISH_STOPWORDS) expect(word.length).toBeGreaterThan(1);
    for (const word of ['we', 'w', 'z', 'to', 'do', 'on', 'ten', 'pod', 'ale', 'no']) {
      expect(POLISH_STOPWORDS).not.toContain(word);
    }
  });
});

describe('the prose gate', () => {
  it('does not read a one-word literal as prose outside the prop-default position', () => {
    expect(isProse('pięć')).toBe(false);
    expect(isProse('Zapłacono')).toBe(false);
    expect(isProse('Zapłacono', true)).toBe(true);
    expect(
      proseSites(`
        const PL_ONES = ['pięć', 'sześć', 'dziewięćdziesiąt'];
        export const use = PL_ONES;
      `),
    ).toEqual([]);
  });

  it('counts words and not characters', () => {
    expect(proseTokens('Zakończono: 4 z powodzeniem')).toEqual([
      'Zakończono',
      'powodzeniem',
    ]);
  });

  it('collapses an interpolation to a token break rather than joining its neighbours', () => {
    const found = proseSites('export const m = `Operacja nie powiodła się: ${message}`;');
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toBe('Operacja nie powiodła się: \u2026');
    // The point of the placeholder: `${x}` between two words leaves two words.
    expect(proseTokens('Kwota\u2026netto')).toEqual(['Kwota', 'netto']);
  });
});

describe('positions that are not prose at all', () => {
  it('ignores a module specifier, a property key and a literal type', () => {
    expect(
      proseSites(`
        import { x } from './uslugi/płatności.js';
        export type Kind = 'faktura korygująca';
        export const map = { 'Faktura korygująca': 1 };
      `),
    ).toEqual([]);
  });
});

describe('the ledger', () => {
  const source = "export const m = 'Zamówienie zostało anulowane przez operatora.';";
  const text = 'Zamówienie zostało anulowane przez operatora.';

  it('keys on a digest of the literal, never on a line', () => {
    expect(ledgerKey({ file: FIXTURE_FILE, text })).toBe(
      `${FIXTURE_FILE}:${literalDigest(text)}`,
    );
    // An insertion above the site does not move the key.
    const moved = runDefaultLanguageProse({ [FIXTURE_FILE]: `\n\n\n${source}` }).findings;
    expect(ledgerKey(moved[0]!)).toBe(keyFor(text));
  });

  it('an edited sentence is a new key, so the reason cannot outlive the site', () => {
    expect(literalDigest(text)).not.toBe(literalDigest(`${text} `));
  });

  it('answers for a recorded site and refuses an unrecorded one', () => {
    const recorded = runDefaultLanguageProse({ [FIXTURE_FILE]: source }, [
      shard('blog', { [keyFor(text)]: 'recorded' }),
    ]);
    expect(recorded.violations).toEqual([]);
    expect(recorded.ledgered).toHaveLength(1);

    const unrecorded = runDefaultLanguageProse({ [FIXTURE_FILE]: source }, []);
    expect(unrecorded.violations).toHaveLength(1);
  });

  it('fails on an entry that no longer describes a site — the second direction', () => {
    const result = runDefaultLanguageProse({ [FIXTURE_FILE]: "export const m = 'Order placed.';" }, [
      shard('blog', { [keyFor(text)]: 'recorded' }),
    ]);
    expect(result.stale).toEqual([keyFor(text)]);
  });

  it('fails on an entry filed under a module that does not own the file it names', () => {
    const result = runDefaultLanguageProse(
      { [FIXTURE_FILE]: source },
      [shard('catalog', { [keyFor(text)]: 'recorded' })],
      () => 'blog',
    );
    expect(result.misfiled).toEqual([keyFor(text)]);
  });
});

describe('what the walk classified', () => {
  it('counts every literal it offered the classifier, not the ones it reported', () => {
    // `sites` has to move when the walk narrows, so it cannot be the finding
    // count — that number moves with the tree's health instead (issue #244).
    const analysis = analyzeSource(
      FIXTURE_FILE,
      "export const a = 'one'; export const b = 'two'; export const c = 'Faktura korygująca';",
      ['en', 'pl'],
    );
    expect(analysis.classified).toBe(3);
    expect(analysis.sites).toHaveLength(1);
  });
});

describe('locale folding', () => {
  it('reads a locale by its primary subtag', () => {
    expect(primarySubtag('pl-PL')).toBe('pl');
    expect(primarySubtag('EN')).toBe('en');
    expect(primarySubtag('pl')).toBe('pl');
  });
});
