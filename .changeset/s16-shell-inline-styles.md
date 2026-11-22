---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

The admin shell draws its frame, top bar, notification bell, language picker, sign-in screen and boot skeleton with the kit's primitives and Tailwind tokens instead of inline styles (UX audit, issue #1492):

- The notification bell and the language menu use the theme's surface, border and accent tokens, so they follow dark mode and a client's palette. The unread pill and the unread-row bar were fixed red and blue; they are now the destructive and primary colours.
- The bell's name includes the unread count ("Notifications, 3 unread"), and an unread entry says so to a screen reader instead of relying on its colour bar and weight. *Mark all read* is a kit ghost button, and entries highlight on hover and keyboard focus.
- An entry's age is written in the reader's language ("5 min temu" in Polish) instead of always in English.
- Breadcrumb links in the top bar take the theme's hover colour and underline, which the inline style suppressed. The wordmark in the sidebar is drawn in the theme's white.
- Command-palette notes ("Searching…", an unavailable record group) no longer show a pointer cursor.
