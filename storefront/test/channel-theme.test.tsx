import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicSalesChannel } from '../lib/api/sales-channel';
import { resolveStorefrontTheme, resetThemeWarnings, themeForChannel } from '../lib/theme/theme';
import { StorefrontDocument } from '../lib/theme/StorefrontDocument';
import {
  DEFAULT_STOREFRONT_THEME_CODE,
  isStorefrontThemeCode,
} from '../lib/theme/instance-themes';
import { INSTANCE_THEME_CODES } from '../lib/theme/themes.generated';

/**
 * Feature `005-sales-channels` — `sales_channels.theme_code` is read.
 *
 * The field shipped on 2026-04-30 with a column, an entity field, a service, a
 * cache, an admin input and a place on `PublicSalesChannelSchema`, and nothing
 * read it: measured on 2026-08-29, `themeCode` appeared nowhere under
 * `storefront/`, the public schema had two references and both were its own
 * declaration, and `GET /api/v1/storefront/sales-channel` was named only in a
 * comment and a prose contract.
 *
 * The first test is the proof that this is no longer true, and it is
 * deliberately end-to-end within what an SSR-only harness can see: a request
 * whose channel names theme A produces markup selecting A's token values, and
 * the same code path with theme B produces B's — in one test, server-side, with
 * the tokens read out of the stylesheet rather than restated here. Restating
 * them would let the CSS and the test drift into agreeing about a colour
 * neither ships.
 */

const cssPath = fileURLToPath(new URL('../app/globals.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/**
 * The Tier-1 declarations of one `:root[data-theme='<code>']` block, or `null`
 * when the stylesheet has no such block.
 *
 * A flat scan for the selector and its balanced-free brace body: these blocks
 * contain only custom-property declarations, so the first `}` closes them.
 */
function themeBlock(code: string): Record<string, string> | null {
  const start = css.indexOf(`:root[data-theme='${code}']`);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  const declarations: Record<string, string> = {};
  for (const line of css.slice(open + 1, close).split('\n')) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(line);
    if (match) declarations[match[1]!] = match[2]!.trim();
  }
  return declarations;
}

/** The `data-theme` value of the rendered document element. */
function renderedThemeOf(html: string): string | null {
  return /<html[^>]*\sdata-theme="([^"]+)"/.exec(html)?.[1] ?? null;
}

/**
 * The `data-theme-requested` value, or `null` when the document does not carry
 * one — which is what a correctly configured channel renders (feature 102).
 */
function requestedThemeOf(html: string): string | null {
  return /<html[^>]*\sdata-theme-requested="([^"]+)"/.exec(html)?.[1] ?? null;
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

let calls: RecordedCall[] = [];
const originalFetch = globalThis.fetch;

/** Serves `GET /api/v1/storefront/sales-channel` with the given `themeCode`. */
function stubChannel(code: string, themeCode: string | null): void {
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const request = (init ?? {}) as { headers?: Record<string, string> };
    calls.push({ url: String(url), headers: request.headers ?? {} });
    return new Response(
      JSON.stringify({
        data: {
          code,
          name: { 'en-US': code },
          defaultLanguage: 'en-US',
          defaultCurrency: 'PLN',
          languages: ['en-US'],
          currencies: ['PLN'],
          themeCode,
          logoUrl: null,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

/**
 * Everything the buyer's browser gets, for a request the backend resolved to
 * `channelCode` with `themeCode`: the channel read, the theme decision and the
 * document element the root layout returns.
 */
async function renderForChannel(
  channelCode: string,
  themeCode: string | null,
): Promise<string> {
  stubChannel(channelCode, themeCode);
  const channel = await getPublicSalesChannel({ salesChannelCode: channelCode });
  const theme = themeForChannel(channel?.themeCode ?? null, channel?.code);
  return renderToString(
    <StorefrontDocument lang="en-US" theme={theme}>
      <div />
    </StorefrontDocument>,
  );
}

beforeEach(() => {
  calls = [];
  resetThemeWarnings();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('a channel theme reaches the storefront', () => {
  it('renders theme A tokens for one channel and theme B tokens for another', async () => {
    const industria = await renderForChannel('serwis-a', 'industria');
    const nordic = await renderForChannel('serwis-b', 'nordic');

    // 1. Each render stamps its channel's theme onto the document element.
    expect(renderedThemeOf(industria)).toBe('industria');
    expect(renderedThemeOf(nordic)).toBe('nordic');

    // 2. That attribute selects a real token block in the shipped stylesheet.
    const aTokens = themeBlock(renderedThemeOf(industria)!);
    const bTokens = themeBlock(renderedThemeOf(nordic)!);
    expect(aTokens).not.toBeNull();
    expect(bTokens).not.toBeNull();

    // 3. And the two blocks are genuinely different brands. `--brand-700` is
    //    what `@theme inline` maps `--color-accent` onto, so every accent
    //    utility on the page resolves through it; `--font-sans` and `--r-md`
    //    are the type and shape halves of the same tier.
    expect(aTokens!['--brand-700']).toBeDefined();
    expect(bTokens!['--brand-700']).toBeDefined();
    expect(aTokens!['--brand-700']).not.toBe(bTokens!['--brand-700']);
    expect(aTokens!['--font-sans']).not.toBe(bTokens!['--font-sans']);
    expect(aTokens!['--r-md']).not.toBe(bTokens!['--r-md']);
  });

  it('asks the backend which channel this is, naming the channel the proxy stamped', async () => {
    await renderForChannel('serwis-a', 'industria');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/v1/storefront/sales-channel');
    expect(calls[0]!.headers['X-Sales-Channel']).toBe('serwis-a');
  });

  it('renders the reference theme when the channel names none', async () => {
    const html = await renderForChannel('serwis-a', null);
    expect(renderedThemeOf(html)).toBe('industria');
  });

  it('renders the reference theme when the backend cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const channel = await getPublicSalesChannel({ salesChannelCode: 'serwis-a' });
    expect(channel).toBeNull();
    const html = renderToString(
      <StorefrontDocument lang="en-US" theme={themeForChannel(channel?.themeCode ?? null)}>
        <div />
      </StorefrontDocument>,
    );
    expect(renderedThemeOf(html)).toBe('industria');
  });
});

describe('an unknown theme refuses rather than guesses', () => {
  it('falls back to the reference theme and reports the code it was given', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const html = await renderForChannel('serwis-c', 'industria-pro');

    // The page renders — a buyer is not shown an error for an operator's
    // configuration — and it renders visibly as the default, not as a theme
    // whose name merely resembles the requested one.
    expect(renderedThemeOf(html)).toBe('industria');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('industria-pro');
    expect(String(warn.mock.calls[0]![0])).toContain('serwis-c');

    // And the document says so (feature 102). The mistake is made in the admin
    // and the log line appears in the storefront's container, hours later, read
    // by someone else; this puts the answer in the artefact that already
    // carries the question. It is the whole operator-facing signal while the
    // suggestion Setting is held, so it carries the *code* and not a bare
    // marker — that is what distinguishes a typo from a missing package.
    expect(requestedThemeOf(html)).toBe('industria-pro');
  });

  it('marks the document only when the request fell back', async () => {
    // Absent on every correct render, and absent when the channel names no
    // theme — which is not an unknown theme and is not reported.
    expect(requestedThemeOf(await renderForChannel('serwis-a', 'industria'))).toBeNull();
    expect(requestedThemeOf(await renderForChannel('serwis-a', null))).toBeNull();
    expect(requestedThemeOf(await renderForChannel('serwis-a', ''))).toBeNull();
  });

  it('reports each unknown code once per process, not once per page view', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderForChannel('serwis-c', 'industria-pro');
    await renderForChannel('serwis-c', 'industria-pro');
    await renderForChannel('serwis-d', 'another-missing-theme');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not report a channel that simply names no theme', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderForChannel('serwis-a', null);
    await renderForChannel('serwis-a', '');
    expect(warn).not.toHaveBeenCalled();
  });

  it('never resolves an unknown code to anything but the default', () => {
    for (const requested of ['nordic-dark', 'NORDIC', 'nordi', '../industria', '']) {
      const resolved = resolveStorefrontTheme(requested);
      expect(resolved.code).toBe('industria');
    }
  });
});

/**
 * What used to be here — *"the declared catalogue and the shipped stylesheet
 * agree"* — walked `STOREFRONT_THEME_CODES` and grepped `app/globals.css` as
 * **source text**. Both halves are gone, and its substance moved rather than
 * being dropped (feature 102, `contracts/instance-theme-registry.md` §5):
 *
 *   *ships a token block for every code the admin can offer* → `undefined-theme`
 *   *gives every theme the same set of primitives*           → `partial-theme`
 *   *declares the theme scopes above the dark scope*         → `dark-scope-shadowed`
 *
 * all three in `scripts/check-themes.mjs`, over the **emitted** stylesheet and
 * over an **open** set — so they now cover a third-party theme, a bad `exports`
 * map, a dropped `@source` glob and a purge, none of which a source scan can
 * see. `test/theme-registry.test.ts` is where they are proven red.
 *
 * What is left here is the part that needs no build and that a scaffold gets
 * wrong: the instance's own registry has to be internally coherent.
 */
describe('the theme set is this instance\'s, not the platform\'s', () => {
  it('answers membership from the generated registry, not from a code\'s shape', () => {
    // The trap this design exists to avoid: an open predicate over the code
    // regex would make every well-formed string a known theme, which deletes
    // `unknownRequest` and the fallback with it.
    for (const code of INSTANCE_THEME_CODES) expect(isStorefrontThemeCode(code)).toBe(true);
    for (const code of ['industria-pro', 'theme-x', 'nordic-dark']) {
      if ((INSTANCE_THEME_CODES as readonly string[]).includes(code)) continue;
      expect(isStorefrontThemeCode(code), `${code} is not installed here`).toBe(false);
    }
  });

  it('has a default the registry declares, so the fallback is itself renderable', () => {
    expect(INSTANCE_THEME_CODES.length).toBeGreaterThan(0);
    expect(
      (INSTANCE_THEME_CODES as readonly string[]).includes(DEFAULT_STOREFRONT_THEME_CODE),
      `DEFAULT_STOREFRONT_THEME_CODE is "${DEFAULT_STOREFRONT_THEME_CODE}", which the generated ` +
        `registry does not declare — every fallback would render unbranded.`,
    ).toBe(true);
  });

  it('renders each registered theme, and each selects a real token block', () => {
    // The open-set replacement for "ships a token block for every code the
    // admin can offer": over this instance's registry rather than over a
    // platform enum. A package-supplied theme has no block in *this* file, and
    // that is the check's population rather than this one's — `themeBlock`
    // reads the instance's own source on purpose.
    for (const code of INSTANCE_THEME_CODES) {
      expect(isStorefrontThemeCode(code)).toBe(true);
      const block = themeBlock(code);
      if (block === null) continue;
      expect(Object.keys(block).length).toBeGreaterThan(0);
    }
  });
});
