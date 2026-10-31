import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adminScanRoots,
  analyzeSource,
  collectTsxFiles,
  coveredModuleAdminLayers,
  defaultRoots,
  compareToBaseline,
  countByFile,
  HARDCODED_STRINGS_BASELINE,
  collectStorefrontFiles,
  scanDefaultTree,
  storefrontScanRoot,
  STOREFRONT_ANALYSIS,
  STOREFRONT_HARDCODED_STRINGS_BASELINE,
  type Finding,
} from '../../../scripts/i18n-hardcoded-strings.js';

/**
 * The hard-coded-string rule's own test (issue #113, issue #116).
 *
 * The walk was reachable only through `main`, so nothing exercised it, and the
 * default root was `admin/src` resolved against the working directory — which
 * from `backend/` (where the documented `pnpm --filter backend run
 * i18n:hardcoded` runs) matches nothing. The check read zero files, reported
 * "0 finding(s) across 0 file(s)" and exited 0 for as long as it has existed.
 *
 * Fixing that revealed 274 findings across 47 files, which is why the check ran
 * in no CI job even after it could see anything: strict would have failed on
 * history. It runs against a per-file baseline now, and the half of that which
 * rots is the second one — so both directions are driven here, on counts the
 * repository does not contain.
 */

const FILE = '/repo/admin/src/pages/orders/order-list.tsx';

describe('analyzeSource — the shapes it claims to flag', () => {
  it('flags a JSX text node', () => {
    const findings = analyzeSource('export const A = () => <Button>Save changes</Button>;\n', FILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'jsx-text', text: 'Save changes', line: 1 });
  });

  it('flags each user-visible attribute', () => {
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
      const source = `export const A = () => <input ${attr}="Search orders" />;\n`;
      expect(analyzeSource(source, FILE).map((f) => f.kind), attr).toEqual(['jsx-attr']);
    }
  });

  it('ignores an attribute nobody reads out loud', () => {
    expect(analyzeSource('export const A = () => <div className="flex gap-2" />;\n', FILE)).toEqual(
      [],
    );
  });

  it('ignores a translated string — it is an expression, not a text node', () => {
    expect(analyzeSource('export const A = () => <Button>{t("orders.save")}</Button>;\n', FILE)).toEqual(
      [],
    );
  });

  it('ignores a code-shaped token and a technical identifier in <code>', () => {
    expect(analyzeSource('export const A = () => <span>order_id</span>;\n', FILE)).toEqual([]);
    expect(analyzeSource('export const A = () => <code>ctx.subscribe</code>;\n', FILE)).toEqual([]);
  });

  it('reports the line and column, so a finding points at the string', () => {
    const source = ['export const A = () => (', '  <p>Nothing here yet</p>', ');', ''].join('\n');
    expect(analyzeSource(source, FILE)[0]).toMatchObject({ line: 2, column: 6 });
  });
});

describe('analyzeSource — the storefront\'s Polish literals (issue #85)', () => {
  const SF = '/repo/storefront/components/rfq/RfqDetailActions.tsx';
  const SF_TS = '/repo/storefront/lib/quote-requests/describe-diff.ts';
  const polish = { polishLiterals: true } as const;

  it('flags a Polish string literal outside JSX — the shape the JSX rule cannot see', () => {
    const findings = analyzeSource("export const labels = { reject: 'Odrzuć' };\n", SF_TS, polish);
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'polish-literal', text: 'Odrzuć', line: 1 }),
    ]);
  });

  it('flags a template whose static text is Polish once, not once per part', () => {
    const source = 'export const f = (a: number, b: number) => `${a}: ilość ${b} → ${a}`;\n';
    expect(analyzeSource(source, SF_TS, polish).map((f) => f.kind)).toEqual(['polish-literal']);
  });

  it('flags a Polish value of an attribute nobody reads out loud', () => {
    const source = 'export const A = () => <Field label="Ilość" />;\n';
    expect(analyzeSource(source, SF, polish).map((f) => f.kind)).toEqual(['polish-literal']);
  });

  it('counts a Polish user-visible attribute once, as the attribute', () => {
    const source = 'export const A = () => <input placeholder="Powód odrzucenia" />;\n';
    expect(analyzeSource(source, SF, polish).map((f) => f.kind)).toEqual(['jsx-attr']);
  });

  it('ignores the Polish half of a per-language structure — that is the catalogue', () => {
    const source = [
      'export const MESSAGES = {',
      "  'en-US': { 'rfq.reject': 'Reject' },",
      "  'pl-PL': { 'rfq.reject': 'Odrzuć' },",
      '};',
      "export const short = { en: 'Reject', pl: 'Odrzuć' };",
      '',
    ].join('\n');
    expect(analyzeSource(source, SF_TS, polish)).toEqual([]);
  });

  it('does not exempt a lone property that merely has a short name', () => {
    expect(
      analyzeSource("export const x = { id: 'Zamówienie' };\n", SF_TS, polish).map((f) => f.kind),
    ).toEqual(['polish-literal']);
  });

  it('ignores an English literal and a Polish comment — neither is this rule\'s subject', () => {
    const source = "// Odrzuć — cited in a comment\nexport const label = 'Reject';\n";
    expect(analyzeSource(source, SF_TS, polish)).toEqual([]);
  });

  it('parses a .ts file as TypeScript, so a generic arrow is not misread as JSX', () => {
    const source = "export const id = <T,>(x: T): T => x;\nexport const m = 'Usunięto';\n";
    expect(analyzeSource(source, SF_TS, polish).map((f) => f.kind)).toEqual(['polish-literal']);
  });

  it('is off unless asked for, so the admin roots keep the two shapes they had', () => {
    expect(analyzeSource("export const x = 'Odrzuć';\n", FILE)).toEqual([]);
  });
});

/**
 * The storefront's strict shapes (issue #85). Every shape has a red fixture and
 * every exemption a green one, so a predicate that reports everything — or
 * nothing — fails here rather than in the ledger.
 */
describe('analyzeSource — the storefront\'s strict shapes (issue #85)', () => {
  const SF = '/repo/storefront/components/Cart.tsx';
  const SF_TS = '/repo/storefront/lib/cart/labels.ts';
  const kinds = (source: string, file = SF): string[] =>
    analyzeSource(source, file, STOREFRONT_ANALYSIS).map((f) => f.kind);
  const texts = (source: string, file = SF): string[] =>
    analyzeSource(source, file, STOREFRONT_ANALYSIS).map((f) => f.text);
  const jsx = (body: string): string => `export const A = () => (${body});\n`;

  describe('jsx-text — any letter, single words included', () => {
    it('reports a single word in English and in Polish with no diacritic', () => {
      expect(kinds(jsx('<nav><a>Cart</a><a>Koszyk</a><button>Wyloguj</button></nav>'))).toEqual([
        'jsx-text',
        'jsx-text',
        'jsx-text',
      ]);
    });

    it('reports a lower-case word and a code-shaped one — the admin rule skipped both', () => {
      expect(texts(jsx('<p><span>delivery</span><span>order_id</span></p>'))).toEqual([
        'delivery',
        'order_id',
      ]);
    });

    it('ignores symbols, digits and entities, which carry no letter', () => {
      expect(
        kinds(jsx('<p><span>·</span><span>→</span><span>× 12</span><span>&nbsp;&copy;</span></p>')),
      ).toEqual([]);
    });

    it('ignores technical and non-rendered elements, and SVG glyphs', () => {
      expect(
        kinds(
          jsx(
            '<div><code>ctx.subscribe</code><kbd>Ctrl</kbd><samp>Error</samp>' +
              '<svg><text><tspan>G</tspan></text></svg></div>',
          ),
        ),
      ).toEqual([]);
    });

    it('is off for the admin, whose ledger was measured without it', () => {
      expect(analyzeSource(jsx('<span>Koszyk</span>'), FILE)).toEqual([]);
      expect(analyzeSource(jsx('<span>Koszyk</span>'), FILE, { polishLiterals: true })).toEqual([]);
    });
  });

  describe('jsx-attr — a wider set, read through {…}', () => {
    it('reports every visible attribute the admin rule did not know', () => {
      for (const attr of [
        'label',
        'aria-description',
        'aria-roledescription',
        'aria-valuetext',
        'aria-placeholder',
        'removeLabel',
        'emptyAriaLabel',
        'cardHeading',
      ]) {
        expect(kinds(jsx(`<Field ${attr}="Quantity" />`)), attr).toEqual(['jsx-attr']);
      }
    });

    it('reads through an expression container, a template, a conditional, &&, ||, ?? and +', () => {
      expect(kinds(jsx("<input placeholder={'Search'} />"))).toEqual(['jsx-attr']);
      expect(kinds(jsx('<button aria-label={`Remove ${name}`} />'))).toEqual(['jsx-attr']);
      expect(kinds(jsx("<button title={open ? 'Close' : 'Open'} />"))).toEqual([
        'jsx-attr',
        'jsx-attr',
      ]);
      expect(kinds(jsx("<button title={(open && 'Close')} />"))).toEqual(['jsx-attr']);
      expect(kinds(jsx("<button title={label || 'Close'} />"))).toEqual(['jsx-attr']);
      expect(kinds(jsx("<button title={label ?? 'Close'} />"))).toEqual(['jsx-attr']);
      expect(kinds(jsx("<button title={'Remove ' + name} />"))).toEqual(['jsx-attr']);
    });

    it('does not read through a call, a condition or an attribute nobody reads', () => {
      expect(
        kinds(jsx("<button title={t('cart.close')} aria-label={format(x, 'pl-PL')} />")),
      ).toEqual([]);
      expect(kinds(jsx("<button title={mode === 'Compact' ? a : b} />"))).toEqual([]);
      expect(kinds(jsx('<div className="Flex Gap" data-state="open" role="dialog" />'))).toEqual(
        [],
      );
    });

    it('ignores a catalogue key, a URL and an SVG path', () => {
      expect(kinds(jsx('<img alt="product.image" title="https://example.com/a" />'))).toEqual([]);
      expect(kinds(jsx('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />'))).toEqual([]);
    });
  });

  describe('jsx-expression — a literal rendered as a JSX child', () => {
    it('reports both branches of a conditional, a bare literal and &&', () => {
      expect(texts(jsx("<p>{ok ? 'Saved' : 'Failed'}{'Cart'}{busy && 'Saving…'}</p>"))).toEqual([
        'Saved',
        'Failed',
        'Cart',
        'Saving…',
      ]);
      expect(kinds(jsx("<p>{ok ? 'Saved' : 'Failed'}</p>"))).toEqual([
        'jsx-expression',
        'jsx-expression',
      ]);
    });

    it('reports the literals inside a template child', () => {
      expect(texts(jsx("<p>{`${n} ${n === 1 ? 'item' : 'items'}`}</p>"))).toEqual([
        'item',
        'items',
      ]);
    });

    it('does not report a call argument, punctuation or text inside <code>', () => {
      expect(
        kinds(
          jsx(
            "<p>{t('cart.title')}{format(price, 'pl-PL')}{' · '}<code>{'ctx.subscribe'}</code></p>",
          ),
        ),
      ).toEqual([]);
    });
  });

  describe('copy-property — a property named for rendered copy', () => {
    it('reports Next metadata and a label table', () => {
      expect(
        kinds("export const metadata = { title: 'Cart', description: 'Your cart' };\n", SF_TS),
      ).toEqual(['copy-property', 'copy-property']);
      expect(
        kinds(
          "export const labels = { qtyLabel: 'Quantity', notePlaceholder: 'Notes', " +
            "convertToQrHint: 'Send to sales', lockedPricingNote: 'Sales sets prices' };\n",
          SF_TS,
        ),
      ).toEqual(['copy-property', 'copy-property', 'copy-property', 'copy-property']);
    });

    it('reports the other word-shaped values of a table one value of which was reported', () => {
      const source =
        "export const l = { heading: 'Your cart', install: 'Install', reason: 'out of stock', " +
        "slug: 'fasteners', icon: 'truck', href: '/cart' };\n";
      expect(texts(source, SF_TS)).toEqual(['Your cart', 'Install', 'out of stock']);
    });

    it('does not report a colour token, a catalogue key, a per-language value or an unnamed table', () => {
      expect(
        kinds(
          "export const a = { text: '#7c4a03', label: 'nav.cart', title: { en: 'Cart', pl: 'Koszyk' } };\n" +
            "export const b = { install: 'Install', close: 'Close', method: 'POST' };\n",
          SF_TS,
        ),
      ).toEqual([]);
    });
  });

  describe('prose-literal — a prose-shaped literal anywhere else', () => {
    it('reports a capitalised phrase, a sentence and a template sentence', () => {
      const source = [
        "export const a = 'Continue shopping';",
        "export const b = 'Saved.';",
        "export const c = 'the cart is empty.';",
        'export const d = (n: number) => `Showing ${n} of ${n}`;',
        "export const e = (set: (m: string) => void) => set('Could not save address.');",
        '',
      ].join('\n');
      expect(kinds(source, SF_TS)).toEqual([
        'prose-literal',
        'prose-literal',
        'prose-literal',
        'prose-literal',
        'prose-literal',
      ]);
    });

    it('reports Polish with no diacritic as prose, and Polish with one as polish-literal', () => {
      expect(
        kinds("export const a = 'Kontynuuj zakupy';\nexport const b = 'Usuń wszystko';\n", SF_TS),
      ).toEqual(['prose-literal', 'polish-literal']);
    });

    it('ignores a single word, a lower-case phrase and a capitalised identifier', () => {
      expect(
        kinds(
          "export const a = ['Escape', 'ItemList', 'no-store', 'items', 'flex items-center'];\n",
          SF_TS,
        ),
      ).toEqual([]);
    });

    // Each row carries a probe that is reported on its own: the exempted literal
    // itself where the exemption is its context, or the same words without the
    // trait where the exemption is the value's shape (a URL, a MIME type, an
    // SVG path). So a row cannot pass because its fixture was never reportable.
    it.each([
      ['console', "console.error('Could not load the cart.');", "'Could not load the cart.'"],
      ['an Error', "throw new Error('Something failed badly.');", "'Something failed badly.'"],
      ['an Error subclass', "export const e = new CartError('Bad thing happened.');", "'Bad thing happened.'"],
      ['a thrown literal', "export function f() { throw 'Bad thing happened.'; }", "'Bad thing happened.'"],
      ['a comparison', "export const f = (x: string) => x === 'Some Value' || x !== 'Other Value';", "'Some Value'"],
      ['a case label', "export const f = (x: string) => { switch (x) { case 'Some Value': return 1; } };", "'Some Value'"],
      ['an in-check', "export const f = (o: object) => 'Some Key' in o;", "'Some Key'"],
      ['an object key', "export const o = { 'Content Type Header': 1 };", "'Content Type Header'"],
      ['an element access', "export const f = (o: Record<string, number>) => o['Some Key'];", "'Some Key'"],
      ['an enum member', "export enum Kind { A = 'Some Value' }", "'Some Value'"],
      ['a catalogue call', "export const a = t('Some Key.') + tForLocale(l)('Other Key.');", "'Some Key.'"],
      ['a class-name call', "export const c = cn('Foo Bar', clsx('Baz Qux'));", "'Foo Bar'"],
      ['a className attribute', 'export const A = () => <div className="Foo Bar" />;', "'Foo Bar'"],
      ['a style object', "export const A = () => <div style={{ gridArea: 'Main Content' }} />;", "'Main Content'"],
      ['a font family', "export const theme = { fontFamily: 'Inter, Helvetica Neue' };", "'Inter, Helvetica Neue'"],
      ['an HTTP header', "headers.set('Vary', 'Accept-Language, Cookie');", "'Accept-Language, Cookie'"],
      ['an HTTP status body', "export const r = new NextResponse('Not Found', { status: 404 });", "'Not Found'"],
      ['a tagged diagnostic', "report('[page-builder] A block was ignored.');", "'A block was ignored.'"],
      ['a URL', "export const u = 'https://example.com/Some Page.';", "'example.com Some Page.'"],
      ['a MIME type', "export const m = { description: 'text/html; charset=utf-8' };", "'html charset utf'"],
      ['an SVG path', "export const d = 'M21 18H8 M3 6l4-4';", "'Mark 18H8 M3 6l4-4'"],
      ['a type', "export type Mode = 'Some Value' | 'Other Value';", "'Some Value'"],
      ['an import', "import x from 'Some Module.';", "'Some Module.'"],
    ])('ignores %s', (_label, source, literal) => {
      expect(kinds(`${source}\n`, SF)).toEqual([]);
      const probe = /^'[A-Z]|\.'$/.test(literal) ? 'prose-literal' : 'copy-property';
      const neutral =
        probe === 'prose-literal'
          ? `export const probe = ${literal};\n`
          : `export const probe = { description: ${literal} };\n`;
      expect(kinds(neutral, SF), `${literal} is not reported on its own`).toEqual([probe]);
    });
  });

  it('reports each literal once, under the first kind that claims it', () => {
    // A Polish placeholder is `jsx-attr`, not also `polish-literal`; a Polish
    // copy property is `copy-property`.
    expect(
      kinds(
        jsx('<input placeholder="Powód odrzucenia" />') + "export const m = { title: 'Usuń' };\n",
      ),
    ).toEqual(['jsx-attr', 'copy-property']);
  });
});

describe('the storefront root (issue #85)', () => {
  it('is the workspace member, and its walk opens .ts and .tsx sources but no test', () => {
    const root = storefrontScanRoot();
    expect(root, 'no workspace member is the storefront').not.toBeNull();
    const files: string[] = [];
    collectStorefrontFiles(root!, files);
    expect(files.some((f) => f.endsWith('.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))).toBe(true);
    expect(files.filter((f) => /\.(test|spec)\.tsx?$/.test(f) || f.endsWith('.d.ts'))).toEqual([]);
    expect(files.filter((f) => f.split(/[\\/]/).includes('test'))).toEqual([]);
  });

  it('opens every file STOREFRONT_HARDCODED_STRINGS_BASELINE names', () => {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const { files } = scanDefaultTree();
    const walked = new Set(files.map((f) => relative(repoRoot, f).split('\\').join('/')));
    expect(Object.keys(STOREFRONT_HARDCODED_STRINGS_BASELINE).filter((e) => !walked.has(e))).toEqual(
      [],
    );
  });

  it('keys every storefront entry under the storefront, and no admin entry there', () => {
    const outside = Object.keys(STOREFRONT_HARDCODED_STRINGS_BASELINE).filter(
      (key) => !key.startsWith('storefront/'),
    );
    const inside = Object.keys(HARDCODED_STRINGS_BASELINE).filter((key) =>
      key.startsWith('storefront/'),
    );
    expect({ outside, inside }).toEqual({ outside: [], inside: [] });
  });
});

describe('the default scan roots', () => {
  /**
   * The vacuity guard, **derived** (feature 091 fallout; D-100).
   *
   * It read `collectTsxFiles(admin/src)` and
   * `expect(files.length).toBeGreaterThan(100)`, which is two stale things at
   * once: a literal count of a derived fact, over **one** of the three root
   * families the script walks. Phase 4's drain moved the admin's screens into
   * their owning module packages, `admin/src` fell to 65 `.tsx` files, and this
   * case went red for a tree in which the check reads *more* than it ever has —
   * 422 files across 57 roots. A reader is sent to look for a narrowed walk by
   * the one instrument that was supposed to prove the walk is not narrow.
   *
   * The defect it exists for is the original one and is unchanged: the default
   * root was `admin/src` resolved against the working directory, so from
   * `backend/` it matched nothing and the check reported `0 findings across 0
   * files` and exited 0 for its whole life. That is a statement about **roots**,
   * so it is asked about every root the script declares, with no number in it.
   */
  it('every root the script declares contributes at least one file', () => {
    const roots = adminScanRoots();
    expect(roots.length, 'the script declared no scan root at all').toBeGreaterThan(0);
    const empty: string[] = [];
    for (const root of roots) {
      expect(existsSync(root.dir), `${root.dir} is declared and is not on disk`).toBe(true);
      const files: string[] = [];
      collectTsxFiles(root.dir, files);
      // A module package whose admin layer is a barrel and no screen is the one
      // legitimate zero (`admin_roles` ships `src/admin/index.ts` and nothing
      // else), so an empty *module* root is not a finding; an empty
      // application or admin-ui root is, because those are the two families
      // whose whole content is screens.
      if (files.length === 0 && (root.owner === null || root.adminUi)) empty.push(root.dir);
    }
    expect(empty, 'a screen-bearing root contributed no .tsx file').toEqual([]);
  });

  /**
   * The floor with no number in it: every file the ledger names has to be a file
   * the walk opened.
   *
   * This is what the drain would have gone red on **in the batch that caused
   * it** rather than three merges later, and it says the true thing — *the walk
   * no longer reaches `X`* — where the ratchet below can only say *`X` is
   * drained*, which is the laundering FR-017 exists to refuse. The ledger is the
   * independent author: 47 entries written by other merge requests, at
   * repository-relative keys, describing exactly the population a relocation
   * moves.
   */
  it('opens every file HARDCODED_STRINGS_BASELINE names', () => {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const ledger = Object.keys(HARDCODED_STRINGS_BASELINE);
    expect(ledger.length, 'an empty ledger cannot floor anything').toBeGreaterThan(0);
    const files: string[] = [];
    for (const root of defaultRoots()) collectTsxFiles(root, files);
    const walked = new Set(files.map((f) => relative(repoRoot, f).split('\\').join('/')));
    expect(ledger.filter((entry) => !walked.has(entry))).toEqual([]);
  });
});

describe('the module-admin floor', () => {
  /**
   * The `sources=module-admin` token's coverage half, driven from a fixture that
   * enters at the top of the analysis rather than from a value the walk
   * computed.
   *
   * A layer is covered when the walk **opened its directory as a root**, not
   * when the walk found a `.tsx` under it: one registry-named layer
   * (`admin_roles`) is a barrel and no screen, and a coverage rule keyed on
   * files would refuse a correct tree. What the token can therefore see is a
   * layer that left the walk — which is the whole of the regression it exists
   * for — and what it cannot is a root that was walked and yielded nothing,
   * which the case above covers for the two families where zero is wrong.
   */
  it('counts a layer the walk opened, and not one it did not', () => {
    const walked = ['/repo/packages/modules/orders/src/admin'];
    expect(
      coveredModuleAdminLayers(
        [
          { directory: '/repo/packages/modules/orders/src/admin' },
          { directory: '/repo/packages/modules/catalog/src/admin' },
        ],
        walked,
      ),
    ).toBe(1);
  });

  it('is 0 when the registry names layers and the walk opened none of them', () => {
    expect(
      coveredModuleAdminLayers([{ directory: '/repo/packages/modules/orders/src/admin' }], [
        '/repo/admin/src',
      ]),
    ).toBe(0);
  });
});

describe('countByFile', () => {
  it('groups findings by a path relative to the scan root', () => {
    const findings: Finding[] = [
      { filePath: '/repo/admin/src/pages/a.tsx', line: 1, column: 1, text: 'A', kind: 'jsx-text' },
      { filePath: '/repo/admin/src/pages/a.tsx', line: 2, column: 1, text: 'B', kind: 'jsx-text' },
      { filePath: '/repo/admin/src/b.tsx', line: 1, column: 1, text: 'C', kind: 'jsx-attr' },
    ];
    expect([...countByFile(findings, '/repo/admin/src')]).toEqual([
      ['pages/a.tsx', 2],
      ['b.tsx', 1],
    ]);
  });
});

describe('the baseline ratchet goes red in BOTH directions', () => {
  const baseline = { 'pages/orders.tsx': 3 } as const;

  it('flags a file that gained a hard-coded string', () => {
    const verdict = compareToBaseline(new Map([['pages/orders.tsx', 4]]), baseline);
    expect(verdict.regressions).toEqual([{ file: 'pages/orders.tsx', baseline: 3, actual: 4 }]);
    expect(verdict.drained).toEqual([]);
  });

  it('flags a file the ledger never mentioned', () => {
    const verdict = compareToBaseline(new Map([['pages/new-screen.tsx', 1]]), baseline);
    expect(verdict.regressions).toEqual([{ file: 'pages/new-screen.tsx', baseline: 0, actual: 1 }]);
  });

  it('flags a ledger entry that describes a debt already paid', () => {
    // The half that rots. A number left standing after the strings were
    // translated is a claim the tree stopped backing, which is the whole of
    // what makes an allow-list rather than a ratchet.
    const verdict = compareToBaseline(new Map([['pages/orders.tsx', 1]]), baseline);
    expect(verdict.drained).toEqual([{ file: 'pages/orders.tsx', baseline: 3, actual: 1 }]);
    expect(verdict.regressions).toEqual([]);
  });

  it('flags a ledger entry whose file is clean or gone', () => {
    expect(compareToBaseline(new Map(), baseline).drained).toEqual([
      { file: 'pages/orders.tsx', baseline: 3, actual: 0 },
    ]);
  });

  it('is silent when the tree matches the ledger exactly', () => {
    expect(compareToBaseline(new Map([['pages/orders.tsx', 3]]), baseline)).toEqual({
      regressions: [],
      drained: [],
    });
  });
});

describe('the tree itself (what CI asserts)', () => {
  it('matches HARDCODED_STRINGS_BASELINE exactly — no new string, no stale entry', () => {
    // **The roots come from the script, not from a copy of them here** (feature
    // 091, Phase 4 batch three). This test spelled two — `admin/src` and the
    // kit — which was right when Phase 1b wrote it and stopped being right when
    // Phase 4's first batch added module packages' own `src/admin` layers to
    // `defaultRoots`. Nothing reported the divergence for two batches, because
    // neither moved a file the baseline named, so both walks agreed on the
    // empty set. Batch three moved the first one that is named, and the two
    // populations disagreed about it in opposite directions in the same run:
    // the script counted the finding at its new key, this test — blind to the
    // root it sits under — reported the entry as drained.
    //
    // So the derivation is shared rather than mirrored. A batch that adds a
    // fourth root family now moves both answers at once, which is the only way
    // a ratchet over relocations can stay honest about relocations.
    //
    // Issue #85 added the storefront as a fourth family, and that is why the
    // walk and the analysis are one exported call now rather than a loop
    // repeated here: the storefront reads `.ts` too and asks one more question
    // of it, and a copy of the loop would have kept asking the old two.
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const { findings } = scanDefaultTree();
    const verdict = compareToBaseline(countByFile(findings, repoRoot), {
      ...HARDCODED_STRINGS_BASELINE,
      ...STOREFRONT_HARDCODED_STRINGS_BASELINE,
    });
    expect(verdict.regressions).toEqual([]);
    expect(verdict.drained).toEqual([]);
  });
});
