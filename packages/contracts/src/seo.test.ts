import { describe, expect, it } from 'vitest';
import {
  CRAWLER_TEXT_MAX_BYTES,
  adminCrawlerFilePreviewQuerySchema,
  adminCrawlerFilePreviewResponseSchema,
  adminCrawlerFilePreviewStateSchema,
  composeCrawlerFile,
  storefrontCrawlerFilesResponseSchema,
  storefrontCrawlerFilesSchema,
  storefrontRobotsPolicyResponseSchema,
  storefrontRobotsPolicySchema,
} from './seo.js';

// This package's tests are typed against no runtime, so the high-resolution
// clock is reached through `globalThis` rather than named.
const now = (): number => (globalThis as unknown as { performance: { now(): number } }).performance.now();

/**
 * Issue #612: the cost is compared across sizes, not against a clock — a
 * wall-clock budget measures the host as much as the code. `run` is timed once
 * on an input of `length` against {@link GROWTH} calls on inputs
 * {@link GROWTH} times shorter, each side the fastest of five timings after a
 * warm-up, every call on an input of its own built outside the timed region.
 * Linear code does the same work on both sides, so the ratio is about 1 however
 * busy the host is; a quadratic path makes it about {@link GROWTH}.
 */
const GROWTH = 16;
/** Four times above linear, four times below what a quadratic path gives. */
const LINEAR_BOUND = 4;
function growthRatio<T>(run: (input: T) => unknown, input: (length: number) => T, length: number): number {
  const fastest = (inputs: () => T[]): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample <= 5; sample += 1) {
      const batch = inputs();
      const start = now();
      for (const value of batch) run(value);
      const elapsed = now() - start;
      if (sample > 0) best = Math.min(best, elapsed);
    }
    return best;
  };
  const once = fastest(() => [input(length)]);
  const many = fastest(() => Array.from({ length: GROWTH }, () => input(Math.ceil(length / GROWTH))));
  return once / many;
}

/**
 * `specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §1 — what
 * `GET /api/v1/storefront/seo/robots-policy` answers.
 *
 * The wire carries two booleans and nothing else. The token an operator picks
 * on the Settings screen (`NOINDEX, FOLLOW` …) is the `seo` module's stored
 * vocabulary and never crosses it, so a consumer branches on `index` and
 * `follow` and cannot come to depend on a spelling.
 *
 * The schema is strict about the two members it reads and tolerant of members
 * it does not know — the second half is what lets a backend add a field
 * without every storefront already deployed reading the answer as unreadable.
 * (`specs/144-seo-search-engine-robots/tasks.md` T005 asked for an extra member
 * to be *rejected*; forward compatibility won, and the member is dropped
 * instead.)
 */
describe('storefrontRobotsPolicySchema', () => {
  it.each([
    { index: true, follow: true },
    { index: false, follow: true },
    { index: true, follow: false },
    { index: false, follow: false },
  ])('accepts %o', (policy) => {
    expect(storefrontRobotsPolicySchema.parse(policy)).toEqual(policy);
  });

  it('rejects a missing key', () => {
    expect(storefrontRobotsPolicySchema.safeParse({ index: false }).success).toBe(false);
    expect(storefrontRobotsPolicySchema.safeParse({ follow: false }).success).toBe(false);
    expect(storefrontRobotsPolicySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a value that is not a boolean', () => {
    expect(storefrontRobotsPolicySchema.safeParse({ index: 'false', follow: true }).success).toBe(
      false,
    );
    expect(storefrontRobotsPolicySchema.safeParse({ index: true, follow: 0 }).success).toBe(false);
    expect(storefrontRobotsPolicySchema.safeParse({ index: null, follow: true }).success).toBe(
      false,
    );
  });

  it('accepts a member it does not know, and drops it', () => {
    // A later backend adding a field must not make this answer unreadable.
    const parsed = storefrontRobotsPolicySchema.parse({
      index: false,
      follow: false,
      maxSnippet: 0,
      defaultRobots: 'NOINDEX, NOFOLLOW',
    });
    // …and the consumer never sees what it was not written for — the stored
    // token included, should a backend ever send it.
    expect(parsed).toEqual({ index: false, follow: false });
    expect(Object.keys(parsed)).toEqual(['index', 'follow']);
  });

  it('is not made valid by an unknown member when a known one is missing or mistyped', () => {
    expect(
      storefrontRobotsPolicySchema.safeParse({ index: false, defaultRobots: 'NOINDEX, NOFOLLOW' })
        .success,
    ).toBe(false);
    expect(
      storefrontRobotsPolicySchema.safeParse({ index: 'false', follow: true, extra: true }).success,
    ).toBe(false);
  });
});

describe('storefrontRobotsPolicyResponseSchema', () => {
  it('accepts the envelope', () => {
    const body = { data: { index: false, follow: true } };
    expect(storefrontRobotsPolicyResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts an envelope and a policy carrying members it does not know', () => {
    expect(
      storefrontRobotsPolicyResponseSchema.parse({
        data: { index: true, follow: false, maxSnippet: 0 },
        meta: { generatedAt: '2026-10-11T00:00:00.000Z' },
      }),
    ).toEqual({ data: { index: true, follow: false } });
  });

  it('rejects a bare policy, an empty envelope and the stored token as data', () => {
    expect(
      storefrontRobotsPolicyResponseSchema.safeParse({ index: false, follow: true }).success,
    ).toBe(false);
    expect(storefrontRobotsPolicyResponseSchema.safeParse({ data: {} }).success).toBe(false);
    expect(
      storefrontRobotsPolicyResponseSchema.safeParse({ data: 'NOINDEX, FOLLOW' }).success,
    ).toBe(false);
  });
});

/**
 * `specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §4 — how a
 * crawler file is put together from the part the storefront generates and the
 * part an operator wrote.
 *
 * One function, because two things have to agree about the join: the file the
 * storefront serves and the preview the Admin UI shows of it.
 *
 * ## What "verbatim" means here
 *
 * Every character of the operator's text is served, unchanged and in order,
 * with two exceptions that are about line breaks and nothing else:
 *
 *  * a line break is served as a line feed however it was stored. A browser's
 *    text field always sends line feeds, an API client may send `CRLF`, and
 *    one file must not come out with two conventions in it depending on which
 *    of them saved last;
 *  * line breaks at the very end of the text are served as exactly one.
 *
 * (`specs/144-seo-search-engine-robots/tasks.md` T054 asked for `CRLF` to be
 * *preserved*; the definition above won, and the cases below hold it.)
 *
 * A third exception is not about line breaks: one byte order mark at the very
 * start of the text is not served. An editor puts it there unseen, and a
 * crawler that meets it does not recognise the line it is glued to.
 */
describe('composeCrawlerFile', () => {
  const BASE = 'User-Agent: *\nAllow: /\nDisallow: /cart\n\nSitemap: https://shop.example.com/sitemap.xml\n';

  it.each([
    ['the empty string', ''],
    ['spaces', '   '],
    ['line breaks', '\n\n'],
    ['CRLF line breaks and a tab', '\r\n\t\r\n'],
  ])('returns the base byte for byte when the extra text is %s', (_label, extra) => {
    expect(composeCrawlerFile(BASE, extra)).toBe(BASE);
    // …whatever the base ends with: it is not this function's to tidy.
    expect(composeCrawlerFile('no trailing break', extra)).toBe('no trailing break');
    expect(composeCrawlerFile('three breaks\n\n\n', extra)).toBe('three breaks\n\n\n');
  });

  it('appends the extra text after one blank line and ends with one line break', () => {
    expect(composeCrawlerFile(BASE, 'User-agent: GPTBot\nDisallow: /')).toBe(
      `${BASE}\nUser-agent: GPTBot\nDisallow: /\n`,
    );
  });

  it('separates by exactly one blank line whatever the base ends with', () => {
    const expected = 'base\n\nextra\n';
    expect(composeCrawlerFile('base', 'extra')).toBe(expected);
    expect(composeCrawlerFile('base\n', 'extra')).toBe(expected);
    expect(composeCrawlerFile('base\n\n\n', 'extra')).toBe(expected);
  });

  it('ends with exactly one line break however many the extra text ends with', () => {
    expect(composeCrawlerFile('base\n', 'extra\n')).toBe('base\n\nextra\n');
    expect(composeCrawlerFile('base\n', 'extra\n\n\n')).toBe('base\n\nextra\n');
    expect(composeCrawlerFile('base\n', 'extra\r\n\r\n')).toBe('base\n\nextra\n');
  });

  it('leaves everything inside the extra text as it was written', () => {
    const extra = [
      '# Zażółć gęślą jaźń — a comment, with non-ASCII and trailing spaces   ',
      '',
      '',
      '\tUser-agent:  GPTBot',
      'Disallow: /*?sort=',
      '  Crawl-delay: 10',
      '<script>alert(1)</script>',
    ].join('\n');
    expect(composeCrawlerFile('base\n', extra)).toBe(`base\n\n${extra}\n`);
  });

  it('keeps blank lines the extra text starts with', () => {
    expect(composeCrawlerFile('base\n', '\n\nextra')).toBe('base\n\n\n\nextra\n');
  });

  it('serves every line break as a line feed, whichever way it was stored', () => {
    const served = 'base\n\nUser-agent: a\nDisallow: /x\n\nUser-agent: b\nDisallow: /y\n';
    expect(
      composeCrawlerFile('base\n', 'User-agent: a\nDisallow: /x\n\nUser-agent: b\nDisallow: /y'),
    ).toBe(served);
    expect(
      composeCrawlerFile(
        'base\n',
        'User-agent: a\r\nDisallow: /x\r\n\r\nUser-agent: b\r\nDisallow: /y\r\n',
      ),
    ).toBe(served);
    expect(
      composeCrawlerFile('base\n', 'User-agent: a\rDisallow: /x\r\rUser-agent: b\rDisallow: /y'),
    ).toBe(served);
    // Mixed, as a text edited through two clients ends up.
    expect(
      composeCrawlerFile('base\n', 'User-agent: a\r\nDisallow: /x\n\rUser-agent: b\nDisallow: /y'),
    ).toBe(served);
    expect(served).not.toContain('\r');
  });

  /**
   * The function runs for every request of a public file, on text an operator
   * saved. Its cost has to be proportional to the text whatever the text is:
   * a pattern that re-scans a long run of line breaks from each of its
   * positions takes seconds on 64 KiB of them, during which the storefront
   * process answers nobody.
   *
   * Such a pattern took one to four and a half **seconds** on the shapes below
   * at 64 KiB. The time is compared across sizes rather than against a budget
   * (issue #612), so a slow host is not a failure and a quadratic path is.
   */
  describe('takes time proportional to the text, whatever the text is', () => {
    const LIMIT = 65_536;

    it.each<[string, (size: number) => string]>([
      ['line feeds, then a character', (size) => `${'\n'.repeat(size - 1)}x`],
      ['a character, line feeds, a character', (size) => `x${'\n'.repeat(size - 2)}x`],
      ['carriage returns, then a character', (size) => `${'\r'.repeat(size - 1)}x`],
      ['CRLF pairs, then a character', (size) => `${'\r\n'.repeat(size / 2 - 1)}x`],
      [
        'alternating line feeds and carriage returns, then a character',
        (size) => `${'\n\r'.repeat(size / 2 - 1)}x`,
      ],
      ['nothing but line feeds after one character', (size) => `x${'\n'.repeat(size - 1)}`],
      ['spaces and line feeds, then a character', (size) => `${' \n'.repeat(size / 2 - 1)}x`],
      ['byte order marks, then a character', (size) => `${'\uFEFF'.repeat(size - 1)}x`],
    ])('%s', (_label, shape) => {
      const extra = shape(LIMIT);
      expect(extra.length).toBeLessThanOrEqual(LIMIT);
      const out = composeCrawlerFile('base\n', extra);
      const ratio = growthRatio((text: string) => composeCrawlerFile('base\n', text), shape, LIMIT);
      expect(ratio, `${GROWTH}× the text, ${ratio.toFixed(2)}× the time`).toBeLessThan(LINEAR_BOUND);
      expect(out.startsWith('base\n\n')).toBe(true);
      expect(out.endsWith('\n')).toBe(true);
      expect(out.endsWith('\n\n')).toBe(false);
      expect(out).not.toContain('\r');
    });

    it('a base that is a long run of line feeds before its last character', () => {
      // The base is this storefront's own and never looks like this; the
      // function is exported, and its cost should not depend on who calls it.
      const shape = (size: number) => `${'\n'.repeat(size / 2)}x${'\n'.repeat(size / 2)}`;
      const out = composeCrawlerFile(shape(2 * LIMIT), 'extra');
      const ratio = growthRatio((base: string) => composeCrawlerFile(base, 'extra'), shape, 2 * LIMIT);
      expect(ratio, `${GROWTH}× the base, ${ratio.toFixed(2)}× the time`).toBeLessThan(LINEAR_BOUND);
      expect(out.endsWith('x\n\nextra\n')).toBe(true);
    });

    it('keeps the line breaks inside such a text — only their encoding and the trailing ones change', () => {
      expect(composeCrawlerFile('base\n', `${'\n'.repeat(1000)}x`)).toBe(
        `base\n\n${'\n'.repeat(1000)}x\n`,
      );
      expect(composeCrawlerFile('base\n', `x${'\r\n'.repeat(1000)}y${'\r'.repeat(1000)}`)).toBe(
        `base\n\nx${'\n'.repeat(1000)}y\n`,
      );
    });
  });

  /**
   * A byte order mark is invisible in every editor and is what some of them
   * put first in a file. Served, it is glued to the first line: a crawler does
   * not recognise `\uFEFFUser-agent: GPTBot` as the start of a group, so the
   * rules written under it attach to the group above — the generated `*`
   * group — and a `Disallow: /` meant for one crawler closes the site to all.
   */
  describe('a byte order mark at the start of the text', () => {
    const BOM = '\uFEFF';

    it('is not served', () => {
      expect(composeCrawlerFile('base\n', `${BOM}User-agent: GPTBot\nDisallow: /`)).toBe(
        'base\n\nUser-agent: GPTBot\nDisallow: /\n',
      );
    });

    it('is exactly one: a second one, and one anywhere else, are the operator’s characters', () => {
      expect(composeCrawlerFile('base\n', `${BOM}${BOM}User-agent: a`)).toBe(
        `base\n\n${BOM}User-agent: a\n`,
      );
      expect(composeCrawlerFile('base\n', `User-agent: a\n${BOM}Disallow: /x`)).toBe(
        `base\n\nUser-agent: a\n${BOM}Disallow: /x\n`,
      );
      expect(composeCrawlerFile('base\n', ` ${BOM}User-agent: a`)).toBe(
        `base\n\n ${BOM}User-agent: a\n`,
      );
    });

    it('alone, or with only whitespace after it, is an empty text', () => {
      expect(composeCrawlerFile('base\n', BOM)).toBe('base\n');
      expect(composeCrawlerFile('base\n', `${BOM}\r\n  \n`)).toBe('base\n');
    });

    it('is never removed from the base', () => {
      expect(composeCrawlerFile(`${BOM}base\n`, 'extra')).toBe(`${BOM}base\n\nextra\n`);
    });
  });

  it('never changes the base it was given', () => {
    // The system-generated rules are the storefront's; an operator's text can
    // follow them and cannot reach into them.
    const composed = composeCrawlerFile(BASE, 'Disallow: /');
    expect(composed.startsWith(BASE)).toBe(true);
  });
});

/**
 * `specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §2 — what
 * `GET /api/v1/storefront/seo/crawler-files` answers.
 *
 * Tolerant of members it does not know and strict about the ones it names, for
 * the reason given at `storefrontRobotsPolicySchema`: a storefront is usually
 * older than its backend.
 */
describe('storefrontCrawlerFilesSchema', () => {
  const FILES = {
    index: false,
    follow: true,
    robotsTxtCustom: 'User-agent: GPTBot\nDisallow: /\n',
    llmsTxtAdditional: '',
    shop: { name: 'Endora Demo' },
  };

  it('accepts the documented shape', () => {
    expect(storefrontCrawlerFilesSchema.parse(FILES)).toEqual(FILES);
  });

  it('accepts empty texts and an empty shop name', () => {
    const empty = { ...FILES, robotsTxtCustom: '', shop: { name: '' } };
    expect(storefrontCrawlerFilesSchema.parse(empty)).toEqual(empty);
  });

  it('returns the texts exactly as given, line breaks included', () => {
    const text = '  first\r\n\r\n\tsecond \n';
    expect(
      storefrontCrawlerFilesSchema.parse({ ...FILES, robotsTxtCustom: text }).robotsTxtCustom,
    ).toBe(text);
  });

  it.each(['index', 'follow', 'robotsTxtCustom', 'llmsTxtAdditional', 'shop'] as const)(
    'rejects a missing %s',
    (member) => {
      const partial: Record<string, unknown> = { ...FILES };
      delete partial[member];
      expect(storefrontCrawlerFilesSchema.safeParse(partial).success).toBe(false);
    },
  );

  it('rejects a text that is not a string, and a shop without a name', () => {
    for (const wrong of [
      { ...FILES, robotsTxtCustom: null },
      { ...FILES, robotsTxtCustom: ['Disallow: /'] },
      { ...FILES, llmsTxtAdditional: 1 },
      { ...FILES, shop: {} },
      { ...FILES, shop: 'Endora Demo' },
      { ...FILES, shop: { name: null } },
      { ...FILES, index: 'false' },
    ]) {
      expect(storefrontCrawlerFilesSchema.safeParse(wrong).success).toBe(false);
    }
  });

  /**
   * `anonymousAccess` — whether the channel is open to anonymous visitors
   * (`specs/154-sales-channel-access/`). Additive: a backend older than it
   * never sends it, and an answer without it still parses.
   */
  describe('anonymousAccess', () => {
    it('is optional, and a boolean when it is there', () => {
      expect(storefrontCrawlerFilesSchema.parse(FILES)).not.toHaveProperty('anonymousAccess');
      for (const anonymousAccess of [true, false]) {
        expect(storefrontCrawlerFilesSchema.parse({ ...FILES, anonymousAccess }).anonymousAccess).toBe(
          anonymousAccess,
        );
      }
      for (const anonymousAccess of ['false', 0, null, {}]) {
        expect(storefrontCrawlerFilesSchema.safeParse({ ...FILES, anonymousAccess }).success).toBe(
          false,
        );
      }
    });
  });

  /**
   * `unreadable` — the members the backend could not read from what is stored
   * (`contracts/crawler-policy.md` §2.2). It is what lets `robots.txt` be
   * served while the channel's default robots is a value nobody can interpret:
   * the answer is still a `200`, and only a file that needs the named member
   * treats it as unknown.
   */
  describe('unreadable', () => {
    it('is optional: an answer without it has every member readable', () => {
      expect(storefrontCrawlerFilesSchema.parse(FILES)).not.toHaveProperty('unreadable');
    });

    it('accepts the two names this release sends, and an empty list', () => {
      for (const unreadable of [[], ['policy'], ['llmsTxtAdditional'], ['policy', 'llmsTxtAdditional']]) {
        expect(storefrontCrawlerFilesSchema.parse({ ...FILES, unreadable }).unreadable).toEqual(
          unreadable,
        );
      }
    });

    it('accepts a name it does not know: a later backend may add one', () => {
      expect(
        storefrontCrawlerFilesSchema.safeParse({ ...FILES, unreadable: ['shop'] }).success,
      ).toBe(true);
    });

    it('rejects anything that is not a list of names', () => {
      for (const unreadable of ['policy', true, null, [1], [null], { policy: true }]) {
        expect(storefrontCrawlerFilesSchema.safeParse({ ...FILES, unreadable }).success).toBe(
          false,
        );
      }
    });

    it('still requires every named member beside it: unreadable is said, not shown by absence', () => {
      const { index: _index, ...withoutIndex } = FILES;
      expect(
        storefrontCrawlerFilesSchema.safeParse({ ...withoutIndex, unreadable: ['policy'] }).success,
      ).toBe(false);
      expect(
        storefrontCrawlerFilesSchema.safeParse({
          ...FILES,
          llmsTxtAdditional: null,
          unreadable: ['llmsTxtAdditional'],
        }).success,
      ).toBe(false);
    });
  });

  it('rejects a text longer than any the backend accepts', () => {
    // The limit is in bytes and is enforced where the text is saved. A text of
    // that many bytes never has more characters than that, so a longer string
    // is one that did not come through that door.
    expect(CRAWLER_TEXT_MAX_BYTES).toBe(65_536);
    const atLimit = 'a'.repeat(CRAWLER_TEXT_MAX_BYTES);
    expect(
      storefrontCrawlerFilesSchema.safeParse({ ...FILES, robotsTxtCustom: atLimit }).success,
    ).toBe(true);
    expect(
      storefrontCrawlerFilesSchema.safeParse({ ...FILES, robotsTxtCustom: `${atLimit}a` }).success,
    ).toBe(false);
    expect(
      storefrontCrawlerFilesSchema.safeParse({ ...FILES, llmsTxtAdditional: `${atLimit}a` }).success,
    ).toBe(false);
  });

  it('accepts members it does not know, and drops them', () => {
    const parsed = storefrontCrawlerFilesSchema.parse({
      ...FILES,
      somethingNewer: true,
      shop: { name: 'Endora Demo', logoUrl: 'https://cdn.example.com/logo.png' },
    });
    expect(parsed).toEqual(FILES);
  });
});

describe('storefrontCrawlerFilesResponseSchema', () => {
  const FILES = {
    index: true,
    follow: true,
    robotsTxtCustom: '',
    llmsTxtAdditional: '',
    shop: { name: '' },
  };

  it('accepts the envelope, with or without members it does not know', () => {
    expect(storefrontCrawlerFilesResponseSchema.parse({ data: FILES })).toEqual({ data: FILES });
    expect(
      storefrontCrawlerFilesResponseSchema.parse({ data: FILES, meta: { a: 1 } }),
    ).toEqual({ data: FILES });
  });

  it('rejects the bare value, an empty envelope and a robots policy alone', () => {
    expect(storefrontCrawlerFilesResponseSchema.safeParse(FILES).success).toBe(false);
    expect(storefrontCrawlerFilesResponseSchema.safeParse({ data: {} }).success).toBe(false);
    expect(
      storefrontCrawlerFilesResponseSchema.safeParse({ data: { index: true, follow: true } })
        .success,
    ).toBe(false);
  });
});

/**
 * `specs/144-seo-search-engine-robots/contracts/admin-surfaces.md` §3 — what
 * `GET /api/v1/admin/seo/crawler-files/preview` is asked and answers.
 *
 * The response is read by the Admin UI, which is built from the same release
 * as the backend that answers it, so it is held strictly: a state the UI has
 * no words for is refused rather than rendered as a blank preview.
 */
describe('adminCrawlerFilePreviewQuerySchema', () => {
  it.each(['robots', 'llms'] as const)('accepts file=%s with a sales channel', (file) => {
    expect(
      adminCrawlerFilePreviewQuerySchema.parse({ file, salesChannelCode: 'pl' }),
    ).toEqual({ file, salesChannelCode: 'pl' });
  });

  it('accepts a query that names no sales channel: it asks about the system default one', () => {
    expect(adminCrawlerFilePreviewQuerySchema.parse({ file: 'robots' })).toEqual({ file: 'robots' });
  });

  it.each([
    ['an unknown file', { file: 'sitemap', salesChannelCode: 'pl' }],
    ['no file', { salesChannelCode: 'pl' }],
    ['an empty sales channel', { file: 'robots', salesChannelCode: '' }],
    ['a sales channel that is not a code', { file: 'robots', salesChannelCode: 'pl\r\nHost: x' }],
    ['a sales channel longer than a code', { file: 'robots', salesChannelCode: 'x'.repeat(65) }],
  ])('refuses %s', (_label, query) => {
    expect(adminCrawlerFilePreviewQuerySchema.safeParse(query).success).toBe(false);
  });

  it('names no address: a caller cannot say where the request goes', () => {
    expect(Object.keys(adminCrawlerFilePreviewQuerySchema.shape).sort()).toEqual([
      'file',
      'salesChannelCode',
    ]);
    expect(
      adminCrawlerFilePreviewQuerySchema.safeParse({
        file: 'robots',
        salesChannelCode: 'pl',
        url: 'http://169.254.169.254/',
      }).success,
    ).toBe(false);
  });
});

describe('adminCrawlerFilePreviewResponseSchema', () => {
  const BASE = 'User-agent: *\nAllow: /\n';
  const answer = (overrides: Record<string, unknown> = {}): unknown => ({
    data: {
      file: 'robots',
      salesChannelCode: 'pl',
      state: 'ok',
      base: BASE,
      savedExtra: 'User-agent: GPTBot\nDisallow: /\n',
      savedExtraSource: 'channel',
      channelsWithOwnValue: ['pl', 'de'],
      policy: { index: false, follow: false },
      storefront: { url: 'https://shop.example', source: 'setting' },
      ...overrides,
    },
  });

  it.each([
    ['ok', BASE],
    ['storefront-outdated', BASE],
    ['storefront-outdated', null],
    ['not-served', null],
    ['storefront-unreachable', null],
    ['address-unknown', null],
  ] as const)('accepts state %s with base %j', (state, base) => {
    expect(adminCrawlerFilePreviewResponseSchema.safeParse(answer({ state, base })).success).toBe(
      true,
    );
  });

  it('declares exactly the five states', () => {
    expect([...adminCrawlerFilePreviewStateSchema.options].sort()).toEqual([
      'address-unknown',
      'not-served',
      'ok',
      'storefront-outdated',
      'storefront-unreachable',
    ]);
  });

  it.each([
    ['an unknown state', { state: 'cached' }],
    ['an unknown source of the saved text', { savedExtraSource: 'env' }],
    ['an unknown source of the address', { storefront: { url: 'https://x', source: 'guess' } }],
    ['a policy with half of it missing', { policy: { index: true } }],
    ['a base that is not text', { base: 42 }],
  ])('refuses %s', (_label, overrides) => {
    expect(adminCrawlerFilePreviewResponseSchema.safeParse(answer(overrides)).success).toBe(false);
  });

  it.each(['channel', 'global', 'default'] as const)('accepts savedExtraSource %s', (source) => {
    expect(
      adminCrawlerFilePreviewResponseSchema.safeParse(answer({ savedExtraSource: source })).success,
    ).toBe(true);
  });

  it('never carries system rules it did not obtain: ok without a base is refused', () => {
    expect(
      adminCrawlerFilePreviewResponseSchema.safeParse(answer({ state: 'ok', base: null })).success,
    ).toBe(false);
  });

  it.each(['storefront-unreachable', 'address-unknown', 'not-served'] as const)(
    'refuses a base beside state %s, which obtained none',
    (state) => {
      expect(
        adminCrawlerFilePreviewResponseSchema.safeParse(answer({ state, base: BASE })).success,
      ).toBe(false);
    },
  );
});
