---
'@endora-commerce/mod-cms': patch
---

The Brand screen (`/cms/brand`) is one card of sections beside the preview card, instead of nine cards with boxes three borders deep (issue #1514, UX audit 2026-11-17, CONTENT-14; DS-03). *Scope*, *Colours*, *Colour schemes*, *Typography*, *Buttons*, *Spacing* and *Layout* are sections of the one form card, separated by a rule. The light, muted and dark schemes are rows divided by a rule rather than a bordered box each; the heading and body fonts are no longer bordered, and each font file is a plain row in a divided list. An overridden channel's notice is a line beside its badge, like the other two channel states, rather than a banner inside the card. The scope picker, the override and reset actions, the one Save and what is stored are unchanged. No translation keys change.
