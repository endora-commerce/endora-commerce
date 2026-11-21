---
'@endora-commerce/mod-document-templates': patch
---

The document-template screens follow the admin's shared patterns (issues #1532 and #1535, UX audit CONTENT-12 and CONTENT-18).

*Document templates* is a kit list page. It has one *New template* button in the header, and the document type is the first field of its dialog. The type is preselected from `?type=` or the first type, and is not asked when only one type is available. The per-type cards, each with its own filled *New template*, are replaced by a section per type with one table. The table's *Applies to* column replaces the scope sub-headings. A template's name is the link to its editor. *Duplicate…*, *Set as default* / *Clear default* and *Delete* are in the row's action menu, and *Delete* is last, apart from the others and confirmed. The built-in layout's row has *Preview PDF* and *Create from this* in its menu. The result of an action appears beside the header's button instead of in a banner.

The editor is laid out in `PageBuilderEditorLayout`, like the CMS, blog and e-mail editors. There is no card around the canvas, and the language and merge fields are on the row above it, without a border of their own. Save is the shared split button with *Save and exit*. "Saved" and the default change appear beside it. The *Default* badge is next to the title. *Preview PDF* opens the PDF in a dialog with an *Open in a new tab* link, both in the editor and for a built-in layout on the list, instead of a `window.open` that a pop-up blocker could stop.
