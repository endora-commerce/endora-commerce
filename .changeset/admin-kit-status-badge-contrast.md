---
'@endora-commerce/admin-kit': patch
---

`readableTextColor` — and so `statusBadgeStyle` — picks the text colour by contrast ratio.

It chose white or dark grey by a brightness threshold, which put white text on the mid-tones an
operator actually picks for a status — amber, green, blue — at 2:1 to 3.7:1. It now answers
whichever of `#000000` and `#ffffff` has the higher WCAG contrast against the background,
which is at least 4.58:1 on any colour (SC 1.4.3 asks for 4.5:1).

**What changes on screen:** a status or tag badge on a mid-tone colour shows black text where
it showed white, on every screen that uses the helper — order statuses and return statuses
included. The dark text is `#000000` where it was `#1f2937`. Signatures are unchanged.
