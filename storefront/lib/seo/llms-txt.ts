/**
 * `GET /llms.txt` — the decision, apart from the route file that serves it
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §5;
 * FR-024 – FR-030).
 *
 * ```text
 * <the generated base, as lib/seo/llms-txt-base.ts renders it>
 * <a blank line>
 * <the sales channel's additional content>
 * ```
 *
 * The same shape as `robots.txt`, on purpose: what this storefront can say on
 * its own, then what an operator added, joined by the one function both files
 * and the Admin UI's preview share (`composeCrawlerFile`), read through the
 * one per-process reader (`crawler-policy.ts`). Nothing here is a second cache
 * or a second rule for the join.
 *
 * A `200` is `public, max-age=60` — except when a listed page could not be
 * asked about and nothing was known about it: that file leaves the page out
 * and is sent `no-store`.
 *
 * ## Where it differs from `robots.txt`: this file can be withdrawn
 *
 * `robots.txt` is always served — a crawler must be able to read what it may
 * fetch. `llms.txt` is an invitation, and an invitation is not extended by a
 * shop that asks to be left out:
 *
 * | What is known about the channel | Served |
 * | --- | --- |
 * | it is closed to anonymous visitors | `200`, its name and that its content is for signed-in customers — nothing else |
 * | it may be indexed, and its content was read now or is remembered | `200`, the base and the content |
 * | its default robots forbids indexing | **`404`**, whatever the content holds (FR-027) |
 * | there is no such feature — `seo` is switched off, or the backend has none | **`404`** (FR-030) |
 * | nothing: the backend could not be asked and never has been | **`503`** with `Retry-After` |
 * | its default robots, or its content, is stored as something nobody can read | **`503`** with `Retry-After` |
 *
 * `?part=base` answers the base alone, `no-store`, under exactly the same
 * conditions — it is what the Admin UI's preview is built from, and a preview
 * of a file that is not served says so instead of showing one.
 *
 * ## Why "cannot tell" is a failure and never the file
 *
 * Publishing an invitation on a channel that may have been set to `noindex`
 * is the worse of the two mistakes, and a `200` with the base alone would be a
 * file that silently omits what the operator wrote (FR-022). So every way of
 * not knowing answers `503`, which a reader takes as "ask again later".
 *
 * The last row is the backend naming what it could not read rather than
 * failing its whole answer (`CrawlerFiles.unreadable`). It does that so that
 * `robots.txt`, which needs neither thing, survives a default robots row
 * holding a value nobody can interpret; this file needs both. The two
 * booleans say "do not index" in that case, but that is the safe reading of
 * an unknown, not a decision anybody took — hence "ask again later" rather
 * than "there is no such file".
 *
 * Only indexing withdraws the file. A channel that allows indexing and
 * forbids following links still has one: `nofollow` is about the links on a
 * page a crawler has fetched.
 */

import { composeCrawlerFile } from '@endora-commerce/contracts/seo';

import {
  crawlerFileGeneratedPart,
  crawlerFileHeaders,
  crawlerFileServed,
  crawlerFileServedUncached,
  crawlerFileUnavailable,
  requestChannelCode,
} from './crawler-file-response';
import {
  UNREADABLE_LLMS_TXT,
  UNREADABLE_POLICY,
  type CrawlerFiles,
  type CrawlerFilesRead,
} from './crawler-policy';
import {
  LLMS_TXT_CONDITIONAL_PAGES,
  renderClosedStoreLlmsTxt,
  renderLlmsTxtBase,
} from './llms-txt-base';

/** Which listed pages this storefront does not serve for a channel right now. */
export interface UnservedPages {
  /** Members of `LLMS_TXT_CONDITIONAL_PAGES`. */
  readonly paths: readonly string[];
  /**
   * `false` when a page could not be asked about, nothing was known about it,
   * and it was counted as unserved to be safe. A file built on such an answer
   * is served for the request in hand and may be kept by no cache.
   */
  readonly certain: boolean;
  /** Feature 171 — where a served page lives when that is not its route (the blog's prefix). */
  readonly servedAt?: Readonly<Record<string, string>>;
}

export interface LlmsTxtDeps {
  /** The channel's crawler files, through the per-process reader. Never rejects. */
  readonly readCrawlerFiles: (channelCode: string | undefined) => Promise<CrawlerFilesRead>;
  /**
   * See {@link UnservedPages}. Asked for every request: remembering the
   * answer is the reader's (`llms-txt-pages.ts`), which keeps it per channel
   * on the terms it keeps everything else. A rejection is "could not ask".
   */
  readonly readUnservedPages: (channelCode: string | undefined) => Promise<UnservedPages>;
}

/** Every page that can be absent, counted absent: the answer when none could be asked about. */
const NOTHING_CONFIRMED: UnservedPages = {
  paths: Object.keys(LLMS_TXT_CONDITIONAL_PAGES),
  certain: false,
};

/**
 * The file composed for a configuration, kept for as long as the reader holds
 * that configuration — as `robots-txt.ts` keeps its own, and for the same
 * reasons. The base is kept beside it and compared, not assumed: which pages
 * are served can change under a configuration that has not.
 */
const composed = new WeakMap<CrawlerFiles, { base: string; body: string }>();

function fileFor(base: string, configuration: CrawlerFiles): string {
  const kept = composed.get(configuration);
  if (kept !== undefined && kept.base === base) return kept.body;
  const body = composeCrawlerFile(base, configuration.llmsTxtAdditional);
  composed.set(configuration, { base, body });
  return body;
}

function notFound(): Response {
  // `no-store`: a file that has been withdrawn must be seen withdrawn, and one
  // that has been allowed again must be seen back, without waiting on a cache.
  return new Response('Not found.\n', { status: 404, headers: crawlerFileHeaders('no-store') });
}

export async function llmsTxtResponse(request: Request, deps: LlmsTxtDeps): Promise<Response> {
  const channelCode = requestChannelCode(request);
  const read = await deps.readCrawlerFiles(channelCode);

  if (read.kind === 'unknown') return crawlerFileUnavailable('llms.txt');
  if (read.kind === 'none') return notFound();

  const configuration = read.value;

  // A store closed to anonymous visitors: a file that names it and lists
  // nothing, served whatever the policy and the operator's content say —
  // neither is read for it, so neither being unreadable withholds it.
  if (configuration.anonymousAccess === false) {
    const closed = renderClosedStoreLlmsTxt(configuration.shop.name);
    return new URL(request.url).searchParams.get('part') === 'base'
      ? crawlerFileGeneratedPart(closed)
      : crawlerFileServed(closed);
  }

  const unreadable = configuration.unreadable ?? [];
  if (unreadable.includes(UNREADABLE_POLICY) || unreadable.includes(UNREADABLE_LLMS_TXT)) {
    return crawlerFileUnavailable('llms.txt');
  }
  if (!configuration.index) return notFound();

  const unserved = await deps.readUnservedPages(channelCode).catch(() => NOTHING_CONFIRMED);

  // The origin in the addresses is the deployment's one public origin — fixed
  // when the storefront is built, the same for every sales channel, as in the
  // sitemap. What varies per channel is the shop's name and the pages.
  const base = renderLlmsTxtBase({
    shopName: configuration.shop.name,
    unservedPaths: unserved.paths,
    servedAt: unserved.servedAt,
  });

  if (new URL(request.url).searchParams.get('part') === 'base') {
    return crawlerFileGeneratedPart(base);
  }

  const body = fileFor(base, configuration);
  // Built without knowing whether a listed page exists: the page is left out,
  // and the answer is this request's alone — the next one may know.
  return unserved.certain ? crawlerFileServed(body) : crawlerFileServedUncached(body);
}
