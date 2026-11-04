# Quickstart: verifying feature 171 locally

Prerequisites: `pnpm run build:packages`, the pending migrations applied
(`pnpm --filter backend exec tsx --env-file-if-exists=.env src/db/migrate.ts up`), backend :3001,
admin :3002, storefront :3000. Two channels exist; the examples use `pl_retail` with Polish (default)
and English, 167's "prefix the default language" on.

## 1. Prefix (US1, US5)

1. Admin → Settings → Blog, channel `pl_retail`. Set the URL prefix to `aktualnosci`, and the
   per-language prefix for `en` to `news`.
2. Expect each of these to answer as described:

   ```bash
   curl -sI localhost:3000/pl/aktualnosci                     # 200
   curl -sI localhost:3000/pl/blog/<post-slug>                 # 301 → /pl/aktualnosci/<post-slug>
   curl -sI localhost:3000/en/news                             # 200
   curl -s  localhost:3000/sitemap.xml | grep -c '/blog/'      # 0
   ```
3. Change `aktualnosci` to `wiadomosci`. Then:
   - `/pl/aktualnosci/<post>` is a 301 to `/pl/wiadomosci/<post>`, while `seo` is on.
   - Admin → Blog settings lists `aktualnosci` as a former prefix.
4. Try the prefix `en` or `p` for a channel. The save is refused, naming the conflict.
5. Try to create a CMS page slugged `wiadomosci/x`. It is refused with `CMS_SLUG_RESERVED`.

## 2. Pagination (US2)

```bash
curl -s 'localhost:3001/api/v1/blog/posts?page=2&perPage=5' -H 'x-sales-channel: pl_retail' | jq .pagination
curl -s 'localhost:3001/api/v1/blog/posts?limit=3' -H 'x-sales-channel: pl_retail' | jq '.data|length'   # 3, as before
```

Open `/pl/aktualnosci?page=2`. It shows no category tiles. Then open `?page=999`, which is a 404.

## 3. Language existence and keys (US3, US4)

1. Create a post, assign it to Polish only, and publish it. `/en/news/<slug>` → 404, and the
   English index does not list it.
2. Assign English, but leave the English content empty, then publish. The publish is refused with
   `BLOG_LANGUAGE_INCOMPLETE`.
3. Add the English content. In the English tab, set the URL key `how-to-choose-a-drill`.
   - `/en/news/how-to-choose-a-drill` → 200.
   - `/en/news/<polish-slug>` → 301 to it.
   - The Polish page's `<link rel="alternate" hreflang="en">` points at it.
4. Rename the English key. The former key answers 301, and the post's URL-keys panel lists it as a
   redirect.
5. Give another post the same English key. The save is refused with `BLOG_URL_KEY_TAKEN`. Give it the
   former key instead: you are asked to confirm the takeover, then it saves.

## 4. Data check before deploy (US3)

These are the published posts that will vanish from a language they are assigned to but not written
in:

```sql
select p.id, p.slug, l.language
  from blog_posts p
  join blog_post_languages l on l.blog_post_id = p.id
 where p.deleted_at is null and p.status = 'published'
   and (coalesce(p.name ->> l.language, '') = ''
        or p.content -> 'languages' -> l.language is null);
```

## 5. Authors (US6, US7)

1. Profile page:
   - Pick an avatar.
   - Write a Polish and an English biography.
   - Save, then reload.
2. Sign in as an editor who holds only the blog role. In the post editor, pick yourself as the
   author.
   - The picker shows names and avatars only.
   - `GET /api/v1/admin/blog/author-candidates` contains no `email`.
3. Open the post on the storefront.
   - The author's name, avatar and biography in the page language are shown.
   - The JSON-LD has `"author": {"@type": "Person", …}`.
4. Deactivate the administrator. The author is still shown. Delete the administrator. The author
   disappears, and the editor shows "author deleted".
5. Try to delete the avatar asset in the library. It is reported as in use by the administrator's
   profile.

## 6. Off-state

Switch the blog off in Platform → Modules.
- `/pl/wiadomosci`, `/pl/blog` and every former URL answer as for an absent module.
- `GET /api/v1/blog/routing` answers `MODULE_DISABLED`.
- The profile's avatar and biography fields remain.
