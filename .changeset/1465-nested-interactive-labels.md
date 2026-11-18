---
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-prompt-actions': patch
'@endora-commerce/admin-shell': patch
---

Content screens no longer nest a button inside a link, and their labels now name their fields (issue #1465).

- **Newsletter**: *Export CSV*, *New campaign*, *New automation* and the campaign's *Stats* are each one link styled as a button (`<Button asChild>`), not a button inside a link. Before, each took two tab stops.
- **CMS page, block and template editors** and the **megamenu editor**: Name, Slug, Code, Status and Description are wired through `FormField`. The page's public address describes its slug field.
- **Megamenu item editor**: the URL, link target, variant, asset type, embed side and root category fields are tied to their labels. The per-language labels form a group, and each input is named by the group and its language.
- **PWA**: the colour captions no longer appear as labels for nothing, and the push audience choice is a radio group named "Audience".
- **Search boxes** on the CMS pages list, the blog post and tag lists and the transactional e-mails list are search fields with a translated name (EN + PL). Before, only a placeholder named them. The e-mails list placeholder now comes from the bundle.
- **Prompt actions panel**: the instruction input has a name ("Instruction" / "Polecenie"). The busy line now sits in a status region that is mounted before it has text, so screen readers announce it.

A structural admin test now rejects a button nested in a link, or a link nested in a button, anywhere in the admin sources.
