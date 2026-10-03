---
'@endora-commerce/admin-kit': patch
---

`ScopePicker` (`@endora-commerce/admin-kit/components`) no longer rewrites the scope it was given
while the selected sales channels' languages are still loading. Until each channel's details
arrived it treated the channel's default language as the channel's only language and pruned the
value against that through `onChange`, so content whose only language was not the channel
default opened with no language checked (and, in the CMS and blog editors, an empty canvas), and
content scoped to the default **and** another language silently lost the other one — which the
next save then stored.

The picker now waits for every selected channel's details before it offers languages, and says
it is loading meanwhile instead of showing an empty selection. It never calls `onChange` on its
own: a stored language that the selected channels no longer offer stays listed and checked, and
the operator is the one who removes it. Unchecking a channel still prunes the languages only
that channel offered, as before. If a channel's details cannot be read, the error is shown and
the stored languages stay as they are.

Content saved through an affected editor before this fix may have had its language list
shortened. The per-language data itself was kept — CMS pages, blocks and templates and blog posts
store a narrower language list without deleting `content.languages[<code>]`, and blog categories
keep their per-language names — so an item whose stored per-language data holds a language its
language list does not is a candidate to review and re-scope.
