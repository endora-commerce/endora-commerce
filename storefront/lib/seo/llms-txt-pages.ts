import { PROCESS_READER_DEPS, createChannelCache, type CrawlerRead } from './crawler-policy';
import { LLMS_TXT_CONDITIONAL_PAGES, type LlmsTxtConditionalPath } from './llms-txt-base';
import type { UnservedPages } from './llms-txt';

/**
 * Which of the pages `llms.txt` lists this storefront does not serve for a
 * sales channel right now (`llms-txt-base.ts`, `LLMS_TXT_CONDITIONAL_PAGES`).
 *
 * ## Each page is asked about the way the page asks about itself
 *
 * `/blog` renders "not found" exactly when the backend's blog index for the
 * channel answers `404` — the channel has no blog — or `503` `MODULE_DISABLED`
 * — the `blog` module is switched off. The same endpoint is the question here,
 * read the same way, so the file and the page cannot disagree. Module presence
 * alone would not do: a channel can have no blog while the module is on.
 *
 * ## `/llms.txt` is a public address, so the answer is remembered
 *
 * Asking the file must not be a way of asking the backend. The answer is held
 * by the cache the reader holds a channel's robots policy and crawler files
 * in (`createChannelCache`, `crawler-policy.ts`), as a third question — the
 * same rules, and no rules of its own:
 *
 *  * one request per channel per minute, and requests arriving together share
 *    it;
 *  * a stale answer is refreshed on the request that finds it stale, which
 *    waits a fraction of a second for it and is otherwise served what was
 *    known — a backend that does not answer is not felt once something is
 *    known;
 *  * while the backend cannot be asked, it is asked again no more than once
 *    per back-off, and what was known stands, however old;
 *  * a read is given a deadline and is aborted at it;
 *  * the number of channels held is bounded.
 *
 * What is left is a channel nothing is known about while the backend cannot
 * be asked: the page is then counted as **not served** and the answer marked
 * uncertain. Leaving a link out for a moment is the cheaper mistake;
 * `llms-txt.ts` does not let a cache keep a file built on it.
 */

/** The backend route whose answer decides whether `/blog` is a page. */
export const BLOG_INDEX_PATH = '/api/v1/blog/by-channel';

/**
 * Where the blog index is served, from its `200` body: under the operator's prefix
 * (feature 171), or at the storefront's own `/blog` when the body names none.
 * `null` for a body that is not one.
 */
export function blogServedAt(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const prefix = ((body as { data?: { urlPrefix?: unknown } }).data ?? {}).urlPrefix;
  return typeof prefix === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(prefix) ? `/${prefix}` : '/blog';
}

/**
 * One cache per condition, keyed by the name `LLMS_TXT_CONDITIONAL_PAGES`
 * gives it. A `200` is "served", and its value is the address the page is
 * served at.
 */
const CONDITIONS: Readonly<
  Record<
    (typeof LLMS_TXT_CONDITIONAL_PAGES)[LlmsTxtConditionalPath],
    (channelCode: string | undefined) => Promise<CrawlerRead<string>>
  >
> = {
  blog: createChannelCache<string>(PROCESS_READER_DEPS, {
    path: BLOG_INDEX_PATH,
    parse: blogServedAt,
  }).read,
};

/** Never rejects: the caches turn every failure into an answer. */
export async function readUnservedPages(channelCode: string | undefined): Promise<UnservedPages> {
  const paths: string[] = [];
  const servedAt: Record<string, string> = {};
  let certain = true;
  await Promise.all(
    (Object.keys(LLMS_TXT_CONDITIONAL_PAGES) as LlmsTxtConditionalPath[]).map(async (path) => {
      const read = await CONDITIONS[LLMS_TXT_CONDITIONAL_PAGES[path]](channelCode);
      if (read.kind === 'value') {
        if (read.value !== path) servedAt[path] = read.value;
        return;
      }
      paths.push(path);
      // "Could not ask, and nothing was ever known."
      if (read.kind === 'unknown') certain = false;
    }),
  );
  return { paths, certain, servedAt };
}
