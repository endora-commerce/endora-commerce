# Contract: Blog paths, storefront routing and the prefix settings

## 1. `blogPath` (`packages/contracts/src/blog.ts`)

```ts
type BlogView =
  | { view: 'index'; page?: number }
  | { view: 'entry'; key: string; page?: number }   // post or category — one URL space
  | { view: 'tag'; code: string; page?: number };

function blogPath(input: BlogView & {
  languageCode: string;
  channel: ChannelUrlFacts;      // 167's facts: languages, prefixDefaultLanguage, aliases
  prefix: string;                // effective blog prefix at (channel, language)
}): string;

function blogDefaultPath(input: BlogView & { prefix: string }): string;   // unprefixed, for x-default
```

- **Building the path:** `storefrontPagePath({ path, languageCode, channel })` builds the result from:
  - `path = '/' + prefix + ('/' + encodeURIComponent(key) | '/tag/' + code | '')`;
  - `?page=N` when N ≥ 2. `page = 1` emits no parameter (canonical).
- **Errors:** it throws on a language the channel does not have, as `productPath` does.
- **Callers:** it is the only builder of blog URLs. The backend resolver, the sitemap and `llms.txt`
  go through it, the latter two via payload URLs.

## 2. Storefront middleware (`storefront/middleware.ts`)

A new step runs after the 167 locale parse and before the language header is set.

```text
routing = blogRoutingCache.read(channelCode)       // GET /api/v1/blog/routing, 60 s, never rejects
if routing is null → unchanged
lang    = parsed.languageCode
current = routing.prefixes[lang] ?? routing.defaultPrefix
[first, ...rest] = segments(parsed.logicalPath)

first == current && current != 'blog'      → rewrite to '/blog/' + rest   (x-pathname = public logical path)
first == 'blog'  && current != 'blog'      → 301 localizePath('/' + current + '/' + rest, lang)
first == another language's current prefix
      or routing.defaultPrefix              → 301 localizePath('/' + current + '/' + rest, lang)
first ∈ routing.formerPrefixes[lang|null]  → 301 localizePath('/' + current + '/' + rest, lang)
otherwise                                  → unchanged
```

- **Query string:** preserved on rewrite and redirect. A 301 carries `Cache-Control: public,
  max-age=3600`, as 167's 308 does: an operator can change the prefix.
- **No private headers** *(amended during S1)*. The rewrite keeps 167's `x-pathname`, which then
  holds the public logical path (`/aktualnosci/…`). The page takes its canonical and alternates from
  the payload's `url`, with the language prefix stripped, so it needs nothing from the middleware.
- **Language-neutral paths** (files) are untouched.

## 3. Storefront blog page (`storefront/app/blog/[[...slug]]/page.tsx`)

- **Payload URLs only.**
  - Links, breadcrumbs, `Pagination` base paths and the JSON-LD URL come from the payload's `url`
    fields.
  - `canonicalPath(seo.route)` and the six `BLOG_PREFIX` constants are removed.
  - `LatestPosts` keeps its fallback but receives `url`.
- **Metadata `alternates`:** taken from the payload's `alternates`. The switcher reads them from
  `<link rel="alternate" hreflang>`, which 167 already supports.
- **Redirect answer:** a `redirect` resolution calls `permanentRedirect(path)` and sets `noindex`
  metadata, as the product page does.
- **Pagination:**
  - `?page=N` past `totalPages` → `notFound()`.
  - `?page=1` → canonical without the parameter.
- **Module off:** `getBlogBySlug` / `getBlogTagByCode` also map `isModuleDisabled` to `null`.
  Today they rethrow it.

## 4. Settings validator (blog boot hook)

The validator is registered with `SettingWriteValidatorRegistryPort`:
`{ contributorModuleId: 'blog', codes: ['blog.url_prefix', 'blog.url_prefix_by_language'], validate }`.

**What `validate` checks,** for each targeted channel, on the post-write projection:

1. **Shape.**
   - `url_prefix` must match `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` → else 400 `BLOG_URL_PREFIX_INVALID`.
   - `url_prefix_by_language` must be a JSON object whose keys are language codes of the channel
     and whose values have the same shape → else 400 `BLOG_URL_PREFIX_INVALID`.
2. **Reserved segments.** Every effective prefix must stay out of `BLOG_RESERVED_URL_PREFIXES` ∪
   `cms.reserved_slug_segments` → else 409 `BLOG_URL_PREFIX_RESERVED`. The reserved segments now
   include `tag`, `author` and `blog`, except for `blog` itself as a value.
3. **Language prefixes.** No effective prefix may equal a language prefix of any channel → else 409
   `BLOG_URL_PREFIX_CONFLICT`.
4. **CMS pages.** No effective prefix may equal the first slug segment of a CMS page in the channel
   → else 409 `BLOG_URL_PREFIX_CONFLICT`. This is checked through `cmsPageReadPort`'s new
   `firstSegmentsInChannel(salesChannelId)`.

**On change:** the `settings.value_changed` subscriber maintains `blog_url_prefixes` (data-model
§1.3) and calls `invalidateAll()`.

## 5. CMS reserved-segment contribution

```ts
interface CmsReservedSegmentContributor {
  contributorModuleId: string;
  segmentsFor(salesChannelId: string): Promise<string[]>;   // lower-case first segments
}
cmsReservedSegmentRegistry.register(contributor): void
```

- **Who contributes:** the blog, with every current and former prefix of the channel, other than
  `blog` (already in the storefront reserved list).
- **Refusal:** `assertSlugNotReserved` refuses a page whose first segment a contributor claims for
  any of the page's channels, with 409 `CMS_SLUG_RESERVED` `{ segment, claimedBy: 'blog' }`.
- **Page list:** marks such a page "shadowed".
- **Module off:** a contributor whose module is off is skipped.
