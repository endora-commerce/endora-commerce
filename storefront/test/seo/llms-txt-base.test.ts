import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SITEMAP_STATIC_ROUTES } from '../../app/sitemap';
import {
  LLMS_TXT_CONDITIONAL_PAGES,
  LLMS_TXT_PAGE_TITLES,
  renderLlmsTxtBase,
} from '../../lib/seo/llms-txt-base';
import { ROBOTS_SYSTEM_RULES } from '../../lib/seo/robots-system-rules';

/**
 * The generated part of `llms.txt`
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §5; FR-025).
 *
 * It names the shop and lists where its public content starts. Two things are
 * held about the list, and they are the two the requirement is made of:
 *
 *  * **only addresses that are public and indexable.** The list is
 *    `SITEMAP_STATIC_ROUTES` — the storefront's own hand-written statement of
 *    exactly that, already reconciled against the route tree by
 *    `check:storefront-indexability` — and nothing else is ever added to it;
 *  * **no address from a family closed to crawlers.** Asserted against the
 *    list `robots-system-rules.ts` owns, not against a copy of it, so a family
 *    closed there tomorrow is a family this file may not name tomorrow.
 */

const ORIGIN_KEYS = ['NEXT_PUBLIC_SITE_URL', 'STOREFRONT_URL'] as const;
const ORIGINAL = ORIGIN_KEYS.map((key) => [key, process.env[key]] as const);

beforeEach(() => {
  process.env['NEXT_PUBLIC_SITE_URL'] = 'https://shop.example';
});

afterEach(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Every address the text links to, in order. */
function linkedAddresses(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] as string);
}

/** Whether `pathname` falls in a family the system rules close. */
function isClosedToCrawlers(pathname: string): boolean {
  return ROBOTS_SYSTEM_RULES.disallow.some((prefix) => pathname.startsWith(prefix));
}

describe('the generated llms.txt base', () => {
  it('is the shop, its pages and its sitemap, in that order', () => {
    expect(renderLlmsTxtBase({ shopName: 'Endora Demo', unservedPaths: [] })).toBe(
      [
        '# Endora Demo',
        '',
        '## Pages',
        '',
        '- [Home](https://shop.example/)',
        '- [Catalog](https://shop.example/catalog)',
        '- [Search](https://shop.example/search)',
        '- [Blog](https://shop.example/blog)',
        '- [Contact](https://shop.example/kontakt)',
        '',
        '## Sitemap',
        '',
        '- [Sitemap](https://shop.example/sitemap.xml)',
        '',
      ].join('\n'),
    );
  });

  it('lists one line per static sitemap route, with an absolute address, and nothing else', () => {
    const base = renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: [] });
    expect(linkedAddresses(base)).toEqual([
      ...SITEMAP_STATIC_ROUTES.map((path) => `https://shop.example${path}`),
      'https://shop.example/sitemap.xml',
    ]);
  });

  it('has a title for every static sitemap route — a route added there is named here', () => {
    // Without one the line would still be written, titled with its path; this
    // is what makes adding a static route a decision about this file too.
    for (const path of SITEMAP_STATIC_ROUTES) {
      expect(LLMS_TXT_PAGE_TITLES[path], path).toEqual(expect.stringMatching(/\S/));
    }
    expect(Object.keys(LLMS_TXT_PAGE_TITLES).sort()).toEqual([...SITEMAP_STATIC_ROUTES].sort());
  });

  it('names the deployment’s one origin — whatever `siteUrl()` answers — in every address', () => {
    // In a built storefront that origin is fixed by the build and is the same
    // for every sales channel, as in the sitemap.
    process.env['NEXT_PUBLIC_SITE_URL'] = 'https://other.example:8443';
    expect(linkedAddresses(renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: [] }))).toEqual([
      ...SITEMAP_STATIC_ROUTES.map((path) => `https://other.example:8443${path}`),
      'https://other.example:8443/sitemap.xml',
    ]);
  });

  it('ends with exactly one line break and uses line feeds only', () => {
    const base = renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: [] });
    expect(base.endsWith(')\n')).toBe(true);
    expect(base.endsWith('\n\n')).toBe(false);
    expect(base).not.toContain('\r');
  });
});

describe('the generated llms.txt base — no address closed to crawlers (FR-025)', () => {
  it('names no address from a family the system rules close', () => {
    const base = renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: [] });
    const addresses = linkedAddresses(base);
    expect(addresses.length).toBeGreaterThan(1);
    for (const address of addresses) {
      const { pathname } = new URL(address);
      expect(isClosedToCrawlers(pathname), `${pathname} is closed to crawlers`).toBe(false);
    }
  });

  it('would be caught naming one: the rule list is the one robots.txt is rendered from', () => {
    // The control for the case above — the predicate does refuse what the
    // rules close, including a path below a closed prefix.
    expect(ROBOTS_SYSTEM_RULES.disallow.length).toBeGreaterThan(10);
    for (const closed of ['/account', '/cart', '/checkout', '/login', '/api/x', '/account/orders']) {
      expect(isClosedToCrawlers(closed), closed).toBe(true);
    }
    for (const prefix of ROBOTS_SYSTEM_RULES.disallow) {
      expect(SITEMAP_STATIC_ROUTES.some((path) => path.startsWith(prefix)), prefix).toBe(false);
    }
  });

  it('keeps that true whatever the shop is called', () => {
    // The name is the operator's text, on the heading line and nowhere else:
    // it cannot become a list entry.
    const base = renderLlmsTxtBase({
      shopName: 'Shop\n- [Account](https://shop.example/account)\r\n## Pages',
      unservedPaths: [],
    });
    const [heading, ...rest] = base.split('\n');
    expect(heading).toBe('# Shop - [Account](https://shop.example/account) ## Pages');
    expect(linkedAddresses(rest.join('\n')).map((address) => new URL(address).pathname)).toEqual([
      ...SITEMAP_STATIC_ROUTES,
      '/sitemap.xml',
    ]);
  });
});

describe('the generated llms.txt base — the shop’s name', () => {
  it('falls back to the site’s host when the shop has no name', () => {
    for (const shopName of ['', '   ', '\n\t']) {
      expect(renderLlmsTxtBase({ shopName, unservedPaths: [] }).split('\n')[0]).toBe(
        '# shop.example',
      );
    }
    process.env['NEXT_PUBLIC_SITE_URL'] = 'http://localhost:3000';
    expect(renderLlmsTxtBase({ shopName: '', unservedPaths: [] }).split('\n')[0]).toBe(
      '# localhost:3000',
    );
  });

  it('is one line: surrounding whitespace goes, and every run of whitespace inside is one space', () => {
    expect(
      renderLlmsTxtBase({ shopName: '  Endora \t Demo\r\nPolska  ', unservedPaths: [] }).split('\n')[0],
    ).toBe('# Endora Demo Polska');
  });

  it('carries no control character and no direction override into the heading', () => {
    // C0 and C1 controls, and the characters that reorder what follows them
    // on screen: a name must not be able to make the heading — or the lines
    // after it — read as something they are not.
    const hostile =
      'En\u0000do\u0007ra\u001B[31m \u202Eomed\u202C \u2066x\u2069\u0085\u009F\u007F \u202A\u202B\u202D\u2067\u2068y';
    const heading = renderLlmsTxtBase({ shopName: hostile, unservedPaths: [] }).split('\n')[0];
    expect(heading).toBe('# Endora[31m omed x y');
    expect(heading).not.toMatch(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/);
  });

  it('falls back to the host when the name is made of such characters alone', () => {
    expect(
      renderLlmsTxtBase({ shopName: '\u202E\u0000\u2066 \u009F', unservedPaths: [] }).split('\n')[0],
    ).toBe('# shop.example');
  });

  it('takes a name made to be slow no longer than any other', () => {
    const shopName = `${' \n'.repeat(200_000)}x${' '.repeat(200_000)}`;
    const start = performance.now();
    const heading = renderLlmsTxtBase({ shopName, unservedPaths: [] }).split('\n')[0];
    expect(performance.now() - start).toBeLessThan(250);
    expect(heading).toBe('# x');
  });
});

describe('the generated llms.txt base — a page this storefront does not serve right now', () => {
  it('is left out, and the rest is unchanged', () => {
    const all = renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: [] });
    const withoutBlog = renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: ['/blog'] });
    expect(withoutBlog).toBe(all.replace('- [Blog](https://shop.example/blog)\n', ''));
    expect(withoutBlog).not.toContain('/blog');
  });

  it('can only ever remove: a path outside the list adds nothing and removes nothing', () => {
    const all = renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: [] });
    expect(renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: ['/account', '/nope'] })).toBe(all);
  });

  it('leaves out only a page declared conditional — never the home page, another page or the sitemap', () => {
    const base = renderLlmsTxtBase({
      shopName: 'Shop',
      unservedPaths: [...SITEMAP_STATIC_ROUTES, '/sitemap.xml'],
    });
    expect(linkedAddresses(base)).toEqual([
      ...SITEMAP_STATIC_ROUTES.filter(
        (path) => !Object.hasOwn(LLMS_TXT_CONDITIONAL_PAGES, path),
      ).map((path) => `https://shop.example${path}`),
      'https://shop.example/sitemap.xml',
    ]);
    expect(base).toContain('- [Home](https://shop.example/)');
  });

  it('declares which pages can be absent, and each of them is a static sitemap route', () => {
    // Today: the blog, which answers "not found" while its module is off or
    // while the channel has no blog. Every other listed page is served by
    // this storefront unconditionally.
    expect(Object.keys(LLMS_TXT_CONDITIONAL_PAGES)).toEqual(['/blog']);
    for (const path of Object.keys(LLMS_TXT_CONDITIONAL_PAGES)) {
      expect(SITEMAP_STATIC_ROUTES).toContain(path);
      expect(path).not.toBe('/');
    }
  });
});

describe('the generated llms.txt base — a page served under another address (feature 171)', () => {
  it('links the blog where the operator put it, under its own title', () => {
    process.env['NEXT_PUBLIC_SITE_URL'] = 'https://shop.example';
    const base = renderLlmsTxtBase({ shopName: 'Shop', unservedPaths: [], servedAt: { '/blog': '/aktualnosci' } });
    expect(base).toContain('- [Blog](https://shop.example/aktualnosci)');
    expect(linkedAddresses(base)).not.toContain('https://shop.example/blog');
  });
});
