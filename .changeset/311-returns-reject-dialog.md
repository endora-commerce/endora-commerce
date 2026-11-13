---
'@endora-commerce/mod-returns': patch
---

The return detail screen's **Reject** action asks for the rejection reason in a dialog instead of
the browser's `window.prompt()` (issue #311). The reason is a required, multi-line field: an empty
or whitespace-only reason, or one over 2000 characters, is refused in the dialog before anything is
sent, and the reason is sent trimmed. **Reject** is destructive and shows a busy state while the
request runs; an error from the server is shown in the dialog with the reason kept. Cancel and
Escape close the dialog and return focus to **Reject**. Every string is in the `returns` bundle in
English and Polish. No API change.
