---
'@endora-commerce/mod-document-templates': minor
---

The Line items table's columns gain **Print as a link** (issue #1904). It is offered on a column whose field declares the page it links to (`DocumentFieldDefinition.linkPath`) and, ticked, prints each line's value as a link to that line's page (pdfmake `link`, in the link colour); a line without an absolute `http(s)` address prints plain text. Off by default, so existing templates print unchanged. The editor canvas draws a linked value in the same colour with the address on hover.
