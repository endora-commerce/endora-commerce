---
'@endora-commerce/page-builder-admin': patch
---

The e-mail editor preview shows the sample Unsubscribe link for newsletter templates only (issue #862). Since #861, a transactional e-mail is sent without the link, but `EmailEditorPane` still supplied a sample `unsubscribeUrl` for every template. It now supplies it only when `builderContext` is `'newsletter'`, in the HTML preview and in the canvas previews of embedded blocks. The newsletter preview is unchanged.

`previewNode(content, builderContext?)` takes the editor's context as an optional second argument. It defaults to `'email'`, so a call without it draws no sample Unsubscribe link. Pass `'newsletter'` to keep the link in a newsletter canvas.
