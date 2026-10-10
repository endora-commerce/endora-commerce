---
'@endora-commerce/mod-assets-library': patch
---

`413 ASSET_UPLOAD_TOO_LARGE` says what the limit is. Its sentence was a placeholder — "Asset Upload
Too Large." in English and "Błąd: asset upload too large." in Polish — while the message it replaced
named the configured maximum.

The error now carries `details.maxFileSizeMb`, the value of the `assets.max_file_size_mb` setting,
and both sentences name it: "The file is too large: the largest file that can be uploaded is 25 MB."

The code and the status are unchanged; a client matching on either sees no difference.
