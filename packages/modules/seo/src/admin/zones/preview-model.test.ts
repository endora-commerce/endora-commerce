import { describe, expect, it } from 'vitest';
import { composeCrawlerFile, type AdminCrawlerFilePreview } from '@endora-commerce/contracts';
import {
  DEFAULT_ROBOTS_NOTICE_MAX_CHANNELS,
  buildPreviewModel,
  closesSiteToEveryCrawler,
  outdatedStorefrontChannels,
  previewFile,
  servedOperatorPart,
  servedSystemPart,
  type PreviewModel,
  type PreviewRequest,
} from './preview-model.js';

const now = () => performance.now();

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
 * What the `robots.txt` preview shows — one case per row of
 * `specs/144-seo-search-engine-robots/contracts/admin-surfaces.md` §4.
 *
 * The model is a pure function, so every state of the screen is reachable
 * here without a browser: which blocks, which notices, and — the property the
 * preview exists for — that the two blocks are the served file and nothing
 * else.
 */

const BASE = 'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://shop.example/sitemap.xml\n';
const OWN = 'User-agent: GPTBot\nDisallow: /\n';

function answer(overrides: Partial<AdminCrawlerFilePreview> = {}): AdminCrawlerFilePreview {
  return {
    file: 'robots',
    salesChannelCode: 'pl',
    state: 'ok',
    base: BASE,
    savedExtra: '',
    savedExtraSource: 'default',
    channelsWithOwnValue: [],
    policy: { index: true, follow: true },
    storefront: { url: 'https://shop.example', source: 'setting' },
    ...overrides,
  };
}

const ready = (overrides: Partial<AdminCrawlerFilePreview> = {}): PreviewRequest => ({
  status: 'ready',
  data: answer(overrides),
});

const kinds = (model: PreviewModel): string[] => model.notices.map((notice) => notice.kind);

/** What the screen's one block holds: its stretches, in order, as one text. */
const blockText = (model: PreviewModel): string => {
  if (model.file === null) throw new Error('no file');
  return model.file.segments.map((segment) => segment.text).join('');
};

const segmentKinds = (model: PreviewModel): string[] =>
  (model.file?.segments ?? []).map((segment) => segment.kind);

describe('buildPreviewModel — the file is one block, and it is the served file', () => {
  it('shows the generated rules, a blank line and the operator’s text as one file', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: OWN, dirty: false },
      ready({ savedExtra: OWN, savedExtraSource: 'channel', channelsWithOwnValue: ['pl'] }),
    );
    expect(model.mode).toBe('channel');
    expect(model.previewedChannel).toBe('pl');
    expect(model.loading).toBe(false);
    expect(model.file?.text).toBe(composeCrawlerFile(BASE, OWN));
    expect(blockText(model)).toBe(composeCrawlerFile(BASE, OWN));
    expect(segmentKinds(model)).toEqual(['system', 'separator', 'operator']);
    expect(model.file?.segments[0]?.text).toBe(`${BASE.trimEnd()}\n`);
    expect(model.file?.segments[1]?.text).toBe('\n');
    expect(model.file?.segments[2]?.text).toBe('User-agent: GPTBot\nDisallow: /\n');
    // Inside the file, so not shown a second time beside it.
    expect(model.detachedOperatorPart).toBeNull();
    expect(model.operatorPartEmpty).toBe(false);
    expect(model.storefrontUrl).toBe('https://shop.example');
    expect(kinds(model)).toEqual([]);
  });

  it.each([
    ['nothing at all', ''],
    ['only whitespace', '  \n\t\n'],
    ['only a byte order mark', '\uFEFF'],
  ])('with %s in the field the file is the generated rules alone, byte for byte', (_label, text) => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: text, dirty: false }, ready());
    expect(model.file?.text).toBe(BASE);
    expect(blockText(model)).toBe(BASE);
    expect(segmentKinds(model)).toEqual(['system']);
    expect(model.operatorPartEmpty).toBe(true);
    expect(model.detachedOperatorPart).toBeNull();
  });

  it.each([
    ['CRLF line breaks', 'User-agent: A\r\nDisallow: /x\r\n'],
    ['lone carriage returns', 'User-agent: A\rDisallow: /x\r'],
    ['a leading byte order mark', '\uFEFFUser-agent: A\nDisallow: /x'],
    ['many trailing line breaks', 'User-agent: A\nDisallow: /x\n\n\n\n'],
    ['leading blank lines and indentation', '\n\n  User-agent: A\n\tDisallow: /x  \n'],
    ['text outside ASCII', '# Zażółć gęślą jaźń 🤖\nDisallow: /zażółć\n'],
  ])('the block is the served file for %s', (_label, text) => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: text, dirty: true }, ready());
    expect(blockText(model)).toBe(composeCrawlerFile(BASE, text));
    expect(model.file?.text).toBe(composeCrawlerFile(BASE, text));
    expect(blockText(model)).not.toContain('\r');
    expect(blockText(model)).not.toContain('\uFEFF');
  });

  it('a base without a closing line break joins the same way', () => {
    const base = 'User-agent: *\nAllow: /';
    const model = buildPreviewModel({ channelCode: 'pl', draftText: OWN, dirty: false }, ready({ base }));
    expect(blockText(model)).toBe(composeCrawlerFile(base, OWN));
  });

  it('treats a setting with no text value as an empty field', () => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: null, dirty: false }, ready());
    expect(model.file?.text).toBe(BASE);
  });

  it('previewFile’s stretches join to composeCrawlerFile’s answer for any pair', () => {
    for (const base of ['', 'a', 'a\n', 'a\n\n\n', BASE]) {
      for (const text of ['', ' ', 'x', 'x\n', '\nx\r\n\r\n', '\uFEFFx']) {
        const file = previewFile(base, text);
        expect(file.text).toBe(composeCrawlerFile(base, text));
        expect(file.segments.map((segment) => segment.text).join('')).toBe(file.text);
      }
    }
  });
});

describe('buildPreviewModel — what the file is: after saving, or served now', () => {
  it('with unsaved text the file is the one that will be served after saving', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: 'Disallow: /new/\n', dirty: true },
      ready({ savedExtra: OWN, savedExtraSource: 'channel', channelsWithOwnValue: ['pl'] }),
    );
    expect(model.shows).toBe('after-saving');
    expect(model.operatorPartUnsaved).toBe(true);
    expect(model.file?.text).toBe(composeCrawlerFile(BASE, 'Disallow: /new/\n'));
    // Not one character of the saved text is shown as if it were the field's.
    expect(model.file?.text).not.toContain('GPTBot');
  });

  it('with nothing unsaved the file is the one served now', () => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: OWN, dirty: false }, ready());
    expect(model.shows).toBe('served-now');
    expect(model.operatorPartUnsaved).toBe(false);
  });

  it('while the storefront’s part is being asked for there is no file, and the text is shown apart', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: 'Disallow: /new/', dirty: true },
      { status: 'loading' },
    );
    expect(model.loading).toBe(true);
    expect(model.shows).toBe('unknown');
    expect(model.file).toBeNull();
    expect(model.detachedOperatorPart).toBe('Disallow: /new/');
    expect(model.operatorPartUnsaved).toBe(true);
    expect(model.previewedChannel).toBe('pl');
  });
});

describe('buildPreviewModel — the all-channels value', () => {
  it('previews the field’s text on the channel asked about and names the channels it does not reach', () => {
    const model = buildPreviewModel(
      { channelCode: null, draftText: 'Disallow: /shared/\n', dirty: true },
      ready({ savedExtraSource: 'global', channelsWithOwnValue: ['de', 'fr'] }),
    );
    expect(model.mode).toBe('all-channels');
    expect(model.previewedChannel).toBe('pl');
    expect(model.operatorPartOrigin).toBe('field');
    expect(model.shows).toBe('after-saving');
    expect(model.file?.text).toBe(composeCrawlerFile(BASE, 'Disallow: /shared/\n'));
    const unaffected = model.notices.find((notice) => notice.kind === 'channels-with-own-value');
    expect(unaffected?.channels).toEqual(['de', 'fr']);
    expect(kinds(model)).toEqual(['channels-with-own-value']);
  });

  it('shows a channel that has its own value the file it serves — not the field', () => {
    const model = buildPreviewModel(
      { channelCode: null, draftText: 'Disallow: /shared/\n', dirty: true },
      ready({
        salesChannelCode: 'de',
        savedExtra: OWN,
        savedExtraSource: 'channel',
        channelsWithOwnValue: ['de'],
      }),
    );
    expect(model.previewedChannel).toBe('de');
    expect(model.operatorPartOrigin).toBe('saved');
    expect(model.file?.text).toBe(composeCrawlerFile(BASE, OWN));
    expect(model.file?.text).not.toContain('shared');
    // What is shown is saved, so it is what is served now.
    expect(model.operatorPartUnsaved).toBe(false);
    expect(model.shows).toBe('served-now');
    expect(kinds(model)).toEqual(['previewed-channel-has-own-value', 'channels-with-own-value']);
  });

  it('names no unaffected channel when none has its own value', () => {
    const model = buildPreviewModel({ channelCode: null, draftText: '', dirty: false }, ready());
    expect(kinds(model)).toEqual([]);
  });

  it('names the previewed channel from the answer, which knows which channel "the default" was', () => {
    const model = buildPreviewModel(
      { channelCode: null, draftText: OWN, dirty: false },
      ready({ salesChannelCode: 'main' }),
    );
    expect(model.previewedChannel).toBe('main');
    const waiting = buildPreviewModel({ channelCode: null, draftText: OWN, dirty: false }, { status: 'loading' });
    expect(waiting.previewedChannel).toBeNull();
  });

  it('a channel row never lists other channels: its value is its own', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: OWN, dirty: false },
      ready({ channelsWithOwnValue: ['pl', 'de'] }),
    );
    expect(kinds(model)).toEqual([]);
  });
});

describe('buildPreviewModel — a channel whose default robots forbids indexing', () => {
  const noindex = { policy: { index: false, follow: true } };

  it('says that robots.txt stays open on purpose', () => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: '', dirty: false }, ready(noindex));
    expect(kinds(model)).toEqual(['stays-open']);
    // The file itself is unchanged by the policy.
    expect(model.file?.text).toBe(BASE);
  });

  it.each(['User-agent: *\nDisallow: /\n', 'User-agent: *\nDisallow: /*\n'])(
    'cautions when the operator’s text closes the site to every crawler: %j',
    (text) => {
      const model = buildPreviewModel({ channelCode: 'pl', draftText: text, dirty: true }, ready(noindex));
      expect(kinds(model)).toEqual(['stays-open', 'site-wide-disallow']);
      expect(model.notices.find((notice) => notice.kind === 'site-wide-disallow')?.tone).toBe('warning');
    },
  );

  it('does not caution about a ban on one named crawler', () => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: OWN, dirty: false }, ready(noindex));
    expect(kinds(model)).toEqual(['stays-open']);
  });

  it('says neither on a channel that may be indexed, whatever the text', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: 'User-agent: *\nDisallow: /\n', dirty: false },
      ready(),
    );
    expect(kinds(model)).toEqual([]);
  });

  it('NOFOLLOW alone is not NOINDEX', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: '', dirty: false },
      ready({ policy: { index: true, follow: false } }),
    );
    expect(kinds(model)).toEqual([]);
  });
});

describe('buildPreviewModel — when the joined file cannot be shown as current', () => {
  it('storefront-outdated: the file is the rules it serves alone, and the text is shown apart', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: OWN, dirty: true },
      ready({ state: 'storefront-outdated' }),
    );
    expect(kinds(model)).toEqual(['storefront-outdated']);
    expect(model.notices[0]?.tone).toBe('warning');
    // Its whole answer, untouched: that storefront was not seen to append anything.
    expect(model.file?.text).toBe(BASE);
    expect(segmentKinds(model)).toEqual(['system']);
    // Saving would not change that file, so it is not called "after saving".
    expect(model.shows).toBe('served-now');
    expect(model.detachedOperatorPart).toBe('User-agent: GPTBot\nDisallow: /');
  });

  it.each([
    ['storefront-unreachable', 'storefront-unreachable'],
    ['address-unknown', 'address-unknown'],
  ] as const)('%s: says so, shows no file, and still shows the operator’s text', (state, kind) => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: OWN, dirty: true },
      ready({ state, base: null }),
    );
    expect(kinds(model)).toEqual([kind]);
    expect(model.file).toBeNull();
    expect(model.shows).toBe('unknown');
    expect(model.detachedOperatorPart).toBe('User-agent: GPTBot\nDisallow: /');
    expect(model.operatorPartUnsaved).toBe(true);
  });

  it('address-unknown shows no address, because there is none', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: '', dirty: false },
      ready({ state: 'address-unknown', base: null, storefront: { url: 'http://localhost:3000', source: 'fallback' } }),
    );
    expect(model.storefrontUrl).toBeNull();
    expect(model.detachedOperatorPart).toBeNull();
  });

  it('a failed request: says so, shows no file, keeps the operator’s text', () => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: OWN, dirty: false }, { status: 'failed' });
    expect(kinds(model)).toEqual(['preview-failed']);
    expect(model.file).toBeNull();
    expect(model.detachedOperatorPart).toBe('User-agent: GPTBot\nDisallow: /');
  });

  it('never invents generated rules: without a base there is no file in any state', () => {
    for (const request of [
      { status: 'loading' },
      { status: 'failed' },
      ready({ state: 'storefront-unreachable', base: null }),
      ready({ state: 'address-unknown', base: null }),
      ready({ state: 'not-served', base: null }),
    ] as PreviewRequest[]) {
      const model = buildPreviewModel({ channelCode: 'pl', draftText: OWN, dirty: false }, request);
      expect(model.file).toBeNull();
      expect(model.shows).toBe('unknown');
    }
  });
});

describe('buildPreviewModel — the address every channel shares', () => {
  it('says so when the address is the deployment-wide one', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: '', dirty: false },
      ready({ storefront: { url: 'https://env.example', source: 'env' } }),
    );
    expect(kinds(model)).toEqual(['shared-address']);
    expect(model.storefrontUrl).toBe('https://env.example');
  });

  it('does not when the channel has an address of its own', () => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: '', dirty: false }, ready());
    expect(kinds(model)).not.toContain('shared-address');
  });
});

/**
 * `llms.txt` — the same model, asked about the other file
 * (`contracts/admin-surfaces.md` §4, the `llms` rows; FR-044).
 *
 * Everything the cases above hold about the block is true of this file too,
 * because it is the same function: what is held here is where the two differ.
 * `robots.txt` is always served; `llms.txt` is withdrawn on a channel that
 * asks not to be indexed, and the preview then says so instead of showing a
 * file nobody is served.
 */
describe('buildPreviewModel — llms.txt', () => {
  const LLMS_BASE = '# Endora Demo\n\n## Pages\n\n- [Home](https://shop.example/)\n';
  const CONTENT = '## About\n\nWe sell bolts.\n';
  const llms = (overrides: Partial<AdminCrawlerFilePreview> = {}): PreviewRequest =>
    ready({ file: 'llms', base: LLMS_BASE, ...overrides });

  it('is one block that is the served file: the generated base, a blank line, the content', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: CONTENT, dirty: false },
      llms({ savedExtra: CONTENT, savedExtraSource: 'channel', channelsWithOwnValue: ['pl'] }),
      'llms',
    );
    expect(model.shows).toBe('served-now');
    expect(model.file?.text).toBe(composeCrawlerFile(LLMS_BASE, CONTENT));
    expect(blockText(model)).toBe(composeCrawlerFile(LLMS_BASE, CONTENT));
    expect(segmentKinds(model)).toEqual(['system', 'separator', 'operator']);
    expect(model.detachedOperatorPart).toBeNull();
    expect(kinds(model)).toEqual([]);
  });

  it('with unsaved content the file is the one served after saving', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: CONTENT, dirty: true },
      llms(),
      'llms',
    );
    expect(model.shows).toBe('after-saving');
    expect(model.operatorPartUnsaved).toBe(true);
    expect(blockText(model)).toBe(composeCrawlerFile(LLMS_BASE, CONTENT));
  });

  it('with no content the file is the generated base alone, byte for byte', () => {
    const model = buildPreviewModel({ channelCode: 'pl', draftText: '', dirty: false }, llms(), 'llms');
    expect(blockText(model)).toBe(LLMS_BASE);
    expect(segmentKinds(model)).toEqual(['system']);
  });

  describe('a channel whose default robots forbids indexing', () => {
    it.each([
      ['the storefront says so', { state: 'not-served', base: null } as const],
      // The storefront's own minute has not passed since the setting was saved.
      ['the storefront still serves it', { state: 'ok', base: LLMS_BASE } as const],
    ])('says that no llms.txt is served, in place of the file — %s', (_label, storefront) => {
      const model = buildPreviewModel(
        { channelCode: 'pl', draftText: CONTENT, dirty: true },
        llms({ ...storefront, policy: { index: false, follow: true }, savedExtra: CONTENT }),
        'llms',
      );
      expect(model.shows).toBe('not-served');
      expect(model.file).toBeNull();
      // In place of the blocks: the operator's text is in the field above and
      // is not drawn a second time as if it were part of something served.
      expect(model.detachedOperatorPart).toBeNull();
      expect(kinds(model)).toEqual(['llms-not-served-noindex']);
      expect(model.notices[0]?.tone).toBe('info');
    });

    it('does not say robots.txt stays open, nor caution about a crawl ban: that is the other file', () => {
      const model = buildPreviewModel(
        { channelCode: 'pl', draftText: 'User-agent: *\nDisallow: /\n', dirty: false },
        llms({ state: 'not-served', base: null, policy: { index: false, follow: false } }),
        'llms',
      );
      expect(kinds(model)).not.toContain('stays-open');
      expect(kinds(model)).not.toContain('site-wide-disallow');
    });

    it('NOFOLLOW alone withdraws nothing', () => {
      const model = buildPreviewModel(
        { channelCode: 'pl', draftText: CONTENT, dirty: false },
        llms({ policy: { index: true, follow: false } }),
        'llms',
      );
      expect(model.shows).toBe('served-now');
      expect(kinds(model)).toEqual([]);
    });
  });

  it('not served on a channel that may be indexed: says so, without blaming a setting that allows it', () => {
    // The storefront has not caught up with a change yet, or sees no `seo`.
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: CONTENT, dirty: false },
      llms({ state: 'not-served', base: null }),
      'llms',
    );
    expect(model.shows).toBe('not-served');
    expect(model.file).toBeNull();
    expect(model.detachedOperatorPart).toBeNull();
    expect(kinds(model)).toEqual(['llms-not-served']);
  });

  it('storefront-outdated: no file — it has none — and the content shown apart', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: CONTENT, dirty: false },
      llms({ state: 'storefront-outdated', base: null }),
      'llms',
    );
    expect(model.shows).toBe('unknown');
    expect(model.file).toBeNull();
    expect(model.detachedOperatorPart).toBe(CONTENT.trimEnd());
    expect(kinds(model)).toEqual(['storefront-outdated']);
  });

  it.each([
    ['storefront-unreachable', 'storefront-unreachable'],
    ['address-unknown', 'address-unknown'],
  ] as const)('%s: no file, the content still shown, and it is not called "not served"', (state, notice) => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: CONTENT, dirty: true },
      llms({ state, base: null }),
      'llms',
    );
    expect(model.shows).toBe('unknown');
    expect(model.file).toBeNull();
    expect(model.detachedOperatorPart).toBe(CONTENT.trimEnd());
    expect(kinds(model)).toEqual([notice]);
  });

  it('the all-channels value: names the channels it does not reach, as for robots.txt', () => {
    const model = buildPreviewModel(
      { channelCode: null, draftText: CONTENT, dirty: true },
      llms({ salesChannelCode: 'de', channelsWithOwnValue: ['pl'] }),
      'llms',
    );
    expect(model.mode).toBe('all-channels');
    expect(blockText(model)).toBe(composeCrawlerFile(LLMS_BASE, CONTENT));
    expect(kinds(model)).toEqual(['channels-with-own-value']);
  });

  it('robots.txt is never "not served", whatever the channel’s default robots', () => {
    const model = buildPreviewModel(
      { channelCode: 'pl', draftText: OWN, dirty: false },
      ready({ policy: { index: false, follow: false } }),
    );
    expect(model.shows).toBe('served-now');
    expect(model.file).not.toBeNull();
    expect(kinds(model)).toContain('stays-open');
    expect(kinds(model)).not.toContain('llms-not-served-noindex');
  });
});

describe('servedOperatorPart and servedSystemPart', () => {
  it.each([
    ['', ''],
    [' \n ', ''],
    ['a', 'a'],
    ['a\n', 'a'],
    ['a\r\nb\r\n\r\n', 'a\nb'],
    ['﻿a', 'a'],
    ['\n\na\n', '\n\na'],
  ])('servedOperatorPart(%j) is %j', (text, expected) => {
    expect(servedOperatorPart(text)).toBe(expected);
  });

  it('servedSystemPart is the base itself when the text adds nothing', () => {
    expect(servedSystemPart(BASE, '')).toBe(BASE);
    expect(servedSystemPart(BASE, '  \n')).toBe(BASE);
  });

  it('servedSystemPart drops only the line breaks the base ends with when text follows', () => {
    expect(servedSystemPart('a\nb\n\n\n', 'x')).toBe('a\nb');
    expect(servedSystemPart('', 'x')).toBe('');
  });
});

describe('closesSiteToEveryCrawler', () => {
  it.each([
    ['a ban under User-agent: *', 'User-agent: *\nDisallow: /\n'],
    ['field names in another case, with spaces', 'user-AGENT :  *\n  DISALLOW :  /  \n'],
    ['a ban in a group that names * among others', 'User-agent: GPTBot\nUser-agent: *\nDisallow: /\n'],
    ['a ban before any User-agent line, which follows the generated * group', 'Disallow: /\n'],
    ['CRLF line breaks', 'User-agent: *\r\nAllow: /a\r\nDisallow: /\r\n'],
    ['a trailing comment', 'User-agent: *\nDisallow: / # everything\n'],
    ['a later * group', 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /\n'],
    ['the same ban spelled with a wildcard', 'User-agent: *\nDisallow: /*\n'],
  ])('is true for %s', (_label, text) => {
    expect(closesSiteToEveryCrawler(text)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['a ban for one named crawler', 'User-agent: GPTBot\nDisallow: /\n'],
    ['a ban on a directory', 'User-agent: *\nDisallow: /private/\n'],
    ['a wildcard ban on a directory', 'User-agent: *\nDisallow: /private/*\n'],
    ['a wildcard ban on a file type', 'User-agent: *\nDisallow: /*.pdf\n'],
    ['an empty Disallow, which allows everything', 'User-agent: *\nDisallow:\n'],
    ['a commented-out ban', 'User-agent: *\n# Disallow: /\n'],
    ['Allow: /', 'User-agent: *\nAllow: /\n'],
    ['a named group after a * group that bans nothing', 'User-agent: *\nAllow: /\nUser-agent: Bot\nDisallow: /\n'],
    ['text that is not rules', 'hello world\n/\n'],
  ])('is false for %s', (_label, text) => {
    expect(closesSiteToEveryCrawler(text)).toBe(false);
  });

  it('is linear in the text: 64 KiB of line breaks, of colons, or of one group’s User-agent lines', () => {
    const shapes: ReadonlyArray<readonly [string, (size: number) => string]> = [
      ['line breaks', (size) => '\n'.repeat(size)],
      ['colons', (size) => ':'.repeat(size)],
      ['User-agent lines', (size) => 'User-agent: *\n'.repeat(size / 14)],
    ];
    for (const [label, shape] of shapes) {
      const ratio = growthRatio(closesSiteToEveryCrawler, shape, 65_536);
      expect(ratio, `${label}: ${GROWTH}× the text, ${ratio.toFixed(2)}× the time`).toBeLessThan(LINEAR_BOUND);
    }
  });
});

describe('outdatedStorefrontChannels — the notice on the Default robots row', () => {
  it('names the channels whose storefront answered without the capability, from the answers', () => {
    expect(
      outdatedStorefrontChannels([
        { request: ready({ salesChannelCode: 'pl', state: 'storefront-outdated' }) },
        { request: ready({ salesChannelCode: 'de' }) },
        { request: ready({ salesChannelCode: 'fr', state: 'storefront-outdated' }) },
        // The same channel asked about twice is named once.
        { request: ready({ salesChannelCode: 'fr', state: 'storefront-outdated' }) },
      ]),
    ).toEqual(['pl', 'fr']);
  });

  it.each([
    ['still loading', { status: 'loading' }],
    ['the request failed', { status: 'failed' }],
    ['the storefront is unreachable', ready({ state: 'storefront-unreachable', base: null })],
    ['the address is unknown', ready({ state: 'address-unknown', base: null })],
    ['the storefront is current', ready()],
  ] as Array<[string, PreviewRequest]>)('names nobody when %s', (_label, request) => {
    expect(outdatedStorefrontChannels([{ request }])).toEqual([]);
  });

  it('bounds how many channels the all-channels row asks about', () => {
    expect(DEFAULT_ROBOTS_NOTICE_MAX_CHANNELS).toBe(5);
  });
});
