---
'@endora-commerce/mod-comarch-xl': patch
---

A sale-document attachment fetched from XL is uploaded as its bytes again

The first download of an attachment failed with a 500: the REST client returns the file as a plain `Uint8Array`, and `Readable.from` iterates a plain typed array element by element, so the upload received numbers instead of a byte stream. The bytes are now passed as one `Buffer` chunk.
