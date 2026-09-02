---
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-i18n': minor
---

`cms` and `blog` ship their admin screens, and `cms` publishes its page-builder canvas.

**Two packages' `./admin` subpath is new, and `@endora-commerce/mod-cms` gains a second UI
subpath.** Eighteen routes and seven sidebar entries between them, at the paths the
hand-written host registrations carried, plus `./admin-ui` on `cms` for the one component
another module renders. The exported symbol on `./admin` is the same one every other module
package uses — `contributions`, an `AdminContributions` object, and nothing else.

- `@endora-commerce/mod-cms` — **new `./admin` subpath**, exporting `contributions`. Eleven
  routes: `/cms` and `/cms/pages` (the landing route) on `cms.read`, `/cms/pages/:id`,
  `/cms/blocks`, `/cms/blocks/:id`, `/cms/templates`, `/cms/templates/:id` and `/cms/hooks`
  on `cms.read`, and `/cms/pages/new`, `/cms/blocks/new` and `/cms/templates/new` on
  **`cms.write`**. `/cms` is a second declaration of the page list rather than a redirect,
  because a redirect would be the consuming application's route and not this module's. Four
  sidebar rows, in the `content` section at weights 100 to 400.
- `@endora-commerce/mod-blog` — **new `./admin` subpath**, exporting `contributions`. Seven
  routes: `/blog/posts` (the landing route), `/blog/posts/:id`, `/blog/categories`,
  `/blog/categories/:id` and `/blog/tags` on `blog.read`, and `/blog/posts/new` and
  `/blog/categories/new` on **`blog.write`**. Three sidebar rows, in the `content` section at
  weights 600 to 800.

**The five create routes take the write code, and that is a behaviour change for a consumer
rendering these routes.** Each create screen exists to write — `POST /api/v1/admin/cms/pages`
and its four siblings enforce the write code — and each module's own palette action
(`new-page`, `new-post`) already advertised that code. The routes were ungated while they
belonged to the admin application, so a read-only operator could open a form whose save then
refused. The five create controls are gated on the same code in this release — the *New page*,
*New block*, *New template*, *New post* and *New category* buttons and the category tree's
*+ Child* — so the dead end is closed at both ends. `@endora-commerce/mod-sales-channels`
ships the identical split for `/sales-channels/new` and `@endora-commerce/mod-credentials` for
`/credentials/new`.

**`CategoryTreeNode` takes a new required prop.** It is not exported from any subpath, so this
affects nobody outside the package; it is recorded because the prop is `canCreate: boolean`
and required rather than optional — a caller that forgets it does not compile, which is the
direction a permission gate has to fail in.

**`@endora-commerce/mod-cms` — new `./admin-ui` subpath, exporting `PageBuilderEditor` and the
`PageBuilderData` type.** This is the Puck canvas the CMS page, block and template editors
render and that `@endora-commerce/mod-blog`'s post and category editors render too. Its props
are `data` in and `onChange` back, so the consumer decides that it appears — a published
component rather than something the owner contributes to a place of its own choosing. It is
not in `@endora-commerce/admin-kit` because it is a `@measured/puck` host and the kit is what
every module's admin layer compiles against, and not in
`@endora-commerce/page-builder-admin` because it calls this module's API client, reads this
module's translation namespace and lays the CMS page container out — that package holds the
builder chrome that names no module at all.

**`@endora-commerce/mod-blog` gains `@endora-commerce/mod-cms` as a peer dependency**, which
is what a published component costs: the reach survives into the emitted JavaScript, so a
consumer bundling `blog`'s admin layer must resolve `cms`. It is not a `dependency` — a module
reaches another through a port declared in its manifest, never through npm — and it is not
optional. A consumer that installs `@endora-commerce/mod-blog` without `@endora-commerce/mod-cms`
will fail to resolve `@endora-commerce/mod-cms/admin-ui` at bundle time. There is no runtime
half to worry about: `blog`'s module manifest already declares `cms` in its `dependencies`, so
a platform where `cms` is absent or switched off is one where `blog` cannot be activated
either.

**`@endora-commerce/mod-cms` and `@endora-commerce/mod-blog` ship new i18n keys, and
`@endora-commerce/mod-i18n` loses seven.** `nav.cmsPages.label`, `nav.cmsBlocks.label`,
`nav.cmsTemplates.label`, `nav.cmsHooks.label`, `nav.blogPosts.label`,
`nav.blogCategories.label` and `nav.blogTags.label` are in the two modules' own
`i18n/{en,pl}.json`; `appShell.nav.cmsPages`, `appShell.nav.cmsBlocks`,
`appShell.nav.cmsTemplates`, `appShell.nav.cmsHooks`, `appShell.nav.blogPosts`,
`appShell.nav.blogCategories` and `appShell.nav.blogTags` are removed from the shared bundle
in both shipped languages, nothing rendering them any more. **A consumer resolving one of
those seven keys out of the `core` namespace will get a raw key**; each has a
module-namespaced replacement above.

**Neither module declares a new palette action, and neither loses one.** `cms` has declared
`new-page` and `blog` `new-post` all along, and the admin application's own palette table
never carried a hand-written row for either — so unlike batches 10, 13 and 14 there was
nothing to convert.
