import { describe, expect, it, vi } from 'vitest';

/**
 * Issue #85 — a CMS address that does not resolve answers 404, and its `<title>`
 * was the English "Not found" on every shop. It is the page language's now.
 */
const state = { locale: 'en-US' };

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    ctx: { locale: state.locale },
    locale: state.locale,
    urlState: { languages: [], aliases: [], current: state.locale },
  }),
}));
vi.mock('../../lib/api/cms', () => ({
  getCmsPageBySlug: async () => null,
  normalizeCmsUrlPath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));

const { generateMetadata } = await import('../../app/(content)/[...slug]/page');

async function title(locale: string): Promise<unknown> {
  state.locale = locale;
  return (await generateMetadata({ params: Promise.resolve({ slug: ['missing'] }) })).title;
}

describe('the title of a CMS page that does not resolve', () => {
  it('is English on an English shop and Polish on a Polish one', async () => {
    expect(await title('en-US')).toBe('Not found');
    expect(await title('pl-PL')).toBe('Nie znaleziono');
  });
});
