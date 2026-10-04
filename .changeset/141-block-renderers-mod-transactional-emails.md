---
"@endora-commerce/mod-transactional-emails": minor
---

Transactional e-mail and its admin preview render the e-mail blocks other modules contribute through `emailBlockRendererRegistry`. Saved e-mail content, e-mail blocks and e-mail templates may now hold a block any composed module declares for the `email` context — save-time validation used to refuse every name outside the built-in set. A block whose module is switched off contributes nothing; a renderer that throws is logged with the block and its owner, and the message is still rendered and sent. Adds the `pageBuilder.blockPreview.unavailable` string (English and Polish).
