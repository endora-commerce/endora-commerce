---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-blog': minor
---

**Behaviour break — operators, read before upgrading:** a blog post or category is now served only in
the languages assigned to it (feature 171, US3). Requested in another language it answers 404, and no
list in that language shows it. Until now a post written in one language was served under every
language's URL. Before upgrading, list the published posts assigned to a language they are not
written in (`specs/171-blog-i18n-authors/quickstart.md` §4) and either write them or unassign the
language. A category assigned no language (the seeded `Default`) is in every one.

Publishing a post, and saving a published one, is refused with `422 BLOG_LANGUAGE_INCOMPLETE` when an
assigned language has no name — or no content, once the post has content in any language; a category
needs a name in each of its languages on every save. Drafts may be incomplete.

Posts and categories get a **URL key per language** (US4): `GET`/`PUT
/api/v1/admin/blog/{posts|categories}/:id/url-keys`, `DELETE …/url-redirects/:redirectId`. A key
resolves only in its own language and is unique per sales channel and language across posts and
categories (`409 BLOG_URL_KEY_TAKEN`). A replaced key, the base slug of a keyed language and a changed
base slug redirect (while `seo` is present); taking over another entry's redirect needs
`confirmTakeover` (`409 BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED`). `GET /api/v1/blog/by-slug` answers
`{ kind: 'redirect', path, permanent: true }` for those, and a post's and category's answers carry
`alternates` per language for `hreflang` and the language switcher.

A blog prefix per language (US5): the setting `blog.url_prefix_by_language` (`{ "<language>":
"<prefix>" }`), judged like `blog.url_prefix`; `GET /api/v1/blog/routing` answers it per language.
The admin gains **Blog → Addresses** (current and former prefixes per channel; palette action `open-blog-addresses`) and an **Address** card
in the post and category editors.

`@endora-commerce/contracts`: `blogUrlKeysResponseSchema`, `putBlogUrlKeysRequestSchema`,
`blogAlternatesSchema`, `blogRedirectResolutionSchema` (a new member of `blogBySlugResponseSchema`),
`BLOG_SETTING_CODES.URL_PREFIX_BY_LANGUAGE`, and the error codes `BLOG_LANGUAGE_INCOMPLETE`,
`BLOG_URL_KEY_TAKEN`, `BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED`, `BLOG_URL_REDIRECT_NOT_FOUND`. A
consumer switching over `kind` must handle `'redirect'`.
