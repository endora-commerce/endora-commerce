---
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
---

The refusal of an Opportunity or Project attachment that a browser would open and run (HTML, SVG,
XML, JavaScript) now has its own sentence in English and Polish. Before, the error envelope
answered the asset library's generic "Files of this type cannot be uploaded to the asset library",
which named the wrong place and none of the refused types (issue #623).

The code and status are unchanged (`415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`); **`details` gained
`code: 'attachment_active_content'`**, so a client that compares `details` for equality will see
it. The sentence lives in `@endora-commerce/mod-assets-library`'s bundle, which owns the code:
"HTML, SVG, XML and JavaScript files cannot be attachments: a browser would open and run them." /
"Pliki HTML, SVG, XML i JavaScript nie mogą być załącznikami: przeglądarka by je otworzyła i
uruchomiła." The thrower's English message is the same sentence.
